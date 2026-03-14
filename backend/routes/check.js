import { Router } from 'express';
import { pool } from '../services/db.js';
import { haversine } from '../util/haversine.js';
import { genId, isValidId } from '../util/id.js';
import { config } from '../config.js';
import { checkGenericLimit, recordGenericLimit } from '../services/rateLimit.js';

const router = Router();
const LIMIT_NAME = 'api-check';

router.post('/api/check', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!checkGenericLimit(LIMIT_NAME, ip, config.rateLimit.checkPerMinute)) {
    return res.status(429).json({ error: 'too_many_requests' });
  }
  recordGenericLimit(LIMIT_NAME, ip);

  const { sessionId, token, fingerprint, geoLat, geoLng } = req.body || {};
  if (!sessionId || !token || !fingerprint) {
    return res.status(400).json({ error: 'sessionId, token и fingerprint обязательны' });
  }
  if (
    !isValidId(sessionId) ||
    !isValidId(token) ||
    String(fingerprint).length > config.fingerprintMaxLength
  ) {
    return res.status(400).json({ error: 'invalid parameters' });
  }

  try {
    const { rows: sessRows } = await pool.query(
      `select id, subject, geo_lat, geo_lng, geo_radius, fingerprint_required, geo_required, ended_at
       from sessions where id = $1`,
      [sessionId]
    );
    const session = sessRows[0];
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.ended_at) return res.status(400).json({ error: 'session already ended' });

    const { rows: tokRows } = await pool.query(
      `select token, expires_at from qr_tokens
       where token = $1 and session_id = $2 and is_one_time = false`,
      [token, sessionId]
    );
    const tokenInfo = tokRows[0];
    if (!tokenInfo) return res.status(400).json({ error: 'invalid token' });
    if (new Date() > tokenInfo.expires_at) return res.status(400).json({ error: 'token expired' });

    if (session.geo_required && session.geo_lat != null && session.geo_lng != null) {
      if (typeof geoLat !== 'number' || typeof geoLng !== 'number') {
        return res.status(400).json({ error: 'geolocation required' });
      }
      const dist = haversine(geoLat, geoLng, session.geo_lat, session.geo_lng);
      const radius = session.geo_radius || 100;
      if (dist > radius) return res.status(403).json({ error: 'out_of_radius', distance: dist, radius });
    }

    if (session.fingerprint_required) {
      const { rows: existRows } = await pool.query(
        `select 1 from attendances where session_id = $1 and fingerprint = $2 limit 1`,
        [sessionId, fingerprint]
      );
      if (existRows.length > 0) return res.status(403).json({ error: 'already_marked' });
    }

    try {
      const { rows: countRows } = await pool.query(
        `select count(*) as c from qr_tokens where parent_qr_token = $1 and is_one_time = true`,
        [token]
      );
      const count = parseInt(countRows[0]?.c || 0, 10);
      if (count >= config.maxDevicesPerQr) {
        return res.status(403).json({
          error: 'qr_code_overused',
          message: 'Этим кодом уже отметилось слишком много устройств. Отсканируйте свежий QR с экрана.'
        });
      }
    } catch (e) {
      if (e.code !== '42703') throw e;
    }

    const oneTimeToken = genId(20);
    const expiresAt = new Date(Date.now() + config.oneTimeTokenTtlMs);
    await pool.query(
      `insert into qr_tokens (token, session_id, expires_at, fingerprint, is_one_time, parent_qr_token)
       values ($1,$2,$3,$4,true,$5)`,
      [oneTimeToken, sessionId, expiresAt, fingerprint, token]
    );

    res.json({
      ok: true,
      oneTimeToken,
      session: { id: session.id, subject: session.subject }
    });
  } catch (e) {
    console.error('check error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
