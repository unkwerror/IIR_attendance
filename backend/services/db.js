import pkg from 'pg';
import { config } from '../config.js';

const { Pool } = pkg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.pgSsl ? false : { rejectUnauthorized: false },
  max: config.pool.max,
  idleTimeoutMillis: config.pool.idleTimeoutMillis
});
