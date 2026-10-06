import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AppDatabase } from '../db/index.js';
import { users, type User } from '../db/schema.js';
import { writeActivity } from '../services/beds.js';
import { AUTH_COOKIE, attachUserIfPresent, clearSession, currentUser, publicUser, requireAuth, sessionCookieOptions, SESSION_MAX_AGE_MS } from './middleware.js';

const loginSchema = z
  .object({
    staffId: z.string().trim().min(1).max(32),
    password: z.string().min(1).max(256),
    // The login screen has a role switch, kept from the prototype. It only
    // produces a clearer error message; the role always comes from the database.
    expectedRole: z.enum(['nurse', 'admin']).optional(),
  })
  .strict();

export interface AuthRouteOptions {
  jwtSecret: string;
  secureCookie: boolean;
  loginWindowMs: number;
  loginAttempts: number;
}

export function authRoutes(db: AppDatabase, options: AuthRouteOptions) {
  const router = Router();
  const auth = requireAuth(db, options.jwtSecret, options.secureCookie);

  // Brute-force protection on the only unauthenticated write route.
  const loginLimiter = rateLimit({
    windowMs: options.loginWindowMs,
    limit: options.loginAttempts,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' },
  });

  router.post('/login', loginLimiter, async (request, response) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'Enter your staff ID and password.' });

    const staffId = parsed.data.staffId.toUpperCase();
    const user = db.select().from(users).where(eq(users.staffId, staffId)).limit(1).all()[0];
    // Always run bcrypt so a missing user and a wrong password take the same time.
    const passwordMatches = await compare(parsed.data.password, user?.passwordHash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');

    if (!user?.active || !passwordMatches) {
      return response.status(401).json({ error: 'Staff ID or password is incorrect.' });
    }
    if (parsed.data.expectedRole && parsed.data.expectedRole !== user.role) {
      return response.status(401).json({
        error: `This ID is an ${user.role} account. Switch the role above.`,
      });
    }

    const token = jwt.sign({ role: user.role }, options.jwtSecret, {
      subject: user.id,
      issuer: 'smartiv',
      expiresIn: SESSION_MAX_AGE_MS / 1000,
    });
    response.cookie(AUTH_COOKIE, token, sessionCookieOptions(options.secureCookie));
    writeActivity(db, user.id, 'signed_in', 'Signed in');
    return response.json({ user: publicUser(user) });
  });

  router.post('/logout', attachUserIfPresent(db, options.jwtSecret), (request, response) => {
    void request;
    const user = response.locals.user as User | undefined;
    if (user) writeActivity(db, user.id, 'signed_out', 'Signed out');
    clearSession(response, options.secureCookie);
    return response.status(204).end();
  });

  router.get('/me', auth, (_request, response) => response.json({ user: publicUser(currentUser(response)) }));

  return router;
}
