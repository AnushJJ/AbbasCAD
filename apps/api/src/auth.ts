import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { NextFunction, Request, Response } from 'express';
import { Role } from '@prisma/client';
import { HttpError } from './http';
import { prisma } from './db';

export type AuthUser = { id: string; role: Role };
export type AuthenticatedRequest = Request & { authUser?: AuthUser };
export const authCookieName = 'smartbusToken';

export function passwordHash(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || Buffer.byteLength(value) < 32) {
    throw new HttpError(503, 'AUTH_NOT_CONFIGURED', 'Authentication is not configured on this server');
  }
  return value;
}

export function issueToken(user: AuthUser) {
  return jwt.sign({ role: user.role }, secret(), { subject: user.id, expiresIn: '7d' });
}

export function setAuthCookie(response: Response, token: string) {
  response.cookie(authCookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

export function clearAuthCookie(response: Response) {
  response.clearCookie(authCookieName, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api',
  });
}

export function requireAuth(request: Request, _response: Response, next: NextFunction) {
  try {
    const req = request as AuthenticatedRequest;
    const token = req.cookies?.[authCookieName] ??
      (req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]);
    if (!token) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    const decoded = jwt.verify(token, secret()) as JwtPayload & { role?: Role };
    if (typeof decoded.sub !== 'string' || !Object.values(Role).includes(decoded.role as Role)) {
      throw new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired');
    }
    req.authUser = { id: decoded.sub, role: decoded.role as Role };
    next();
  } catch (error) {
    next(error instanceof HttpError ? error : new HttpError(401, 'INVALID_TOKEN', 'Your session is invalid or has expired'));
  }
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  const user = (request as AuthenticatedRequest).authUser;
  if (!user) {
    response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required' } });
    return;
  }
  void prisma.user.findUnique({ where: { id: user.id }, select: { role: true } })
    .then((record) => {
      if (record?.role !== Role.ADMIN) {
        response.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administrator access is required' } });
        return;
      }
      user.role = Role.ADMIN;
      next();
    })
    .catch(next);
}

export { cookieParser };
