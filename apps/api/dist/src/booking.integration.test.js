"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const supertest_1 = __importDefault(require("supertest"));
const vitest_1 = require("vitest");
const app_1 = require("./app");
const auth_1 = require("./auth");
const db_1 = require("./db");
const enabled = Boolean(process.env.DATABASE_URL);
const password = 'SmartBus-Test-Password-2026!';
vitest_1.describe.runIf(enabled)('booking flow against local PostgreSQL', () => {
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
    let agentA;
    let agentB;
    let adminAgent;
    let bookingIds = [];
    let holdIds = [];
    (0, vitest_1.beforeAll)(async () => {
        process.env.JWT_SECRET = 'smartbus-integration-tests-only-secret-2026';
        await db_1.prisma.$connect();
        const start = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const finish = new Date(start.getTime() + 5 * 60 * 60 * 1000);
        await db_1.prisma.city.createMany({ data: [
                { id: ids.cityA, name: `E2E Origin ${suffix}`, code: `A${suffix.slice(-4).toUpperCase()}` },
                { id: ids.cityB, name: `E2E Destination ${suffix}`, code: `B${suffix.slice(-4).toUpperCase()}` },
                { id: ids.cityC, name: `E2E Long Origin ${suffix}`, code: `C${suffix.slice(-4).toUpperCase()}` },
                { id: ids.cityD, name: `E2E Long Destination ${suffix}`, code: `D${suffix.slice(-4).toUpperCase()}` },
            ] });
        await db_1.prisma.route.createMany({ data: [
                { id: ids.routeA, originId: ids.cityA, destinationId: ids.cityB, distanceKm: 180, baseFarePaise: 120000 },
                { id: ids.routeB, originId: ids.cityC, destinationId: ids.cityD, distanceKm: 10000, baseFarePaise: 150000 },
            ] });
        await db_1.prisma.bus.create({ data: { id: ids.bus, name: `E2E Coach ${suffix}`, operator: 'SmartBus Tests', type: 'AC Seater' } });
        await db_1.prisma.busSeat.createMany({ data: [
                { id: ids.seatA, busId: ids.bus, number: '1A', category: 'STANDARD' },
                { id: ids.seatB, busId: ids.bus, number: '1B', category: 'WINDOW' },
                { id: ids.seatC, busId: ids.bus, number: '2A', category: 'PREMIUM', premium: true },
            ] });
        await db_1.prisma.trip.createMany({ data: [
                { id: ids.tripA, routeId: ids.routeA, busId: ids.bus, departureAt: start, arrivalAt: finish, fareMultiplier: 100 },
                { id: ids.tripB, routeId: ids.routeB, busId: ids.bus, departureAt: start, arrivalAt: finish, fareMultiplier: 100 },
            ] });
        await db_1.prisma.tripSeatInventory.createMany({ data: [ids.tripA, ids.tripB].flatMap((tripId) => [ids.seatA, ids.seatB, ids.seatC].map((seatId) => ({ tripId, seatId, status: client_1.TripSeatStatus.AVAILABLE }))) });
        await db_1.prisma.pricingRule.create({ data: { id: ids.pricing, tripId: ids.tripA, seatCategory: 'WINDOW', multiplier: 125 } });
        await db_1.prisma.user.create({ data: { id: ids.admin, username: `admin${suffix.slice(-10)}`, email: `${ids.admin}@example.test`, passwordHash: await (0, auth_1.passwordHash)(password), name: 'Test Admin', role: client_1.Role.ADMIN, loyalty: { create: {} } } });
        agentA = supertest_1.default.agent(app_1.app);
        agentB = supertest_1.default.agent(app_1.app);
        adminAgent = supertest_1.default.agent(app_1.app);
        const users = [
            { agent: agentA, id: ids.userA, name: 'Test Rider A' },
            { agent: agentB, id: ids.userB, name: 'Test Rider B' },
        ];
        for (const { agent, id, name } of users) {
            const registered = await agent.post('/api/auth/register').send({ username: `${name.replace(/\s/g, '').toLowerCase()}${suffix.slice(-8)}`, email: `${id}@example.test`, name, password });
            (0, vitest_1.expect)(registered.status, JSON.stringify(registered.body)).toBe(201);
        }
        const adminLogin = await adminAgent.post('/api/auth/login').send({ email: `${ids.admin}@example.test`, password });
        (0, vitest_1.expect)(adminLogin.status).toBe(200);
    }, 30_000);
    (0, vitest_1.afterAll)(async () => {
        const tripIds = [ids.tripA, ids.tripB];
        let userIds = [];
        try {
            const testUsers = await db_1.prisma.user.findMany({
                where: { email: { in: [ids.userA, ids.userB, ids.admin].map((id) => `${id}@example.test`) } },
                select: { id: true },
            });
            userIds = testUsers.map(({ id }) => id);
            const bookings = await db_1.prisma.booking.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
            const bookingIdsToClean = [...new Set([...bookingIds, ...bookings.map(({ id }) => id)])];
            const holds = await db_1.prisma.seatHold.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
            const holdIdsToClean = [...new Set([...holdIds, ...holds.map(({ id }) => id)])];
            if (bookingIdsToClean.length) {
                const seats = await db_1.prisma.bookingSeat.findMany({ where: { bookingId: { in: bookingIdsToClean } }, select: { id: true } });
                await db_1.prisma.tripSeatInventory.updateMany({ where: { bookingSeatId: { in: seats.map(({ id }) => id) } }, data: { bookingSeatId: null } });
                await db_1.prisma.paymentAttempt.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
                await db_1.prisma.cancellation.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
                await db_1.prisma.completedJourneyRecord.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
                await db_1.prisma.bookingSeat.deleteMany({ where: { bookingId: { in: bookingIdsToClean } } });
                await db_1.prisma.booking.deleteMany({ where: { id: { in: bookingIdsToClean } } });
            }
            if (holdIdsToClean.length) {
                await db_1.prisma.tripSeatInventory.deleteMany({ where: { holdId: { in: holdIdsToClean } } });
                await db_1.prisma.heldSeat.deleteMany({ where: { holdId: { in: holdIdsToClean } } });
                await db_1.prisma.seatHold.deleteMany({ where: { id: { in: holdIdsToClean } } });
            }
            await db_1.prisma.tripSeatInventory.deleteMany({ where: { tripId: { in: tripIds } } });
            await db_1.prisma.rewardRedemption.deleteMany({ where: { userId: { in: userIds } } });
            await db_1.prisma.pricingRule.deleteMany({ where: { id: ids.pricing } });
            await db_1.prisma.auditEvent.deleteMany({ where: { actorId: { in: userIds } } });
            await db_1.prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
            await db_1.prisma.busSeat.deleteMany({ where: { busId: ids.bus } });
            await db_1.prisma.bus.deleteMany({ where: { id: ids.bus } });
            await db_1.prisma.route.deleteMany({ where: { id: { in: [ids.routeA, ids.routeB] } } });
            await db_1.prisma.loyaltyAccount.deleteMany({ where: { userId: { in: userIds } } });
            await db_1.prisma.user.deleteMany({ where: { id: { in: userIds } } });
            await db_1.prisma.city.deleteMany({ where: { id: { in: [ids.cityA, ids.cityB, ids.cityC, ids.cityD] } } });
        }
        finally {
            await db_1.prisma.$disconnect();
        }
    }, 30_000);
    (0, vitest_1.it)('covers auth, seat locking, payment failure, idempotency, cancellation, rewards, and admin authorization', async () => {
        (0, vitest_1.expect)((await (0, supertest_1.default)(app_1.app).post('/api/auth/register').send({ email: 'invalid' })).status).toBe(400);
        (0, vitest_1.expect)((await (0, supertest_1.default)(app_1.app).post('/api/auth/login').send({ email: 'missing@example.test', password })).status).toBe(401);
        (0, vitest_1.expect)((await agentA.get('/api/auth/me')).status).toBe(200);
        (0, vitest_1.expect)((await agentA.patch('/api/auth/profile').send({ name: 'Updated Rider A', phone: '9876543210' })).status).toBe(200);
        (0, vitest_1.expect)((await agentA.get('/api/admin/overview')).status).toBe(403);
        (0, vitest_1.expect)((await agentA.get('/api/admin/cities')).status).toBe(403);
        const initialSeats = (await agentA.get(`/api/trips/${ids.tripA}/seats`)).body.seats;
        (0, vitest_1.expect)(initialSeats).toHaveLength(3);
        (0, vitest_1.expect)(initialSeats.find((seat) => seat.id === ids.seatB).farePaise).toBe(150_000);
        (0, vitest_1.expect)((await agentA.post(`/api/admin/buses/${ids.bus}/seats`).send({ number: '4A', category: 'PREMIUM', premium: true })).status).toBe(403);
        const adminSeat = await adminAgent.post(`/api/admin/buses/${ids.bus}/seats`).send({ number: '4A', category: 'PREMIUM', premium: true });
        (0, vitest_1.expect)(adminSeat.status).toBe(201);
        ids.seatD = adminSeat.body.seat.id;
        (0, vitest_1.expect)((await adminAgent.patch(`/api/admin/buses/${ids.bus}/seats/${ids.seatD}`).send({ number: '4B' })).status).toBe(200);
        const holdRequest = (agent) => agent.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', `hold-${Math.random().toString(36).slice(2)}-key`).send({ seatIds: [ids.seatA] });
        const [holdA, holdB] = await Promise.all([holdRequest(agentA), holdRequest(agentB)]);
        const success = [holdA, holdB].find((result) => result.status === 201);
        const conflict = [holdA, holdB].find((result) => result.status === 409);
        (0, vitest_1.expect)(success.status).toBe(201);
        (0, vitest_1.expect)(conflict.body.error.code).toBe('SEAT_UNAVAILABLE');
        const winner = success === holdA ? agentA : agentB;
        const other = winner === agentA ? agentB : agentA;
        const holdId = success.body.hold.id;
        holdIds.push(holdId);
        const activeSeatKey = `active-seat-${suffix}-key`;
        const activeSeatHold = await other.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', activeSeatKey).send({ seatIds: [ids.seatB] });
        (0, vitest_1.expect)(activeSeatHold.status).toBe(201);
        holdIds.push(activeSeatHold.body.hold.id);
        const holdReplay = await other.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', activeSeatKey).send({ seatIds: [ids.seatB] });
        (0, vitest_1.expect)(holdReplay.status).toBe(200);
        (0, vitest_1.expect)(holdReplay.body.hold.id).toBe(activeSeatHold.body.hold.id);
        (0, vitest_1.expect)((await winner.get(`/api/trips/${ids.tripA}/seats`)).body.seats.find((seat) => seat.id === ids.seatB).available).toBe(false);
        await db_1.prisma.seatHold.update({ where: { id: activeSeatHold.body.hold.id }, data: { status: 'EXPIRED' } });
        (0, vitest_1.expect)((await winner.get(`/api/trips/${ids.tripA}/seats`)).body.seats.find((seat) => seat.id === ids.seatB).available).toBe(true);
        const failedHold = await winner.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', `failure-hold-${suffix}-key`).send({ seatIds: [ids.seatB] });
        (0, vitest_1.expect)(failedHold.status).toBe(201);
        holdIds.push(failedHold.body.hold.id);
        const failed = await winner.post('/api/bookings').set('Idempotency-Key', `failure-${suffix}-key`).send({ holdId: failedHold.body.hold.id, simulateFailure: true });
        (0, vitest_1.expect)(failed.status).toBe(402);
        (0, vitest_1.expect)(failed.body.booking.payment.status).toBe(client_1.PaymentStatus.FAILED);
        bookingIds.push(failed.body.booking.id);
        const afterFailure = await winner.get(`/api/trips/${ids.tripA}/seats`);
        (0, vitest_1.expect)(afterFailure.body.seats.find((seat) => seat.id === ids.seatB).available).toBe(true);
        const bookingKeyA = `booking-a-${suffix}-key`;
        const bookingKeyB = `booking-b-${suffix}-key`;
        const [bookingAttemptA, bookingAttemptB] = await Promise.all([
            winner.post('/api/bookings').set('Idempotency-Key', bookingKeyA).send({ holdId }),
            winner.post('/api/bookings').set('Idempotency-Key', bookingKeyB).send({ holdId }),
        ]);
        const booked = [bookingAttemptA, bookingAttemptB].find((result) => result.status === 201);
        const rejectedDuplicate = [bookingAttemptA, bookingAttemptB].find((result) => result.status === 409);
        const winningBookingKey = booked === bookingAttemptA ? bookingKeyA : bookingKeyB;
        (0, vitest_1.expect)(rejectedDuplicate.body.error.code).toBe('HOLD_INVALID');
        (0, vitest_1.expect)(booked.body.booking.payment.status).toBe(client_1.PaymentStatus.SUCCEEDED);
        (0, vitest_1.expect)(booked.body.booking.status).toBe(client_1.BookingStatus.CONFIRMED);
        bookingIds.push(booked.body.booking.id);
        const replay = await winner.post('/api/bookings').set('Idempotency-Key', winningBookingKey).send({ holdId });
        (0, vitest_1.expect)(replay.status).toBe(200);
        (0, vitest_1.expect)(replay.body.booking.id).toBe(booked.body.booking.id);
        (0, vitest_1.expect)((await winner.get('/api/bookings')).body.bookings.some((item) => item.id === booked.body.booking.id)).toBe(true);
        await db_1.prisma.trip.update({ where: { id: ids.tripA }, data: { departureAt: new Date(Date.now() + 60 * 60 * 1000) } });
        (0, vitest_1.expect)((await winner.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({})).status).toBe(409);
        await db_1.prisma.trip.update({ where: { id: ids.tripA }, data: { departureAt: new Date(Date.now() + 48 * 60 * 60 * 1000), arrivalAt: new Date(Date.now() + 53 * 60 * 60 * 1000) } });
        const cancelled = await winner.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({ reason: 'Test cancellation' });
        (0, vitest_1.expect)(cancelled.status).toBe(200);
        (0, vitest_1.expect)(cancelled.body.cancellation.refundPaise).toBe(booked.body.booking.totalPaise);
        (0, vitest_1.expect)(cancelled.body.booking.payment.status).toBe(client_1.PaymentStatus.REFUNDED);
        (0, vitest_1.expect)((await winner.post(`/api/bookings/${booked.body.booking.id}/cancel`).send({})).body.replayed).toBe(true);
        const longHold = await winner.post(`/api/trips/${ids.tripB}/holds`).set('Idempotency-Key', `long-hold-${suffix}-key`).send({ seatIds: [ids.seatC] });
        (0, vitest_1.expect)(longHold.status).toBe(201);
        holdIds.push(longHold.body.hold.id);
        const longBooking = await winner.post('/api/bookings').set('Idempotency-Key', `long-booking-${suffix}-key`).send({ holdId: longHold.body.hold.id });
        (0, vitest_1.expect)(longBooking.status).toBe(201);
        bookingIds.push(longBooking.body.booking.id);
        await db_1.prisma.trip.update({ where: { id: ids.tripB }, data: { departureAt: new Date(Date.now() - 6 * 60 * 60 * 1000), arrivalAt: new Date(Date.now() - 60 * 60 * 1000) } });
        (0, vitest_1.expect)((await adminAgent.get('/api/admin/overview')).status).toBe(200);
        const completed = await adminAgent.post(`/api/admin/bookings/${longBooking.body.booking.id}/complete`).send({});
        (0, vitest_1.expect)(completed.status).toBe(200);
        (0, vitest_1.expect)(completed.body.loyalty.travelledKm).toBe(10_000);
        (0, vitest_1.expect)(completed.body.rewardAvailable).toBe(true);
        (0, vitest_1.expect)((await adminAgent.post(`/api/admin/bookings/${longBooking.body.booking.id}/complete`).send({})).body.loyalty.travelledKm).toBe(10_000);
        await db_1.prisma.user.update({ where: { id: ids.admin }, data: { role: client_1.Role.CUSTOMER } });
        (0, vitest_1.expect)((await adminAgent.get('/api/admin/overview')).status).toBe(403);
        const rewardHold = await winner.post(`/api/trips/${ids.tripA}/holds`).set('Idempotency-Key', `reward-hold-${suffix}-key`).send({ seatIds: [ids.seatB] });
        (0, vitest_1.expect)(rewardHold.status).toBe(201);
        holdIds.push(rewardHold.body.hold.id);
        const rewardBooking = await winner.post('/api/loyalty/redeem').set('Idempotency-Key', `reward-booking-${suffix}-key`).send({ holdId: rewardHold.body.hold.id });
        (0, vitest_1.expect)(rewardBooking.status).toBe(201);
        bookingIds.push(rewardBooking.body.booking.id);
        (0, vitest_1.expect)(rewardBooking.body.booking.totalPaise).toBe(0);
        (0, vitest_1.expect)((await winner.get('/api/loyalty')).body.rewardAvailable).toBe(false);
        (0, vitest_1.expect)((await winner.post('/api/loyalty/redeem').set('Idempotency-Key', `reward-again-${suffix}-key`).send({ holdId: rewardHold.body.hold.id })).status).toBe(409);
        (0, vitest_1.expect)((await winner.post('/api/auth/logout').send({})).status).toBe(204);
        (0, vitest_1.expect)((await winner.get('/api/auth/me')).status).toBe(401);
    }, 60_000);
});
