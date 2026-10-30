import 'dotenv/config';
import { BookingStatus, PaymentStatus, Role, TripSeatStatus } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { passwordHash } from './auth';
import { prisma } from './db';

const enabled = Boolean(process.env.DATABASE_URL);
const password = 'SmartBus-Test-Password-2026!';

describe.runIf(enabled)('booking flow against local PostgreSQL', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ids = {
    cityA: `e2e-city-a-${suffix}`,
    cityB: `e2e-city-b-${suffix}`,
    cityC: `e2e-city-c-${suffix}`,
    cityD: `e2e-city-d-${suffix}`,
    routeA: `e2e-route-a-${suffix}`,
    routeB: `e2e-route-b-${suffix}`,
    pricing: `e2e-pricing-${suffix}`,
    bus: `e2e-bus-${suffix}`,
    tripA: `e2e-trip-a-${suffix}`,
    tripB: `e2e-trip-b-${suffix}`,
    seatA: `e2e-seat-a-${suffix}`,
    seatB: `e2e-seat-b-${suffix}`,
    seatC: `e2e-seat-c-${suffix}`,
    seatD: `e2e-seat-d-${suffix}`,
    userA: `e2e-user-a-${suffix}`,
    userB: `e2e-user-b-${suffix}`,
    admin: `e2e-admin-${suffix}`,
  };
  let agentA: ReturnType<typeof request.agent>;
  let agentB: ReturnType<typeof request.agent>;
  let adminAgent: ReturnType<typeof request.agent>;
  let bookingIds: string[] = [];
  let holdIds: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'smartbus-integration-tests-only-secret-2026';
    await prisma.$connect();
    const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const finish = new Date(start.getTime() + 5 * 60 * 60 * 1000);
    await prisma.city.createMany({ data: [
      { id: ids.cityA, name: `E2E Origin ${suffix}`, code: `A${suffix.slice(-4).toUpperCase()}` },
      { id: ids.cityB, name: `E2E Destination ${suffix}`, code: `B${suffix.slice(-4).toUpperCase()}` },
      { id: ids.cityC, name: `E2E Long Origin ${suffix}`, code: `C${suffix.slice(-4).toUpperCase()}` },
      { id: ids.cityD, name: `E2E Long Destination ${suffix}`, code: `D${suffix.slice(-4).toUpperCase()}` },
    ] });
    await prisma.route.createMany({ data: [
      { id: ids.routeA, originId: ids.cityA, destinationId: ids.cityB, distanceKm: 180, baseFarePaise: 120000 },
      { id: ids.routeB, originId: ids.cityC, destinationId: ids.cityD, distanceKm: 10000, baseFarePaise: 150000 },
    ] });
    await prisma.bus.create({ data: { id: ids.bus, name: `E2E Coach ${suffix}`, operator: 'SmartBus Tests', type: 'AC Seater' } });
    await prisma.busSeat.createMany({ data: [
      { id: ids.seatA, busId: ids.bus, number: '1A', category: 'STANDARD' },
      { id: ids.seatB, busId: ids.bus, number: '1B', category: 'WINDOW' },
      { id: ids.seatC, busId: ids.bus, number: '2A', category: 'PREMIUM', premium: true },
    ] });
    await prisma.trip.createMany({ data: [
      { id: ids.tripA, routeId: ids.routeA, busId: ids.bus, departureAt: start, arrivalAt: finish, fareMultiplier: 100 },
      { id: ids.tripB, routeId: ids.routeB, busId: ids.bus, departureAt: start, arrivalAt: finish, fareMultiplier: 100 },
    ] });
    await prisma.tripSeatInventory.createMany({ data: [ids.tripA, ids.tripB].flatMap((tripId) => [ids.seatA, ids.seatB, ids.seatC].map((seatId) => ({ tripId, seatId, status: TripSeatStatus.AVAILABLE }))) });
    await prisma.pricingRule.create({ data: { id: ids.pricing, tripId: ids.tripA, seatCategory: 'WINDOW', multiplier: 125 } });
    await prisma.user.create({ data: { id: ids.admin, username: `admin${suffix.slice(-10)}`, email: `${ids.admin}@example.test`, passwordHash: await passwordHash(password), name: 'Test Admin', role: Role.ADMIN, loyalty: { create: {} } } });
    agentA = request.agent(app);
    agentB = request.agent(app);
    adminAgent = request.agent(app);
    const users = [
      { agent: agentA, id: ids.userA, name: 'Test Rider A' },
      { agent: agentB, id: ids.userB, name: 'Test Rider B' },
    ];
    for (const { agent, id, name } of users) {
      const registered = await agent.post('/api/auth/register').send({ username: `${name.replace(/\s/g, '').toLowerCase()}${suffix.slice(-8)}`, email: `${id}@example.test`, name, password });
      expect(registered.status, JSON.stringify(registered.body)).toBe(201);
    }
    const adminLogin = await adminAgent.post('/api/auth/login').send({ email: `${ids.admin}@example.test`, password });
    expect(adminLogin.status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    const tripIds = [ids.tripA, ids.tripB];
    let userIds: string[] = [];
    try {
      const testUsers = await prisma.user.findMany({
        where: { email: { in: [ids.userA, ids.userB, ids.admin].map((id) => `${id}@example.test`) } },
        select: { id: true },
      });
      userIds = testUsers.map(({ id }) => id);
      const bookings = await prisma.booking.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const bookingIdsToClean = [...new Set([...bookingIds, ...bookings.map(({ id }) => id)])];
      const holds = await prisma.seatHold.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
      const holdIdsToClean = [...new Set([...holdIds, ...holds.map(({ id }) => id)])];
      if (bookingIdsToClean.length) {
        const seats = await prisma.bookingSeat.findMany({ where: { bookingId: { in: bookingIdsToClean } }, select: { id: true } });
        await prisma.tripSeatInventory.updateMany({ where: { bookingSeatId: { in: seats.map(({ id }) => id) } }, data: { bookingSeatId: null } });
        await prisma.paymentAttempt.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
        await prisma.cancellation.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
        await prisma.completedJourneyRecord.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
        await prisma.bookingSeat.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
        await prisma.booking.deleteMany({ where: { id: { in: bookingIdsToClean } } });
      }
      if (holdIdsToClean.length) {
        await prisma.tripSeatInventory.deleteMany({ where: { holdId: { in: holdIdsToClean } } });
        await prisma.heldSeat.deleteMany({ where: { holdId: { in: holdIdsToClean } } });
        await prisma.seatHold.deleteMany({ where: { id: { in: holdIdsToClean } } });
      }
      await prisma.tripSeatInventory.deleteMany({ where: { tripId: { in: tripIds } } });
      await prisma.rewardRedemption.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.pricingRule.deleteMany({ where: { id: ids.pricing } });
      await prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
      await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
      await prisma.busSeat.deleteMany({ where: { busId: ids.bus } });
      await prisma.bus.deleteMany({ where: { id: ids.bus } });
      await prisma.route.deleteMany({ where: { id: { in: [ids.routeA, ids.routeB] } } });
      await prisma.loyaltyAccount.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      await prisma.city.deleteMany({ where: { id: { in: [ids.cityA, ids.cityB, ids.cityC, ids.cityD] } } });
    } finally {
      await prisma.$disconnect();
    }
  }, 30_000);

  it('covers auth, seat locking, payment failure, idempotency, cancellation, rewards, and admin authorization', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'invalid' })).status).toBe(400);
    expect((await request(app).post('/api/auth/login').send({ email: 'missing@example.test', password })).status).toBe(401);
    expect((await agentA.get('/api/auth/me')).status).toBe(200);
    expect((await agentA.patch('/api/auth/profile').send({ name: 'Updated Rider A', phone: '9876543210' })).status).toBe(200);
    expect((await agentA.get('/api/admin/overview')).status).toBe(403);
    expect((await agentA.get('/api/admin/cities')).status).toBe(403);
    const initialSeats = (await agentA.get(`/api/trips/${ids.tripA}/seats`)).body.seats;
    expect(initialSeats).toHaveLength(3);
    expect(initialSeats.find((seat: { id: string }) => seat.id === ids.seatB).farePaise).toBe(150_000);
    expect((await agentA.post(`/api/admin/buses/${ids.bus}/seats`).send({ number: '4A', category: 'PREMIUM', premium: true })).status).toBe(403);
    const adminSeat = await adminAgent.post(`/api/admin/buses/${ids.bus}/seats`).send({ number: '4A', category: 'PREMIUM', premium: true });
    expect(adminSeat.status).toBe(201);
    ids.seatD = adminSeat.body.seat.id;
    expect((await adminAgent.patch(`/api/admin/buses/${ids.bus}/seats/${ids.seatD}`).send({ number: '4B' })).status).toBe(200);

    const holdRequest = (agent: typeof agentA) => agent.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', `hold-${Math.random().toString(36).slice(2)}-key`).send({ seatIds: [ids.seatA] });
    const [holdA, holdB] = await Promise.all([holdRequest(agentA), holdRequest(agentB)]);
    const success = [holdA, holdB].find((result) => result.status === 201)!;
    const conflict = [holdA, holdB].find((result) => result.status === 409)!;
    expect(success.status).toBe(201);
    expect(conflict.body.error.code).toBe('SEAT_UNAVAILABLE');
    const winner = success === holdA ? agentA : agentB;
    const other = winner === agentA ? agentB : agentA;
    const holdId = success.body.hold.id as string;
    holdIds.push(holdId);

    const activeSeatKey = `active-seat-${suffix}-key`;
    const activeSeatHold = await other.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', activeSeatKey).send({ seatIds: [ids.seatB] });
    expect(activeSeatHold.status).toBe(201);
    holdIds.push(activeSeatHold.body.hold.id);
    const holdReplay = await other.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', activeSeatKey).send({ seatIds: [ids.seatB] });
    expect(holdReplay.status).toBe(200);
    expect(holdReplay.body.hold.id).toBe(activeSeatHold.body.hold.id);
    expect((await winner.get(`/api/trips/${ids.tripA}/seats`)).body.seats.find((seat: { id: string }) => seat.id === ids.seatB).available).toBe(false);
    await prisma.seatHold.update({ where: { id: activeSeatHold.body.hold.id }, data: { status: 'EXPIRED' } });
    expect((await winner.get(`/api/trips/${ids.tripA}/seats`)).body.seats.find((seat: { id: string }) => seat.id === ids.seatB).available).toBe(true);

    const failedHold = await winner.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', `failure-hold-${suffix}-key`).send({ seatIds: [ids.seatB] });
    expect(failedHold.status).toBe(201);
    holdIds.push(failedHold.body.hold.id);
    const failed = await winner.post('/api/bookings').set('Idempotency-Key', `failure-${suffix}-key`).send({ holdId: failedHold.body.hold.id, simulateFailure: true });
    expect(failed.status).toBe(402);
    expect(failed.body.booking.payment.status).toBe(PaymentStatus.FAILED);
    bookingIds.push(failed.body.booking.id);
    const afterFailure = await winner.get(`/api/trips/${ids.tripA}/seats`);
    expect(afterFailure.body.seats.find((seat: { id: string }) => seat.id === ids.seatB).available).toBe(true);

    const bookingKeyA = `booking-a-${suffix}-key`;
    const bookingKeyB = `booking-b-${suffix}-key`;
    const [bookingAttemptA, bookingAttemptB] = await Promise.all([
      winner.post('/api/bookings').set('Idempotency-Key', bookingKeyA).send({ holdId }),
      winner.post('/api/bookings').set('Idempotency-Key', bookingKeyB).send({ holdId }),
    ]);
    const booked = [bookingAttemptA, bookingAttemptB].find((result) => result.status === 201)!;
    const rejectedDuplicate = [bookingAttemptA, bookingAttemptB].find((result) => result.status === 409)!;
    const winningBookingKey = booked === bookingAttemptA ? bookingKeyA : bookingKeyB;
    expect(rejectedDuplicate.body.error.code).toBe('HOLD_INVALID');
    expect(booked.body.booking.payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(booked.body.booking.status).toBe(BookingStatus.CONFIRMED);
    bookingIds.push(booked.body.booking.id);
    const replay = await winner.post('/api/bookings').set('Idempotency-Key', winningBookingKey).send({ holdId });
    expect(replay.status).toBe(200);
    expect(replay.body.booking.id).toBe(booked.body.booking.id);
    expect((await winner.get('/api/bookings')).body.bookings.some((item: { id: string }) => item.id === booked.body.booking.id)).toBe(true);

    await prisma.trip.update({ where: { id: ids.tripA }, data: { departureAt: new Date(Date.now() + 60 * 60 * 1000) } });
    expect((await winner.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({})).status).toBe(409);
    await prisma.trip.update({ where: { id: ids.tripA }, data: { departureAt: new Date(Date.now() + 48 * 60 * 60 * 1000), arrivalAt: new Date(Date.now() + 53 * 60 * 60 * 1000) } });
    const cancelled = await winner.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({ reason: 'Test cancellation' });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancellation.refundPaise).toBe(booked.body.booking.totalPaise);
    expect(cancelled.body.booking.payment.status).toBe(PaymentStatus.REFUNDED);
    expect((await winner.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({})).body.replayed).toBe(true);

    const longHold = await winner.post(`/api/trips/${ids.tripB}/holds`).set('Idempotency-Key', `long-hold-${suffix}-key`).send({ seatIds: [ids.seatC] });
    expect(longHold.status).toBe(201);
    holdIds.push(longHold.body.hold.id);
    const longBooking = await winner.post('/api/bookings').set('Idempotency-Key', `long-booking-${suffix}-key`).send({ holdId: longHold.body.hold.id });
    expect(longBooking.status).toBe(201);
    bookingIds.push(longBooking.body.booking.id);
    await prisma.trip.update({ where: { id: ids.tripB }, data: { departureAt: new Date(Date.now() - 6 * 60 * 60 * 1000), arrivalAt: new Date(Date.now() - 60 * 60 * 1000) } });
    expect((await adminAgent.get('/api/admin/overview')).status).toBe(200);
    const completed = await adminAgent.post(`/api/admin/bookings/${longBooking.body.booking.id}/complete`).send({});
    expect(completed.status).toBe(200);
    expect(completed.body.loyalty.travelledKm).toBe(10_000);
    expect(completed.body.rewardAvailable).toBe(true);
    expect((await adminAgent.post(`/api/admin/bookings/${longBooking.body.booking.id}/complete`).send({})).body.loyalty.travelledKm).toBe(10_000);
    await prisma.user.update({ where: { id: ids.admin }, data: { role: Role.CUSTOMER } });
    expect((await adminAgent.get('/api/admin/overview')).status).toBe(403);

    const rewardHold = await winner.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', `reward-hold-${suffix}-key`).send({ seatIds: [ids.seatB] });
    expect(rewardHold.status).toBe(201);
    holdIds.push(rewardHold.body.hold.id);
    const rewardBooking = await winner.post('/api/loyalty/redeem').set('Idempotency-Key', `reward-booking-${suffix}-key`).send({ holdId: rewardHold.body.hold.id });
    expect(rewardBooking.status).toBe(201);
    bookingIds.push(rewardBooking.body.booking.id);
    expect(rewardBooking.body.booking.totalPaise).toBe(0);
    expect((await winner.get('/api/loyalty')).body.rewardAvailable).toBe(false);
    expect((await winner.post('/api/loyalty/redeem').set('Idempotency-Key', `reward-again-${suffix}-key`).send({ holdId: rewardHold.body.hold.id })).status).toBe(409);

    expect((await winner.post('/api/auth/logout').send({})).status).toBe(204);
    expect((await winner.get('/api/auth/me')).status).toBe(401);
  }, 60_000);
});
