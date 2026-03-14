import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';

import healthRoutes from './routes/health.js';
import authRoutes from './routes/auth.js';
import sessionsRoutes from './routes/sessions.js';
import checkRoutes from './routes/check.js';
import attendancesRoutes from './routes/attendances.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: '*' }));
app.use(express.json());

app.use(healthRoutes);
app.use(authRoutes);
app.use(sessionsRoutes);
app.use(checkRoutes);
app.use(attendancesRoutes);

app.listen(config.port, () => {
  console.log(`NSU attendance backend listening on port ${config.port}`);
});
