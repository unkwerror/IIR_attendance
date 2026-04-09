import { pool } from './db.js';
import { config } from '../config.js';
import { cleanupExpiredTokens } from './auth.js';

const DELETE_EXPIRED_QR_SQL = `
  delete from qr_tokens
  where ctid in (
    select ctid
    from qr_tokens
    where expires_at < now()
    order by expires_at asc
    limit $1
  )
`;

export async function runCleanup() {
  let cleaned = 0;
  try {
    const { rowCount } = await pool.query(
      DELETE_EXPIRED_QR_SQL,
      [config.maintenance.cleanupBatchSize]
    );
    cleaned += rowCount || 0;
    if (rowCount > 0) {
      console.log(`[maintenance] cleaned expired qr_tokens: ${rowCount}`);
    }
  } catch (e) {
    console.error('[maintenance] qr cleanup error', e.message);
  }
  try {
    const teacherCleaned = await cleanupExpiredTokens();
    cleaned += teacherCleaned;
    if (teacherCleaned > 0) {
      console.log(`[maintenance] cleaned expired teacher_tokens: ${teacherCleaned}`);
    }
  } catch (_) {}
  return cleaned;
}

let lastInlineCleanup = 0;
const INLINE_COOLDOWN_MS = 30_000;

export async function maybeInlineCleanup() {
  const now = Date.now();
  if (now - lastInlineCleanup < INLINE_COOLDOWN_MS) return;
  if (Math.random() > 0.05) return;
  lastInlineCleanup = now;
  runCleanup().catch(() => {});
}

export function startMaintenanceJobs() {
  if (!config.maintenance.enabled) return;
  runCleanup();
  const timer = setInterval(runCleanup, config.maintenance.cleanupEveryMs);
  if (typeof timer.unref === 'function') timer.unref();
}
