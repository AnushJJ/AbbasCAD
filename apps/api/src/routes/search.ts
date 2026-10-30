import { Prisma, PrismaClient } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';

export type SearchDatabase = Pick<PrismaClient, 'city' | 'trip' | 'pricingRule'>;

const tripSearchInclude = {
  route: {
    select: {
      distanceKm: true,
      baseFarePaise: true,
      origin: { select: { id: true, name: true, code: true } },
      destination: { select: { id: true, name: true, code: true } },
    },
  },
  bus: {
    select: {
      id: true,
      name: true,
      operator: true,
      type: true,
      seats: {
        select: { id: true, number: true, category: true, premium: true },
        orderBy: { number: 'asc' },
      },
    },
  },
  inventory: {
    select: {
      seatId: true,
      status: true,
      hold: { select: { status: true, expiresAt: true } },
    },
  },
} satisfies Prisma.TripInclude;

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').refine((value) => {
  if (value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Choose a real calendar date');

const tripSearchQuery = z
  .object({
    originId: z.string().trim().min(1).max(64),
    destinationId: z.string().trim().min(1).max(64),
    date: dateString,
  })
  .strict()
  .refine((query) => query.originId !== query.destinationId, {
    path: ['destinationId'],
    message: 'Origin and destination must be different',
  });

const IST_OFFSET = '+05:30';

function indiaDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function indiaDayRange(date: string) {
  const start = new Date(`${date}T00:00:00.000${IST_OFFSET}`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function ruleSpecificity(rule: { tripId: string | null; seatCategory: string | null; date: Date | null }) {
  return (rule.tripId === null ? 0 : 4) + (rule.seatCategory === null ? 0 : 2) + (rule.date === null ? 0 : 1);
}

function fareInPaise(baseFarePaise: number, tripMultiplier: number, ruleMultiplier: number) {
  if (baseFarePaise < 0 || tripMultiplier < 0 || ruleMultiplier < 0) {
    throw new Error('Invalid fare configuration');
  }
  const numerator = BigInt(baseFarePaise) * BigInt(tripMultiplier) * BigInt(ruleMultiplier);
  const roundedPaise = (numerator + 5_000n) / 10_000n;
  if (roundedPaise > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Fare exceeds the supported amount');
  return Number(roundedPaise);
}

export function createSearchRouter(database: SearchDatabase) {
  const router = Router();

  router.get('/cities', async (_request, response, next) => {
    try {
      const cities = await database.city.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      });
      response.json({ cities });
    } catch (error) {
      next(error);
    }
  });

  router.get('/trips/search', async (request, response, next) => {
    const parsed = tripSearchQuery.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Search parameters are invalid',
          details: parsed.error.issues.map(({ path, message }) => ({ path, message })),
        },
      });
      return;
    }

    try {
      const { originId, destinationId, date } = parsed.data;
      const { start, end } = indiaDayRange(date);
      const now = new Date();
      const trips = await database.trip.findMany({
        where: {
          route: { originId, destinationId },
          departureAt: { gte: start, lt: end },
        },
        include: tripSearchInclude,
        orderBy: { departureAt: 'asc' },
      });

      const tripIds = trips.map((trip) => trip.id);
      const categories = [...new Set(trips.flatMap((trip) => trip.bus.seats.map((seat) => seat.category)))];
      const pricingRules = tripIds.length === 0
        ? []
        : await database.pricingRule.findMany({
            where: {
              active: true,
              AND: [
                { OR: [{ tripId: null }, { tripId: { in: tripIds } }] },
                { OR: [{ seatCategory: null }, { seatCategory: { in: categories } }] },
                { OR: [{ date: null }, { date: { gte: start, lt: end } }] },
              ],
            },
            orderBy: [{ version: 'desc' }, { id: 'asc' }],
          });

      const results = trips.flatMap((trip) => {
        const durationMilliseconds = trip.arrivalAt.getTime() - trip.departureAt.getTime();
        if (durationMilliseconds <= 0) return [];

        const inventoryBySeat = new Map(trip.inventory.map((inventory) => [inventory.seatId, inventory]));
        const fares = trip.bus.seats.map((seat) => {
          const matchingRules = pricingRules.filter((rule) =>
            (rule.tripId === null || rule.tripId === trip.id) &&
            (rule.seatCategory === null || rule.seatCategory === seat.category) &&
            (rule.date === null || indiaDateKey(rule.date) === date),
          );
          matchingRules.sort((left, right) =>
            ruleSpecificity(right) - ruleSpecificity(left) ||
            right.version - left.version ||
            left.id.localeCompare(right.id),
          );
          return {
            ...seat,
            farePaise: fareInPaise(
              trip.route.baseFarePaise,
              trip.fareMultiplier,
              matchingRules[0]?.multiplier ?? 100,
            ),
          };
        });

        const availableSeatDetails = fares.filter((seat) => {
          const inventory = inventoryBySeat.get(seat.id);
          if (inventory?.status === 'AVAILABLE') return true;
          return inventory?.status === 'HELD' && inventory.hold !== null && (
            inventory.hold.status === 'EXPIRED' ||
            inventory.hold.status === 'RELEASED' ||
            (inventory.hold.status === 'ACTIVE' && inventory.hold.expiresAt <= now)
          );
        });
        const availableFares = availableSeatDetails.map((seat) => seat.farePaise);

        return [{
          id: trip.id,
          bus: trip.bus,
          origin: trip.route.origin,
          destination: trip.route.destination,
          departureAt: trip.departureAt.toISOString(),
          arrivalAt: trip.arrivalAt.toISOString(),
          durationMinutes: Math.round(durationMilliseconds / 60_000),
          distanceKm: trip.route.distanceKm,
          totalSeats: trip.bus.seats.length,
          availableSeats: availableSeatDetails.length,
          availableSeatDetails,
          fare: {
            currency: 'INR',
            minimumPaise: availableFares.length ? Math.min(...availableFares) : null,
            maximumPaise: availableFares.length ? Math.max(...availableFares) : null,
          },
        }];
      });

      response.json({ date, trips: results });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
