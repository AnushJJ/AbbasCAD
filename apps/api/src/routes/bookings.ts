import { BookingStatus, HoldStatus, PaymentStatus, Prisma, PrismaClient, TripSeatStatus } from '@prisma/client';
import { Response, Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, requireAdmin, requireAuth } from '../auth';
import { asyncRoute, HttpError } from '../http';

const holdSchema = z.object({
  seatIds: z.array(z.string().min(1).max(64)).min(1).max(6),
  idempotencyKey: z.string().min(8).max(128).optional(),
}).strict().refine((body) => new Set(body.seatIds).size === body.seatIds.length, {
  path: ['seatIds'], message: 'A seat can only be selected once',
});

const bookingSchema = z.object({
  holdId: z.string().min(1).max(64),
  idempotencyKey: z.string().min(8).max(128).optional(),
  simulateFailure: z.boolean().optional().default(false),
  redeemLoyaltyReward: z.boolean().optional().default(false),
}).strict();

const cancelSchema = z.object({ reason: z.string().trim().max(250).optional() }).strict();

const tripDetails = {
  route: { include: { origin: true, destination: true } },
  bus: { include: { seats: true } },
} satisfies Prisma.TripInclude;

function currentUser(request: AuthenticatedRequest) {
  if (!request.authUser) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
  return request.authUser;
}

function requestKey(request: AuthenticatedRequest, supplied?: string) {
  const key = supplied ?? request.header('idempotency-key');
  if (!key || key.length < 8 || key.length > 128) {
    throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Provide an Idempotency-Key header or idempotencyKey');
  }
  return `${currentUser(request).id}:${key}`;
}

function istDayRange(value: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const start = new Date(`${date}T00:00:00.000+05:30`);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

function farePaise(base: number, tripMultiplier: number, ruleMultiplier: number) {
  if (![base, tripMultiplier, ruleMultiplier].every(Number.isSafeInteger) || base < 0 || tripMultiplier < 0 || ruleMultiplier < 0) {
    throw new HttpError(409, 'INVALID_PRICING', 'Trip pricing is not valid');
  }
  const amount = (BigInt(base) * BigInt(tripMultiplier) * BigInt(ruleMultiplier) + 5_000n) / 10_000n;
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new HttpError(409, 'INVALID_PRICING', 'Trip fare exceeds the supported amount');
  return Number(amount);
}

function ruleRank(rule: { tripId: string | null; seatCategory: string | null; date: Date | null }) {
  return (rule.tripId ? 4 : 0) + (rule.seatCategory ? 2 : 0) + (rule.date ? 1 : 0);
}

async function getFareMap(
  tx: Prisma.TransactionClient,
  trip: Prisma.TripGetPayload<{ include: typeof tripDetails }>,
) {
  const { start, end } = istDayRange(trip.departureAt);
  const rules = await tx.pricingRule.findMany({
    where: {
      active: true,
      AND: [
        { OR: [{ tripId: null }, { tripId: trip.id }] },
        { OR: [{ seatCategory: null }, { seatCategory: { in: trip.bus.seats.map((seat) => seat.category) } }] },
        { OR: [{ date: null }, { date: { gte: start, lt: end } }] },
      ],
    },
  });
  return new Map(trip.bus.seats.map((seat) => {
    const matching = rules.filter((rule) =>
      (rule.tripId === null || rule.tripId === trip.id) &&
      (rule.seatCategory === null || rule.seatCategory === seat.category) &&
      (rule.date === null || (rule.date >= start && rule.date < end)),
    ).sort((a, b) => ruleRank(b) - ruleRank(a) || b.version - a.version || a.id.localeCompare(b.id));
    return [seat.id, farePaise(trip.route.baseFarePaise, trip.fareMultiplier, matching[0]?.multiplier ?? 100)];
  }));
}

function canReclaim(inventory: { status: TripSeatStatus; hold: { status: HoldStatus; expiresAt: Date } | null }, now: Date) {
  return inventory.status === TripSeatStatus.AVAILABLE || (
    inventory.status === TripSeatStatus.HELD && inventory.hold !== null && (
      inventory.hold.status === HoldStatus.EXPIRED ||
      inventory.hold.status === HoldStatus.RELEASED ||
      (inventory.hold.status === HoldStatus.ACTIVE && inventory.hold.expiresAt <= now)
    )
  );
}

async function lockInventory(tx: Prisma.TransactionClient, tripId: string, seatIds: string[]) {
  return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "TripSeatInventory"
    WHERE "tripId" = ${tripId} AND "seatId" IN (${Prisma.join(seatIds)})
    ORDER BY "seatId" FOR UPDATE
  `);
}

function audit(tx: Prisma.TransactionClient, actorId: string, action: string, entityType: string, entityId: string, details: Prisma.InputJsonValue = {}) {
  return tx.auditEvent.create({ data: { actorId, action, entityType, entityId, details } });
}

async function serializable<T>(database: PrismaClient, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await database.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      const metaCode = error && typeof error === 'object' && 'meta' in error && error.meta && typeof error.meta === 'object' && 'code' in error.meta
        ? String(error.meta.code)
        : '';
      if (attempt < 3 && (['P2034', '40001', '40P01'].includes(code) || ['40001', '40P01'].includes(metaCode))) continue;
      throw error;
    }
  }
}

export function createBookingRouter(database: PrismaClient) {
  const router = Router();
  router.use(requireAuth);

  router.get('/trips/:tripId/seats', asyncRoute(async (request, response) => {
    const tripId = z.string().min(1).max(64).parse(request.params.tripId);
    const trip = await database.trip.findUnique({ where: { id: tripId }, include: tripDetails });
    if (!trip) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
    const { start, end } = istDayRange(trip.departureAt);
    const [inventory, rules] = await Promise.all([
      database.tripSeatInventory.findMany({ where: { tripId }, include: { hold: true } }),
      database.pricingRule.findMany({ where: { active: true, OR: [{ tripId: null }, { tripId }], AND: [{ OR: [{ date: null }, { date: { gte: start, lt: end } }] }] } }),
    ]);
    const now = new Date();
    const inventoryBySeat = new Map(inventory.map((row) => [row.seatId, row]));
    const seats = trip.bus.seats.map((seat) => {
      const current = inventoryBySeat.get(seat.id);
      const available = current ? canReclaim(current, now) : false;
      const candidates = rules.filter((rule) =>
        (rule.tripId === null || rule.tripId === trip.id) &&
        (rule.seatCategory === null || rule.seatCategory === seat.category) &&
        (rule.date === null || (rule.date >= start && rule.date < end)),
      ).sort((a, b) => ruleRank(b) - ruleRank(a) || b.version - a.version || a.id.localeCompare(b.id));
      return {
        id: seat.id, number: seat.number, category: seat.category, premium: seat.premium,
        available, status: available ? 'AVAILABLE' : (current?.status ?? 'UNAVAILABLE'),
        farePaise: farePaise(trip.route.baseFarePaise, trip.fareMultiplier, candidates[0]?.multiplier ?? 100),
      };
    });
    response.json({ trip: { id: trip.id, departureAt: trip.departureAt, route: trip.route, bus: { id: trip.bus.id, name: trip.bus.name, operator: trip.bus.operator, type: trip.bus.type } }, seats });
  }));

  router.post('/trips/:tripId/holds', asyncRoute(async (request, response) => {
    const parsed = holdSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Seat hold details are invalid', parsed.error.issues);
    const user = currentUser(request as AuthenticatedRequest);
    const key = requestKey(request as AuthenticatedRequest, parsed.data.idempotencyKey);
    const tripId = String(request.params.tripId);
    const existing = await database.seatHold.findUnique({ where: { idempotencyKey: key }, include: { seats: true } });
    if (existing) {
      if (existing.userId !== user.id || existing.tripId !== tripId) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used');
      response.status(200).json({ hold: existing, replayed: true });
      return;
    }

    const holdResult = await serializable(database, async (tx) => {
      const replay = await tx.seatHold.findUnique({ where: { idempotencyKey: key }, include: { seats: true } });
      if (replay) {
        if (replay.userId !== user.id || replay.tripId !== tripId) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used');
        return { hold: replay, replayed: true };
      }
      const trip = await tx.trip.findUnique({ where: { id: tripId }, include: tripDetails });
      if (!trip) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
      if (trip.departureAt <= new Date()) throw new HttpError(409, 'TRIP_CLOSED', 'This trip is no longer accepting seat holds');
      const selected = parsed.data.seatIds;
      const selectedSeats = trip.bus.seats.filter((seat) => selected.includes(seat.id));
      if (selectedSeats.length !== selected.length) throw new HttpError(400, 'INVALID_SEAT', 'One or more seats do not belong to this trip');
      await lockInventory(tx, tripId, selected);
      const rows = await tx.tripSeatInventory.findMany({
        where: { tripId, seatId: { in: selected } }, include: { hold: true },
      });
      if (rows.length !== selected.length) throw new HttpError(409, 'INVENTORY_UNAVAILABLE', 'Seat inventory is not configured for this trip');
      const now = new Date();
      const unavailable = rows.filter((row) => !canReclaim(row, now));
      if (unavailable.length) throw new HttpError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats are no longer available');
      const expiredHoldIds = rows.filter((row) => row.status === TripSeatStatus.HELD && row.hold?.status === HoldStatus.ACTIVE && row.hold.expiresAt <= now).map((row) => row.holdId).filter((id): id is string => id !== null);
      if (expiredHoldIds.length) {
        await tx.seatHold.updateMany({ where: { id: { in: expiredHoldIds }, status: HoldStatus.ACTIVE }, data: { status: HoldStatus.EXPIRED } });
      }
      const prices = await getFareMap(tx, trip);
      const expiresAt = new Date(now.getTime() + 8 * 60_000);
      const created = await tx.seatHold.create({
        data: {
          userId: user.id, tripId, idempotencyKey: key, expiresAt,
          seats: { create: selectedSeats.map((seat) => ({ seatId: seat.id, farePaise: prices.get(seat.id)! })) },
        },
        include: { seats: true },
      });
      const changed = await tx.tripSeatInventory.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: { status: TripSeatStatus.HELD, holdId: created.id },
      });
      if (changed.count !== rows.length) throw new HttpError(409, 'SEAT_UNAVAILABLE', 'One or more selected seats could not be held');
      await audit(tx, user.id, 'SEATS_HELD', 'SeatHold', created.id, { tripId, seatIds: selected, expiresAt: expiresAt.toISOString() });
      return { hold: created, replayed: false };
    });
    response.status(holdResult.replayed ? 200 : 201).json(holdResult);
  }));

  router.delete('/holds/:holdId', asyncRoute(async (request, response) => {
    const user = currentUser(request as AuthenticatedRequest);
    const holdId = String(request.params.holdId);
    const released = await serializable(database, async (tx) => {
      const hold = await tx.seatHold.findUnique({ where: { id: holdId }, include: { seats: true } });
      if (!hold || hold.userId !== user.id) throw new HttpError(404, 'HOLD_NOT_FOUND', 'Seat hold was not found');
      if (hold.status === HoldStatus.RELEASED || hold.status === HoldStatus.EXPIRED) return { hold, replayed: true };
      if (hold.status !== HoldStatus.ACTIVE) throw new HttpError(409, 'HOLD_NOT_RELEASABLE', 'This hold has already been used');
      const seatIds = hold.seats.map((seat) => seat.seatId);
      if (seatIds.length) await lockInventory(tx, hold.tripId, seatIds);
      const updated = await tx.seatHold.update({ where: { id: hold.id }, data: { status: HoldStatus.RELEASED } });
      await tx.tripSeatInventory.updateMany({ where: { tripId: hold.tripId, holdId: hold.id, status: TripSeatStatus.HELD }, data: { status: TripSeatStatus.AVAILABLE, holdId: null } });
      await audit(tx, user.id, 'SEAT_HOLD_RELEASED', 'SeatHold', hold.id, { tripId: hold.tripId });
      return { hold: updated, replayed: false };
    });
    response.json(released);
  }));

  const createBooking = async (request: AuthenticatedRequest, response: Response, forceReward = false) => {
    const parsed = bookingSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Booking details are invalid', parsed.error.issues);
    const user = currentUser(request);
    const idempotencyKey = requestKey(request, parsed.data.idempotencyKey);
    const redeemReward = forceReward || parsed.data.redeemLoyaltyReward;
    const prior = await database.booking.findUnique({ where: { idempotencyKey }, include: { payment: true, seats: true, trip: true } });
    if (prior) {
      if (prior.userId !== user.id) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used');
      response.status(200).json({ booking: prior, replayed: true });
      return;
    }

    const outcome = await serializable(database, async (tx) => {
      const existing = await tx.booking.findUnique({ where: { idempotencyKey }, include: { payment: true, seats: true, trip: true } });
      if (existing) {
        if (existing.userId !== user.id) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key was already used');
        return { booking: existing, failed: existing.payment?.status === PaymentStatus.FAILED, replayed: true };
      }
      const hold = await tx.seatHold.findUnique({ where: { id: parsed.data.holdId }, include: { seats: true } });
      if (!hold || hold.userId !== user.id) throw new HttpError(404, 'HOLD_NOT_FOUND', 'Seat hold was not found');
      if (hold.status === HoldStatus.EXPIRED || (hold.status === HoldStatus.ACTIVE && hold.expiresAt <= new Date())) {
        throw new HttpError(409, 'HOLD_EXPIRED', 'Your seat hold has expired');
      }
      if (hold.status !== HoldStatus.ACTIVE) throw new HttpError(409, 'HOLD_INVALID', 'This seat hold has already been used or released');
      const seatIds = hold.seats.map((seat) => seat.seatId);
      if (!seatIds.length) throw new HttpError(409, 'EMPTY_HOLD', 'This seat hold has no seats');
      await lockInventory(tx, hold.tripId, seatIds);
      const rows = await tx.tripSeatInventory.findMany({ where: { tripId: hold.tripId, seatId: { in: seatIds } }, include: { hold: true } });
      if (rows.length !== seatIds.length || rows.some((row) => row.status !== TripSeatStatus.HELD || row.holdId !== hold.id)) {
        throw new HttpError(409, 'HOLD_INVALID', 'The held seats are no longer reserved for this hold');
      }
      const trip = await tx.trip.findUnique({ where: { id: hold.tripId }, include: tripDetails });
      if (!trip) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
      const subtotal = hold.seats.reduce((sum, seat) => sum + seat.farePaise, 0);
      const cheapest = Math.min(...hold.seats.map((seat) => seat.farePaise));
      const loyalty = await tx.loyaltyAccount.findUnique({ where: { userId: user.id } });
      const canRedeem = Boolean(redeemReward && loyalty && loyalty.travelledKm >= 10_000 && !loyalty.rewardRedeemedAt);
      if (redeemReward && !canRedeem) throw new HttpError(409, 'REWARD_UNAVAILABLE', 'The 10,000 km reward is not available');
      const discount = canRedeem ? cheapest : 0;
      const totalPaise = Math.max(0, subtotal - discount);
      const failed = parsed.data.simulateFailure;
      const booking = await tx.booking.create({
        data: {
          userId: user.id, tripId: trip.id, status: failed ? BookingStatus.CANCELLED : BookingStatus.CONFIRMED,
          distanceKm: trip.route.distanceKm, totalPaise, idempotencyKey,
        },
      });
      const payment = await tx.paymentAttempt.create({
        data: {
          bookingId: booking.id, amountPaise: totalPaise,
          status: failed ? PaymentStatus.FAILED : PaymentStatus.SUCCEEDED,
          providerReference: failed ? `SIM-FAIL-${booking.id}` : `SIM-OK-${booking.id}`,
        },
      });
      if (failed) {
        await tx.tripSeatInventory.updateMany({ where: { tripId: trip.id, seatId: { in: seatIds }, holdId: hold.id }, data: { status: TripSeatStatus.AVAILABLE, holdId: null } });
        await tx.seatHold.update({ where: { id: hold.id }, data: { status: HoldStatus.RELEASED } });
        await audit(tx, user.id, 'PAYMENT_FAILED', 'Booking', booking.id, { holdId: hold.id, amountPaise: totalPaise });
        return { booking: { ...booking, payment, seats: [], trip }, failed: true, replayed: false };
      }
      const fareOrder = [...hold.seats].sort((a, b) => a.farePaise - b.farePaise || a.seatId.localeCompare(b.seatId));
      const discountSeatId = canRedeem ? fareOrder[0]?.seatId : undefined;
      const bookingSeats = await Promise.all(hold.seats.map((seat) => tx.bookingSeat.create({
        data: { bookingId: booking.id, seatId: seat.seatId, farePaise: seat.farePaise - (seat.seatId === discountSeatId ? discount : 0) },
      })));
      for (const bookingSeat of bookingSeats) {
        const changed = await tx.tripSeatInventory.updateMany({
          where: { tripId: trip.id, seatId: bookingSeat.seatId, holdId: hold.id, status: TripSeatStatus.HELD },
          data: { status: TripSeatStatus.BOOKED, holdId: null, bookingSeatId: bookingSeat.id },
        });
        if (changed.count !== 1) throw new HttpError(409, 'SEAT_UNAVAILABLE', 'A seat could not be confirmed');
      }
      await tx.seatHold.update({ where: { id: hold.id }, data: { status: HoldStatus.CONSUMED } });
      if (canRedeem) {
        await tx.loyaltyAccount.update({ where: { userId: user.id }, data: { rewardRedeemedAt: new Date() } });
        await tx.rewardRedemption.create({ data: { userId: user.id, rewardCode: `LOYALTY_10000KM_${booking.id}` } });
      }
      await audit(tx, user.id, 'BOOKING_CONFIRMED', 'Booking', booking.id, { tripId: trip.id, totalPaise, discountPaise: discount });
      return { booking: { ...booking, payment, seats: bookingSeats.map((seat) => ({ ...seat, number: trip.bus.seats.find((item) => item.id === seat.seatId)?.number ?? seat.seatId })), trip }, failed: false, replayed: false };
    });
    response.status(outcome.replayed ? 200 : outcome.failed ? 402 : 201).json({ booking: outcome.booking, replayed: outcome.replayed, ...(outcome.failed ? { error: { code: 'PAYMENT_FAILED', message: 'The simulated payment failed. Held seats were released.' } } : {}) });
  };

  router.post('/bookings', asyncRoute(async (request, response) => {
    await createBooking(request as AuthenticatedRequest, response);
  }));
  router.post('/loyalty/redeem', asyncRoute(async (request, response) => {
    await createBooking(request as AuthenticatedRequest, response, true);
  }));

  router.get('/bookings', asyncRoute(async (request, response) => {
    const user = currentUser(request as AuthenticatedRequest);
    const bookings = await database.booking.findMany({
      where: { userId: user.id }, orderBy: { createdAt: 'desc' },
      include: { trip: { include: { route: { include: { origin: true, destination: true } }, bus: { include: { seats: { select: { id: true, number: true } } } } } }, seats: true, payment: true },
    });
    const cancellations = bookings.length ? await database.cancellation.findMany({ where: { bookingId: { in: bookings.map((booking) => booking.id) } } }) : [];
    const cancellationByBooking = new Map(cancellations.map((cancellation) => [cancellation.bookingId, cancellation]));
    response.json({ bookings: bookings.map((booking) => ({ ...booking, seats: booking.seats.map((seat) => ({ ...seat, number: booking.trip.bus.seats.find((item) => item.id === seat.seatId)?.number ?? seat.seatId })), cancellation: cancellationByBooking.get(booking.id) ?? null })) });
  }));

  router.get('/bookings/:bookingId', asyncRoute(async (request, response) => {
    const user = currentUser(request as AuthenticatedRequest);
    const booking = await database.booking.findUnique({
      where: { id: String(request.params.bookingId) },
      include: { trip: { include: { route: { include: { origin: true, destination: true } }, bus: { include: { seats: { select: { id: true, number: true } } } } } }, seats: true, payment: true },
    });
    if (!booking || (booking.userId !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking was not found');
    const cancellation = await database.cancellation.findUnique({ where: { bookingId: booking.id } });
    response.json({ booking: { ...booking, seats: booking.seats.map((seat) => ({ ...seat, number: booking.trip.bus.seats.find((item) => item.id === seat.seatId)?.number ?? seat.seatId })), cancellation } });
  }));

  router.post('/bookings/:bookingId/cancel', asyncRoute(async (request, response) => {
    const parsed = cancelSchema.safeParse(request.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Cancellation details are invalid');
    const user = currentUser(request as AuthenticatedRequest);
    const bookingId = String(request.params.bookingId);
    const priorCancellation = await database.cancellation.findUnique({ where: { bookingId } });
    if (priorCancellation) {
      const existingBooking = await database.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
      if (existingBooking?.userId !== user.id && user.role !== 'ADMIN') throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking was not found');
      response.json({ cancellation: priorCancellation, booking: existingBooking, replayed: true });
      return;
    }
    const cancellation = await serializable(database, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`);
      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { trip: true, seats: true, payment: true } });
      if (!booking || (booking.userId !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking was not found');
      const alreadyCancelled = await tx.cancellation.findUnique({ where: { bookingId } });
      if (alreadyCancelled) return { value: alreadyCancelled, replayed: true };
      if (booking.status !== BookingStatus.CONFIRMED || booking.payment?.status !== PaymentStatus.SUCCEEDED) throw new HttpError(409, 'BOOKING_NOT_CANCELLABLE', 'This booking is not eligible for cancellation');
      if (booking.trip.departureAt.getTime() - Date.now() < 2 * 60 * 60 * 1000) throw new HttpError(409, 'CANCELLATION_CUTOFF', 'Cancellations close two hours before departure');
      const bookingSeatIds = booking.seats.map((seat) => seat.id);
      if (bookingSeatIds.length) {
        await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "TripSeatInventory" WHERE "bookingSeatId" IN (${Prisma.join(bookingSeatIds)}) ORDER BY "id" FOR UPDATE`);
        const released = await tx.tripSeatInventory.updateMany({ where: { bookingSeatId: { in: bookingSeatIds }, status: TripSeatStatus.BOOKED }, data: { status: TripSeatStatus.AVAILABLE, bookingSeatId: null, holdId: null } });
        if (released.count !== bookingSeatIds.length) throw new HttpError(409, 'INVENTORY_MISMATCH', 'The booking seats could not be safely released');
      }
      const result = await tx.cancellation.create({ data: { bookingId, refundPaise: booking.totalPaise, reason: parsed.data.reason ?? null } });
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.CANCELLED } });
      await tx.paymentAttempt.update({ where: { bookingId }, data: { status: PaymentStatus.REFUNDED } });
      await audit(tx, user.id, 'BOOKING_CANCELLED', 'Booking', bookingId, { refundPaise: booking.totalPaise });
      return { value: result, replayed: false };
    });
    const updatedBooking = await database.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
    response.json({ cancellation: cancellation.value, booking: updatedBooking, replayed: cancellation.replayed });
  }));

  router.get('/loyalty', asyncRoute(async (request, response) => {
    const user = currentUser(request as AuthenticatedRequest);
    const loyalty = await database.loyaltyAccount.findUnique({ where: { userId: user.id } });
    response.json({
      travelledKm: loyalty?.travelledKm ?? 0,
      rewardThresholdKm: 10_000,
      rewardAvailable: Boolean(loyalty && loyalty.travelledKm >= 10_000 && !loyalty.rewardRedeemedAt),
      rewardRedeemedAt: loyalty?.rewardRedeemedAt ?? null,
      rewardDescription: 'At 10,000 completed kilometres, redeem one free seat on a booking.',
    });
  }));

  router.post('/admin/bookings/:bookingId/complete', requireAdmin, asyncRoute(async (request, response) => {
    const actor = currentUser(request as AuthenticatedRequest);
    const bookingId = String(request.params.bookingId);
    const result = await serializable(database, async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Booking" WHERE "id" = ${bookingId} FOR UPDATE`);
      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { trip: true } });
      if (!booking) throw new HttpError(404, 'BOOKING_NOT_FOUND', 'Booking was not found');
      if (booking.status === BookingStatus.COMPLETED) {
        return tx.loyaltyAccount.findUnique({ where: { userId: booking.userId } });
      }
      if (booking.status !== BookingStatus.CONFIRMED) throw new HttpError(409, 'BOOKING_NOT_COMPLETABLE', 'Only confirmed bookings can be completed');
      if (booking.trip.arrivalAt > new Date()) throw new HttpError(409, 'TRIP_NOT_FINISHED', 'The journey has not arrived yet');
      await tx.completedJourneyRecord.create({ data: { bookingId, userId: booking.userId, distanceKm: booking.distanceKm } });
      const loyalty = await tx.loyaltyAccount.upsert({
        where: { userId: booking.userId },
        create: { userId: booking.userId, travelledKm: booking.distanceKm },
        update: { travelledKm: { increment: booking.distanceKm } },
      });
      await tx.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.COMPLETED } });
      await audit(tx, actor.id, 'JOURNEY_COMPLETED', 'Booking', bookingId, { userId: booking.userId, distanceKm: booking.distanceKm });
      return loyalty;
    });
    response.json({ bookingId, loyalty: result, rewardThresholdKm: 10_000, rewardAvailable: Boolean(result && result.travelledKm >= 10_000 && !result.rewardRedeemedAt) });
  }));

  return router;
}
