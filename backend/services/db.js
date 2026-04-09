import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { config } from '../config.js';

neonConfig.webSocketConstructor = ws;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.pool.max,
  idleTimeoutMillis: config.pool.idleTimeoutMillis
});

pool.on('error', (err) => {
  console.error('[pg-pool] unexpected idle client error:', err.message);
});
