import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { app, createApp } from './app';
import { SearchDatabase } from './routes/search';

const journeyDate = '2026-10-30';
const dayStart = new Date(`${journeyDate}T00:00:00.000+05:30`);
const dayEnd = new Date('2026-10-31T00:00:00.000+05:30');
const origin = { id: 'city-delhi', name: 'Delhi', code: 'DEL' };
const destination = { id: 'city-jaipur', name: 'Jaipur', code: 'JAI' };
const trip = {
  id: 'trip-demo',
  departureAt: new Date(`${journeyDate}T09:00:00.000+05:30`),
  arrivalAt: new Date(`${journeyDate}T14:00:00.000+05:30`),
  fareMultiplier: 110,
  route: { distanceKm: 280, baseFarePaise: 10_000, origin, destination },
  bus: {
    id: 'bus-demo', name: 'Demo Express', operator: 'SmartBus Demo', type: 'AC Seater',
    seats: [
      { id: 'seat-1', number: '1A', category: 'STANDARD', premium: false },
      { id: 'seat-2', number: '1B', category: 'WINDOW', premium: false },
      { id: 'seat-3', number: '2A', category: 'STANDARD', premium: false },
      { id: 'seat-4', number: '2B', category: 'STANDARD', premium: false },
      { id: 'seat-5', number: '3A', category: 'STANDARD', premium: false },
      { id: 'seat-6', number: '3B', category: 'STANDARD', premium: false },
      { id: 'seat-7', number: '4A', category: 'STANDARD', premium: false },
    ],
  },
  inventory: [
    { seatId: 'seat-1', status: 'AVAILABLE', hold: null },
    { seatId: 'seat-2', status: 'AVAILABLE', hold: null },
    { seatId: 'seat-3', status: 'HELD', hold: { status: 'ACTIVE', expiresAt: new Date(Date.now() - 60_000) } },
    { seatId: 'seat-4', status: 'HELD', hold: { status: 'ACTIVE', expiresAt: new Date(Date.now() + 60_000) } },
    { seatId: 'seat-5', status: 'BOOKED', hold: null },
    { seatId: 'seat-6', status: 'HELD', hold: { status: 'EXPIRED', expiresAt: new Date(Date.now() + 60_000) } },
    { seatId: 'seat-7', status: 'HELD', hold: { status: 'CONSUMED', expiresAt: new Date(Date.now() - 60_000) } },
  ],
};

function makeDatabase(overrides: Record<string, unknown> = {}) {
  const fake = {
    city: { findMany: vi.fn().mockResolvedValue([destination, origin]) },
    trip: { findMany: vi.fn().mockResolvedValue([trip]) },
    pricingRule: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'rule-window-date',
        tripId: 'trip-demo',
        seatCategory: 'WINDOW',
        date: new Date(`${journeyDate}T00:00:00.000+05:30`),
        multiplier: 120,
        version: 1,
      }]),
    },
    ...overrides,
  };
  return fake as unknown as SearchDatabase & typeof fake;
}

describe('GET /api/health', () => {
  it('reports that the API is healthy', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', service: 'smartbus-api' });
  });
});

describe('GET /api/cities', () => {
  it('returns cities in display order', async () => {
    const database = makeDatabase();
    const response = await request(createApp(database)).get('/api/cities');

    expect(response.status).toBe(200);
    expect(response.body.cities).toHaveLength(2);
    expect(database.city.findMany).toHaveBeenCalledWith({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  });
});

describe('GET /api/trips/search', () => {
  let database: ReturnType<typeof makeDatabase>;

  beforeEach(() => {
    database = makeDatabase();
  });

  it.each([
    ['missing date', '/api/trips/search?originId=city-delhi&destinationId=city-jaipur'],
    ['impossible date', '/api/trips/search?originId=city-delhi&destinationId=city-jaipur&date=2026-02-30'],
    ['year zero', '/api/trips/search?originId=city-delhi&destinationId=city-jaipur&date=0000-01-01'],
    ['malformed date', '/api/trips/search?originId=city-delhi&destinationId=city-jaipur&date=30-10-2026'],
    ['same origin and destination', '/api/trips/search?originId=city-delhi&destinationId=city-delhi&date=2026-10-30'],
    ['unknown parameter', '/api/trips/search?originId=city-delhi&destinationId=city-jaipur&date=2026-10-30&extra=1'],
  ])('rejects %s before querying the database', async (_case, path) => {
    const response = await request(createApp(database)).get(path);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(database.trip.findMany).not.toHaveBeenCalled();
  });

  it('uses IST day boundaries and returns fare and seat availability', async () => {
    const response = await request(createApp(database)).get(
      `/api/trips/search?originId=city-delhi&destinationId=city-jaipur&date=${journeyDate}`,
    );

    expect(response.status).toBe(200);
    expect(database.trip.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        route: { originId: 'city-delhi', destinationId: 'city-jaipur' },
        departureAt: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { departureAt: 'asc' },
    }));
    expect(response.body.trips).toHaveLength(1);
    expect(response.body.trips[0]).toMatchObject({
      id: 'trip-demo',
      distanceKm: 280,
      durationMinutes: 300,
      totalSeats: 7,
      availableSeats: 4,
      fare: { currency: 'INR', minimumPaise: 11_000, maximumPaise: 13_200 },
    });
    expect(response.body.trips[0].availableSeatDetails.map((seat: { number: string }) => seat.number))
      .toEqual(['1A', '1B', '2A', '3B']);
  });

  it('returns an empty array and skips pricing lookup when no trip matches', async () => {
    database = makeDatabase({ trip: { findMany: vi.fn().mockResolvedValue([]) } });
    const response = await request(createApp(database)).get(
      `/api/trips/search?originId=city-delhi&destinationId=city-jaipur&date=${journeyDate}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.trips).toEqual([]);
    expect(database.pricingRule.findMany).not.toHaveBeenCalled();
  });
});

