import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './services/db.js';
import { runCleanup, startMaintenanceJobs } from './services/maintenance.js';

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

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/api/maintenance') return;
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms ip=${req.ip}`);
  });
  next();
});

app.use(healthRoutes);
app.use(authRoutes);
app.use(sessionsRoutes);
app.use(checkRoutes);
app.use(attendancesRoutes);

app.get('/api/maintenance', async (req, res) => {
  const cleaned = await runCleanup();
  res.json({ ok: true, cleaned });
});

const isServerless = Boolean(process.env.NETLIFY || process.env.VERCEL);

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
