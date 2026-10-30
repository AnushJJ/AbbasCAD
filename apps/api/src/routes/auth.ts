import { PrismaClient } from '@prisma/client';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AuthenticatedRequest, clearAuthCookie, issueToken, passwordHash, requireAuth, setAuthCookie, verifyPassword } from '../auth';
import { asyncRoute, HttpError } from '../http';

const registerSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/),
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
  password: z.string().min(10).max(128),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
}).strict();

const profileSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(30).optional().or(z.literal('')),
}).strict().refine((value) => Object.keys(value).length > 0, 'Provide at least one profile field');

function publicUser(user: { id: string; username: string; email: string; name: string; phone: string | null; role: string; createdAt: Date }) {
  return { id: user.id, username: user.username, email: user.email, name: user.name, phone: user.phone, role: user.role, createdAt: user.createdAt };
}

export function createAuthRouter(database: PrismaClient) {
  const router = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });

  router.post('/register', authLimiter, asyncRoute(async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Registration details are invalid', parsed.error.issues.map(({ path, message }) => ({ path, message })));
    const data = parsed.data;
    const user = await database.user.create({
      data: {
        username: data.username,
        email: data.email.toLowerCase(),
        name: data.name,
        phone: data.phone || null,
        passwordHash: await passwordHash(data.password),
        loyalty: { create: {} },
      },
    });
    setAuthCookie(response, issueToken({ id: user.id, role: user.role }));
    response.status(201).json({ user: publicUser(user) });
  }));

  router.post('/login', authLimiter, asyncRoute(async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Email or password is invalid');
    const user = await database.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    setAuthCookie(response, issueToken({ id: user.id, role: user.role }));
    response.json({ user: publicUser(user) });
  }));

  router.post('/logout', (_request, response) => {
    clearAuthCookie(response);
    response.status(204).end();
  });

  router.get('/me', requireAuth, asyncRoute(async (request, response) => {
    const user = (request as AuthenticatedRequest).authUser!;
    const profile = await database.user.findUnique({
      where: { id: user.id },
      include: { loyalty: true },
    });
    if (!profile) throw new HttpError(401, 'UNAUTHENTICATED', 'Your account is unavailable');
    response.json({ user: publicUser(profile), loyalty: profile.loyalty });
  }));

  router.patch('/profile', requireAuth, asyncRoute(async (request, response) => {
    const parsed = profileSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Profile details are invalid', parsed.error.issues);
    const user = (request as AuthenticatedRequest).authUser!;
    const updated = await database.user.update({
      where: { id: user.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || null } : {}),
      },
    });
    response.json({ user: publicUser(updated) });
  }));

  return router;
}
