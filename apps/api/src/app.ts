import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { prisma } from './db';
import { createSearchRouter, SearchDatabase } from './routes/search';
import { createAuthRouter } from './routes/auth';
import { createBookingRouter } from './routes/bookings';
import { createAdminRouter } from './routes/admin';
import { sendError } from './http';
import cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';

export function createApp(database: SearchDatabase = prisma) {
  const app = express();

  app.use(helmet());
  const configuredOrigin = process.env.WEB_ORIGIN;
  const allowedOrigins = new Set([
    configuredOrigin,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
  ].filter((origin): origin is string => Boolean(origin)));
  app.use(cors({ credentials: true, origin: (origin, callback) => callback(null, !origin || allowedOrigins.has(origin)) }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'smartbus-api' });
  });

  app.use('/api', createSearchRouter(database));
  const fullDatabase = database as PrismaClient;
  app.use('/api/auth', createAuthRouter(fullDatabase));
  app.use('/api', createBookingRouter(fullDatabase));
  app.use('/api/admin', createAdminRouter(fullDatabase));
  app.use((_request, response) => {
    response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
  app.use(sendError);

  return app;
}

export const app = createApp();

