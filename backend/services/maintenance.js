import { pool } from './db.js';
import { config } from '../config.js';

const DELETE_EXPIRED_TOKENS_SQL = `
  delete from qr_tokens
  where ctid in (
    select ctid
    from qr_tokens
    where expires_at < now()
    order by expires_at asc
    limit $1
  )
`;

export function startMaintenanceJobs() {
  if (!config.maintenance.enabled) return;

  const runCleanup = async () => {
    try {
      const { rowCount } = await pool.query(
        DELETE_EXPIRED_TOKENS_SQL,
        [config.maintenance.cleanupBatchSize]
      );
      if (rowCount > 0) {
        console.log(`[maintenance] cleaned expired qr_tokens: ${rowCount}`);
      }
    } catch (e) {
      console.error('[maintenance] cleanup error', e);
    }
  };

  runCleanup();
  const timer = setInterval(runCleanup, config.maintenance.cleanupEveryMs);
  if (typeof timer.unref === 'function') timer.unref();
}
