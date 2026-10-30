import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  smartBusPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.smartBusPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.smartBusPrisma = prisma;
}
