"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.smartBusPrisma ??
    new client_1.PrismaClient({
        log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
    });
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.smartBusPrisma = exports.prisma;
}
