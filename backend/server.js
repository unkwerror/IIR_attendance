import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
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
app.use(express.json());

app.use(healthRoutes);
app.use(authRoutes);
app.use(sessionsRoutes);
app.use(checkRoutes);
app.use(attendancesRoutes);

startMaintenanceJobs();

app.listen(config.port, () => {
  console.log(`NSU attendance backend listening on port ${config.port}`);
});
