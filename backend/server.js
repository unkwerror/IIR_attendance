import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './services/db.js';
import { startMaintenanceJobs } from './services/maintenance.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import sessionsRoutes from './routes/sessions.js';
import checkRoutes from './routes/check.js';
import attendancesRoutes from './routes/attendances.js';

const app = express();

if (config.trustProxy) {
  app.set('trust proxy', 1);
}

const allowedOrigins = new Set(config.corsAllowedOrigins);
const corsOptions = allowedOrigins.size === 0
  ? { origin: '*' }
  : {
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) return callback(null, true);
        return callback(null, false);
      }
    };

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({
  type: ['application/json', 'application/*+json', 'text/plain'],
  limit: '256kb'
}));

app.use((req, _res, next) => {
  if (req.ip == null) {
    const h = req.headers;
    const resolved =
      h['x-nf-client-connection-ip'] ||
      h['client-ip'] ||
      (h['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress;
    if (resolved) {
      Object.defineProperty(req, 'ip', { value: resolved, configurable: true });
    }
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms ip=${req.ip}`);
  });
  next();
});

const rlOpts = {
  standardHeaders: true,
  legacyHeaders: false,
  validate: { ip: false },
  keyGenerator: (req) => {
    const ip = req.ip;
    if (!ip) return 'unknown';
    return ipKeyGenerator(ip);
  }
};
app.use('/api/check', rateLimit({ ...rlOpts, windowMs: 60_000, max: 300, message: { error: 'too_many_requests' } }));
app.use('/api/attendances', rateLimit({ ...rlOpts, windowMs: 60_000, max: 150, message: { error: 'too_many_requests' } }));
app.use('/api/verify-teacher', rateLimit({ ...rlOpts, windowMs: 15 * 60_000, max: 5, message: { error: 'too_many_attempts' } }));

app.use(healthRoutes);
app.use(authRoutes);
app.use(sessionsRoutes);
app.use(checkRoutes);
app.use(attendancesRoutes);

const isServerless = Boolean(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

if (!isServerless) {
  startMaintenanceJobs();

  const server = app.listen(config.port, () => {
    console.log(`NSU attendance backend listening on port ${config.port}`);
  });

  function gracefulShutdown(signal) {
    console.log(`[shutdown] ${signal} received, closing server…`);
    server.close(() => {
      console.log('[shutdown] HTTP server closed');
      pool.end().then(() => {
        console.log('[shutdown] DB pool drained');
        process.exit(0);
      }).catch(() => process.exit(1));
    });
    setTimeout(() => {
      console.error('[shutdown] forced exit after 10s');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default app;
