import 'dotenv/config';
import { prisma } from '../src/db';

function istDateKey(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function istMidnight(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000+05:30`);
}

async function main() {
  const demoCities = [
    { id: 'smartbus-demo-city-delhi', name: 'SmartBus Demo Delhi', code: 'SBD' },
    { id: 'smartbus-demo-city-jaipur', name: 'SmartBus Demo Jaipur', code: 'SBJ' },
    { id: 'smartbus-demo-city-agra', name: 'SmartBus Demo Agra', code: 'SBA' },
  ];
  await prisma.city.createMany({ data: demoCities, skipDuplicates: true });

  const demoRoutes = [
    { id: 'smartbus-demo-route-delhi-jaipur', originId: demoCities[0].id, destinationId: demoCities[1].id, distanceKm: 280, baseFarePaise: 85000 },
    { id: 'smartbus-demo-route-delhi-agra', originId: demoCities[0].id, destinationId: demoCities[2].id, distanceKm: 230, baseFarePaise: 70000 },
  ];
  await prisma.route.createMany({ data: demoRoutes, skipDuplicates: true });

  const busId = 'smartbus-demo-bus-express';
  await prisma.bus.createMany({
    data: [{ id: busId, name: 'Demo Intercity Express', operator: 'SmartBus Demo', type: 'AC Seater' }],
    skipDuplicates: true,
  });
  const seats = Array.from({ length: 12 }, (_, index) => {
    const row = Math.floor(index / 2) + 1;
    const side = index % 2 === 0 ? 'A' : 'B';
    return {
      id: `smartbus-demo-seat-${String(index + 1).padStart(2, '0')}`,
      busId,
      number: `${row}${side}`,
      category: index % 2 === 1 ? 'WINDOW' : 'STANDARD',
      premium: index >= 10,
    };
  });
  await prisma.busSeat.createMany({ data: seats, skipDuplicates: true });

  const today = istDateKey(new Date());
  const tomorrow = istMidnight(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const journeyDate = istDateKey(tomorrow);
  const departureAt = new Date(`${journeyDate}T08:00:00.000+05:30`);
  const arrivalJaipur = new Date(departureAt.getTime() + 5 * 60 * 60 * 1000);
  const arrivalAgra = new Date(departureAt.getTime() + 4 * 60 * 60 * 1000);
  const trips = [
    { id: `smartbus-demo-trip-delhi-jaipur-${journeyDate}`, routeId: demoRoutes[0].id, busId, departureAt, arrivalAt: arrivalJaipur, fareMultiplier: 100 },
    { id: `smartbus-demo-trip-delhi-agra-${journeyDate}`, routeId: demoRoutes[1].id, busId, departureAt: new Date(departureAt.getTime() + 2 * 60 * 60 * 1000), arrivalAt: new Date(arrivalAgra.getTime() + 2 * 60 * 60 * 1000), fareMultiplier: 100 },
  ];
  await prisma.trip.createMany({ data: trips, skipDuplicates: true });

  const inventory = trips.flatMap((trip) => seats.map((seat) => ({
    id: `${trip.id}-${seat.id}`,
    tripId: trip.id,
    seatId: seat.id,
    status: 'AVAILABLE' as const,
  })));
  await prisma.tripSeatInventory.createMany({ data: inventory, skipDuplicates: true });
  await prisma.pricingRule.createMany({
    data: trips.map((trip) => ({
      id: `${trip.id}-window-rule`,
      tripId: trip.id,
      seatCategory: 'WINDOW',
      date: istMidnight(journeyDate),
      multiplier: 110,
      version: 1,
      active: true,
    })),
    skipDuplicates: true,
  });

  console.log(`Inserted demo data where missing for journey date ${journeyDate}. Existing rows were preserved.`);
}

main()
  .catch((error: unknown) => {
    console.error('SmartBus demo seed failed. Check database connectivity and schema status.');
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
