import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import type { AppDatabase } from '../db/index.js';
import { users, type Role, type User } from '../db/schema.js';

export const AUTH_COOKIE = 'smartiv_session';
export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

export interface SessionClaims {
  sub: string;
  role: Role;
}

declare module 'express-serve-static-core' {
  interface Locals {
    user: User;
  }
}

export function currentUser(response: Response): User {
  return response.locals.user;
}

/**
 * Verifies the session cookie on every protected route. The role is re-read
 * from the database rather than trusted from the token, so a demotion or
 * deactivation takes effect immediately instead of at token expiry.
 */
export function requireAuth(db: AppDatabase, jwtSecret: string, secureCookie = false) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = request.cookies?.[AUTH_COOKIE];
    if (typeof token !== 'string' || token.length === 0) {
      return response.status(401).json({ error: 'Sign in to continue.' });
    }
    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(token, jwtSecret, { issuer: 'smartiv' }) as jwt.JwtPayload;
    } catch {
      return clearSession(response, secureCookie).status(401).json({ error: 'Your session has expired. Sign in again.' });
    }
    if (typeof claims.sub !== 'string' || (claims.role !== 'nurse' && claims.role !== 'admin')) {
      return clearSession(response, secureCookie).status(401).json({ error: 'Sign in to continue.' });
    }
    const user = db.select().from(users).where(eq(users.id, claims.sub)).limit(1).all()[0];
    if (!user?.active || user.role !== claims.role) {
      return clearSession(response, secureCookie).status(401).json({ error: 'This account is no longer active.' });
    }
    response.locals.user = user;
    next();
  };
}

/**
 * Populates response.locals.user when a valid session cookie is present and
 * does nothing otherwise. Used by routes like logout that must work both with
 * and without a session.
 */
export function attachUserIfPresent(db: AppDatabase, jwtSecret: string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const token = request.cookies?.[AUTH_COOKIE];
    if (typeof token !== 'string' || token.length === 0) return next();
    try {
      const claims = jwt.verify(token, jwtSecret, { issuer: 'smartiv' }) as jwt.JwtPayload;
      if (typeof claims.sub !== 'string') return next();
      const user = db.select().from(users).where(eq(users.id, claims.sub)).limit(1).all()[0];
      if (user?.active) response.locals.user = user;
    } catch {
      // An invalid token is treated as no session on optional routes.
    }
    next();
  };
}

/**
 * Server-side role gate. Every admin route is mounted behind this, so the
 * check cannot be skipped by calling the API directly.
 */
export function requireAdmin(_request: Request, response: Response, next: NextFunction) {
  if (currentUser(response).role !== 'admin') {
    return response.status(403).json({ error: 'Administrator access required.' });
  }
  next();
}

export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/api',
    maxAge: SESSION_MAX_AGE_MS,
  } as const;
}

export function clearSession(response: Response, secureCookie = false) {
  response.clearCookie(AUTH_COOKIE, {
    ...sessionCookieOptions(secureCookie),
    maxAge: undefined,
  });
  return response;
}

export function publicUser(user: User) {
  return { id: user.id, staffId: user.staffId, name: user.name, role: user.role };
}
