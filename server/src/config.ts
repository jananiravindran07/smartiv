import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  port: number;
  databasePath: string;
  jwtSecret: string;
  simulate: boolean;
  secureCookie: boolean;
  nodeEnv: string;
  webDist: string | null;
  loginWindowMs: number;
  loginAttempts: number;
  offlineAfterMs: number;
  readingHistoryLimit: number;
}

function requirePort(value: string | undefined): number {
  const port = Number(value ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port.');
  return port;
}

function optionalPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be set to at least 32 characters. Generate one with: openssl rand -hex 32');
  }
  const nodeEnv = env.NODE_ENV ?? 'development';
  const override = optionalPath(env.WEB_DIST);
  return {
    port: requirePort(env.PORT),
    databasePath: env.DB_PATH ?? './data/smartiv.sqlite',
    jwtSecret,
    // SIMULATE=true stands in for the hardware so the app runs with no units attached.
    simulate: env.SIMULATE === 'true',
    // The session cookie is Secure in production. Set SECURE_COOKIE=false to
    // serve a production build over plain HTTP, which a ward TV on an isolated
    // LAN may need. Leave it unset so the default follows NODE_ENV.
    secureCookie: env.SECURE_COOKIE ? env.SECURE_COOKIE === 'true' : nodeEnv === 'production',
    nodeEnv,
    // In dev the Vite dev server hosts the front end; production serves web/dist.
    webDist: override ?? (nodeEnv === 'production' ? fileURLToPath(new URL('../../web/dist', import.meta.url)) : null),
    loginWindowMs: positiveInt(env.LOGIN_WINDOW_MS, 15 * 60 * 1000),
    loginAttempts: positiveInt(env.LOGIN_ATTEMPTS, 10),
    offlineAfterMs: positiveInt(env.OFFLINE_AFTER_MS, 10_000),
    readingHistoryLimit: positiveInt(env.READING_HISTORY_LIMIT, 300),
  };
}
