import { BookingStatus, Prisma, PrismaClient, TripSeatStatus } from '@prisma/client';
import { Request, Router } from 'express';
import { z } from 'zod';
import { AuthenticatedRequest, requireAdmin, requireAuth } from '../auth';
import { asyncRoute, HttpError } from '../http';

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: unknown } } }, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, 'VALIDATION_ERROR', `${label} is invalid`, result.error.issues);
  return result.data;
}

function actor(request: Request) {
  return (request as AuthenticatedRequest).authUser!;
}

async function recordAudit(database: PrismaClient, request: Request, action: string, entityType: string, entityId: string, details: Prisma.InputJsonValue = {}) {
  await database.auditEvent.create({ data: { actorId: actor(request).id, action, entityType, entityId, details } });
}

export function createAdminRouter(database: PrismaClient) {
  const router = Router();
  router.use(requireAuth, requireAdmin);

  router.get('/overview', asyncRoute(async (_request, response) => {
    const [users, cities, routes, buses, trips, bookings, pendingPayments] = await Promise.all([
      database.user.count(), database.city.count(), database.route.count(), database.bus.count(), database.trip.count(),
      database.booking.count(), database.paymentAttempt.count({ where: { status: 'PENDING' } }),
    ]);
    response.json({ users, cities, routes, buses, trips, bookings, pendingPayments });
  }));

  router.get('/cities', asyncRoute(async (_request, response) => {
    response.json({ cities: await database.city.findMany({ orderBy: { name: 'asc' } }) });
  }));
  router.post('/cities', asyncRoute(async (request, response) => {
    const data = parse(z.object({ name: z.string().trim().min(2).max(100), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/) }).strict(), request.body, 'City');
    const city = await database.city.create({ data });
    await recordAudit(database, request, 'ADMIN_CITY_CREATED', 'City', city.id);
    response.status(201).json({ city });
  }));
  router.patch('/cities/:id', asyncRoute(async (request, response) => {
    const data = parse(z.object({ name: z.string().trim().min(2).max(100).optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,6}$/).optional() }).strict().refine((value) => Object.keys(value).length > 0), request.body, 'City');
    const city = await database.city.update({ where: { id: String(request.params.id) }, data });
    await recordAudit(database, request, 'ADMIN_CITY_UPDATED', 'City', city.id);
    response.json({ city });
  }));
  router.delete('/cities/:id', asyncRoute(async (request, response) => {
    const id = String(request.params.id);
    await database.city.delete({ where: { id } });
    await recordAudit(database, request, 'ADMIN_CITY_DELETED', 'City', id);
    response.status(204).end();
  }));

  router.get('/routes', asyncRoute(async (_request, response) => {
    response.json({ routes: await database.route.findMany({ include: { origin: true, destination: true }, orderBy: [{ origin: { name: 'asc' } }, { destination: { name: 'asc' } }] }) });
  }));
  router.post('/routes', asyncRoute(async (request, response) => {
    const data = parse(z.object({ originId: z.string().min(1), destinationId: z.string().min(1), distanceKm: z.number().int().positive().max(20000), baseFarePaise: z.number().int().nonnegative().max(100000000) }).strict().refine((value: { originId: string; destinationId: string }) => value.originId !== value.destinationId), request.body, 'Route');
    const route = await database.route.create({ data });
    await recordAudit(database, request, 'ADMIN_ROUTE_CREATED', 'Route', route.id);
    response.status(201).json({ route });
  }));
  router.patch('/routes/:id', asyncRoute(async (request, response) => {
    const data = parse(z.object({ distanceKm: z.number().int().positive().max(20000).optional(), baseFarePaise: z.number().int().nonnegative().max(100000000).optional() }).strict().refine((value: object) => Object.keys(value).length > 0), request.body, 'Route');
    const route = await database.route.update({ where: { id: String(request.params.id) }, data });
    await recordAudit(database, request, 'ADMIN_ROUTE_UPDATED', 'Route', route.id);
    response.json({ route });
  }));
  router.delete('/routes/:id', asyncRoute(async (request, response) => {
    const id = String(request.params.id);
    await database.route.delete({ where: { id } });
    await recordAudit(database, request, 'ADMIN_ROUTE_DELETED', 'Route', id);
    response.status(204).end();
  }));

  router.get('/buses', asyncRoute(async (_request, response) => {
    response.json({ buses: await database.bus.findMany({ include: { seats: { orderBy: { number: 'asc' } } }, orderBy: { name: 'asc' } }) });
  }));
  router.post('/buses', asyncRoute(async (request, response) => {
    const data = parse(z.object({ name: z.string().trim().min(2).max(100), operator: z.string().trim().min(2).max(100), type: z.string().trim().min(2).max(60), seats: z.array(z.object({ number: z.string().trim().min(1).max(8), category: z.string().trim().min(2).max(32), premium: z.boolean().optional().default(false) }).strict()).min(1).max(80) }).strict(), request.body, 'Bus');
    const uniqueSeats = new Set(data.seats.map((seat: { number: string }) => seat.number));
    if (uniqueSeats.size !== data.seats.length) throw new HttpError(400, 'VALIDATION_ERROR', 'Seat numbers must be unique within a bus');
    const bus = await database.bus.create({ data: { name: data.name, operator: data.operator, type: data.type, seats: { create: data.seats } }, include: { seats: true } });
    await recordAudit(database, request, 'ADMIN_BUS_CREATED', 'Bus', bus.id);
    response.status(201).json({ bus });
  }));
  router.patch('/buses/:id', asyncRoute(async (request, response) => {
    const data = parse(z.object({ name: z.string().trim().min(2).max(100).optional(), operator: z.string().trim().min(2).max(100).optional(), type: z.string().trim().min(2).max(60).optional() }).strict().refine((value: object) => Object.keys(value).length > 0), request.body, 'Bus');
    const bus = await database.bus.update({ where: { id: String(request.params.id) }, data });
    await recordAudit(database, request, 'ADMIN_BUS_UPDATED', 'Bus', bus.id);
    response.json({ bus });
  }));
  router.delete('/buses/:id', asyncRoute(async (request, response) => {
    const id = String(request.params.id);
    await database.bus.delete({ where: { id } });
    await recordAudit(database, request, 'ADMIN_BUS_DELETED', 'Bus', id);
    response.status(204).end();
  }));

  router.post('/buses/:busId/seats', asyncRoute(async (request, response) => {
    const data = parse(z.object({ number: z.string().trim().min(1).max(8), category: z.string().trim().min(2).max(32), premium: z.boolean().optional().default(false) }).strict(), request.body, 'Seat');
    const busId = String(request.params.busId);
    const seat = await database.$transaction(async (tx) => {
      const created = await tx.busSeat.create({ data: { ...data, busId } });
      const trips = await tx.trip.findMany({ where: { busId, departureAt: { gt: new Date() } } });
      if (trips.length) await tx.tripSeatInventory.createMany({ data: trips.map((trip) => ({ tripId: trip.id, seatId: created.id, status: TripSeatStatus.AVAILABLE })) });
      return created;
    });
    await recordAudit(database, request, 'ADMIN_SEAT_CREATED', 'BusSeat', seat.id, { busId });
    response.status(201).json({ seat });
  }));
  router.patch('/buses/:busId/seats/:seatId', asyncRoute(async (request, response) => {
    const data = parse(z.object({ number: z.string().trim().min(1).max(8).optional(), category: z.string().trim().min(2).max(32).optional(), premium: z.boolean().optional() }).strict().refine((value: object) => Object.keys(value).length > 0), request.body, 'Seat');
    const seatId = String(request.params.seatId);
    const hasBookingHistory = await database.tripSeatInventory.count({ where: { seatId, bookingSeatId: { not: null } } });
    if (hasBookingHistory) throw new HttpError(409, 'SEAT_HAS_BOOKINGS', 'Seat details with booking history cannot be changed');
    const seat = await database.busSeat.update({ where: { id: seatId, busId: String(request.params.busId) }, data });
    await recordAudit(database, request, 'ADMIN_SEAT_UPDATED', 'BusSeat', seat.id);
    response.json({ seat });
  }));
  router.delete('/buses/:busId/seats/:seatId', asyncRoute(async (request, response) => {
    const id = String(request.params.seatId);
    await database.busSeat.delete({ where: { id, busId: String(request.params.busId) } });
    await recordAudit(database, request, 'ADMIN_SEAT_DELETED', 'BusSeat', id);
    response.status(204).end();
  }));

  router.get('/trips', asyncRoute(async (_request, response) => {
    response.json({ trips: await database.trip.findMany({ include: { route: { include: { origin: true, destination: true } }, bus: true, _count: { select: { inventory: true, bookings: true } } }, orderBy: { departureAt: 'asc' } }) });
  }));
  router.post('/trips', asyncRoute(async (request, response) => {
    const data = parse(z.object({ routeId: z.string().min(1), busId: z.string().min(1), departureAt: z.string().datetime({ offset: true }), arrivalAt: z.string().datetime({ offset: true }), fareMultiplier: z.number().int().positive().max(1000).optional().default(100) }).strict(), request.body, 'Trip');
    const departureAt = new Date(data.departureAt);
    const arrivalAt = new Date(data.arrivalAt);
    if (arrivalAt <= departureAt) throw new HttpError(400, 'VALIDATION_ERROR', 'Arrival must be after departure');
    const trip = await database.$transaction(async (tx) => {
      const created = await tx.trip.create({ data: { ...data, departureAt, arrivalAt } });
      const seats = await tx.busSeat.findMany({ where: { busId: data.busId }, select: { id: true } });
      if (!seats.length) throw new HttpError(409, 'BUS_HAS_NO_SEATS', 'Add seats to the bus before scheduling a trip');
      await tx.tripSeatInventory.createMany({ data: seats.map((seat) => ({ tripId: created.id, seatId: seat.id, status: TripSeatStatus.AVAILABLE })) });
      return created;
    });
    await recordAudit(database, request, 'ADMIN_TRIP_CREATED', 'Trip', trip.id);
    response.status(201).json({ trip });
  }));
  router.patch('/trips/:id', asyncRoute(async (request, response) => {
    const data = parse(z.object({ departureAt: z.string().datetime({ offset: true }).optional(), arrivalAt: z.string().datetime({ offset: true }).optional(), fareMultiplier: z.number().int().positive().max(1000).optional() }).strict().refine((value: object) => Object.keys(value).length > 0), request.body, 'Trip');
    const existing = await database.trip.findUnique({ where: { id: String(request.params.id) } });
    if (!existing) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
    const departureAt = data.departureAt ? new Date(data.departureAt) : existing.departureAt;
    const arrivalAt = data.arrivalAt ? new Date(data.arrivalAt) : existing.arrivalAt;
    if (arrivalAt <= departureAt) throw new HttpError(400, 'VALIDATION_ERROR', 'Arrival must be after departure');
    const trip = await database.trip.update({ where: { id: existing.id }, data: { ...data, departureAt, arrivalAt } });
    await recordAudit(database, request, 'ADMIN_TRIP_UPDATED', 'Trip', trip.id);
    response.json({ trip });
  }));
  router.delete('/trips/:id', asyncRoute(async (request, response) => {
    const id = String(request.params.id);
    const trip = await database.trip.findUnique({ where: { id }, include: { bookings: true, holds: true } });
    if (!trip) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
    if (trip.bookings.length || trip.holds.length) throw new HttpError(409, 'TRIP_IN_USE', 'Trips with booking or hold history cannot be deleted');
    await database.trip.delete({ where: { id } });
    await recordAudit(database, request, 'ADMIN_TRIP_DELETED', 'Trip', id);
    response.status(204).end();
  }));

  router.get('/pricing-rules', asyncRoute(async (_request, response) => {
    response.json({ pricingRules: await database.pricingRule.findMany({ orderBy: [{ version: 'desc' }, { id: 'asc' }] }) });
  }));
  router.post('/pricing-rules', asyncRoute(async (request, response) => {
    const data = parse(z.object({ tripId: z.string().min(1).nullable().optional(), seatCategory: z.string().min(2).max(32).nullable().optional(), date: z.string().datetime({ offset: true }).nullable().optional(), multiplier: z.number().int().positive().max(1000), version: z.number().int().positive().optional().default(1), active: z.boolean().optional().default(true) }).strict(), request.body, 'Pricing rule');
    if (data.tripId && !(await database.trip.findUnique({ where: { id: data.tripId }, select: { id: true } }))) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
    const pricingRule = await database.pricingRule.create({ data: { ...data, date: data.date ? new Date(data.date) : null, tripId: data.tripId ?? null, seatCategory: data.seatCategory ?? null } });
    await recordAudit(database, request, 'ADMIN_PRICING_CREATED', 'PricingRule', pricingRule.id);
    response.status(201).json({ pricingRule });
  }));
  router.patch('/pricing-rules/:id', asyncRoute(async (request, response) => {
    const data = parse(z.object({ multiplier: z.number().int().positive().max(1000).optional(), version: z.number().int().positive().optional(), active: z.boolean().optional(), tripId: z.string().min(1).nullable().optional(), seatCategory: z.string().min(2).max(32).nullable().optional(), date: z.string().datetime({ offset: true }).nullable().optional() }).strict().refine((value: object) => Object.keys(value).length > 0), request.body, 'Pricing rule');
    if (data.tripId && !(await database.trip.findUnique({ where: { id: data.tripId }, select: { id: true } }))) throw new HttpError(404, 'TRIP_NOT_FOUND', 'Trip was not found');
    const pricingRule = await database.pricingRule.update({ where: { id: String(request.params.id) }, data: { ...data, ...(data.date !== undefined ? { date: data.date ? new Date(data.date) : null } : {}) } });
    await recordAudit(database, request, 'ADMIN_PRICING_UPDATED', 'PricingRule', pricingRule.id);
    response.json({ pricingRule });
  }));
  router.delete('/pricing-rules/:id', asyncRoute(async (request, response) => {
    const id = String(request.params.id);
    await database.pricingRule.delete({ where: { id } });
    await recordAudit(database, request, 'ADMIN_PRICING_DELETED', 'PricingRule', id);
    response.status(204).end();
  }));

  router.get('/bookings', asyncRoute(async (request, response) => {
    const status = typeof request.query.status === 'string' ? request.query.status : undefined;
    if (status && !Object.values(BookingStatus).includes(status as BookingStatus)) throw new HttpError(400, 'VALIDATION_ERROR', 'Booking status is invalid');
    const bookings = await database.booking.findMany({
      ...(status ? { where: { status: status as BookingStatus } } : {}),
      orderBy: { createdAt: 'desc' }, take: 100,
      include: { user: { select: { id: true, name: true, email: true } }, trip: { include: { route: { include: { origin: true, destination: true } }, bus: true } }, seats: true, payment: true },
    });
    response.json({ bookings });
  }));

  return router;
}
