import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { authRoutes } from './auth/routes.js';
import { apiRoutes } from './routes/api.js';
import type { AppDatabase } from './db/index.js';
import type { ServerConfig } from './config.js';
import { LiveEvents } from './services/events.js';
import type { Simulator } from './services/simulator.js';

export interface CreateAppOptions {
  db: AppDatabase;
  config: ServerConfig;
  events: LiveEvents;
  simulator?: Simulator | null;
}

export function createApp({ db, config, events, simulator }: CreateAppOptions) {
  const app = express();
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      // The SSE stream must not be buffered by a compression layer.
      crossOriginEmbedderPolicy: false,
    }),
  );

  // Firmware posts small JSON; 16 kB leaves room for a future batch of 8 bags.
  app.use(express.json({ limit: '16kb', type: 'application/json' }));
  app.use(cookieParser());

  app.use(
    '/api/auth',
    authRoutes(db, {
      jwtSecret: config.jwtSecret,
      secureCookie: config.secureCookie,
      loginWindowMs: config.loginWindowMs,
      loginAttempts: config.loginAttempts,
    }),
  );
  app.use(
    '/api',
    apiRoutes(db, {
      jwtSecret: config.jwtSecret,
      secureCookie: config.secureCookie,
      events,
      simulator: simulator ?? null,
      simulate: config.simulate,
      offlineAfterMs: config.offlineAfterMs,
    }),
  );
  // Must be registered before the /api 404 catch-all below.
  app.get('/api/health', (_request, response) =>
    response.json({ ok: true, simulate: config.simulate, liveClients: events.size }),
  );

  app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found.' }));

  // In development the Vite dev server hosts the front end and proxies here.
  // In production the built bundle is served from the same origin.
  const webDist = config.webDist;
  if (webDist && fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }));
    app.get(/.*/, (_request, response) => response.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error('Unhandled request error:', error);
    if (response.headersSent) return;
    response.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
