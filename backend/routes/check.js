import { Router } from 'express';
import { pool } from '../services/db.js';
import { haversine } from '../util/haversine.js';
import { genId, isValidId } from '../util/id.js';
import { config } from '../config.js';
import { maybeInlineCleanup } from '../services/maintenance.js';
import { fpShort } from '../util/format.js';

const router = Router();

const BOT_UA_PATTERNS = /Google-Read-Aloud|Googlebot|bingbot|AdsBot|Mediapartners|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|TelegramBot|WhatsApp|Applebot/i;

router.post('/api/check', async (req, res) => {
  const ua = req.get('user-agent') || '';
  if (BOT_UA_PATTERNS.test(ua)) {
    return res.status(403).json({ error: 'bot_denied' });
  }
  const { sessionId, token, fingerprint, geoLat, geoLng } = req.body || {};
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  maybeInlineCleanup();
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
  if (config.debugDeviceTrace) {
    console.log(`[trace/check] session=${sessionId} ip=${ip} fp=${fpShort(fingerprint)}`);
  }

  try {
    const { rows: joined } = await pool.query(
      `select s.id, s.subject, s.qr_interval, s.geo_lat, s.geo_lng, s.geo_radius,
              s.fingerprint_required, s.geo_required, s.ended_at,
              q.token as qr_token, q.expires_at as qr_expires_at
       from sessions s
       left join qr_tokens q on q.session_id = s.id
         and q.token = $2 and q.is_one_time = false
       where s.id = $1`,
      [sessionId, token]
    );
    const session = joined[0];
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.ended_at) return res.status(400).json({ error: 'session already ended' });
    if (!session.qr_token) return res.status(400).json({ error: 'invalid token' });
    if (new Date() > session.qr_expires_at) return res.status(400).json({ error: 'token expired' });
    const remainingMs = session.qr_expires_at.getTime() - Date.now();
    const strictMinRemainingMs = Math.max(
      config.qrMinRemainingMs,
      Math.floor((Number(session.qr_interval) || 15) * 1000 * 0.5)
    );
    if (config.antiForwardStrict && remainingMs < strictMinRemainingMs) {
      return res.status(400).json({ error: 'token_stale' });
    }

    if (config.geoEnforced && session.geo_required && session.geo_lat != null && session.geo_lng != null) {
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
      if (existRows.length > 0) {
        if (config.debugDeviceTrace) {
          console.log(`[trace/check] already_marked session=${sessionId} fp=${fpShort(fingerprint)}`);
        }
        return res.status(403).json({ error: 'already_marked' });
      }
    }

    const oneTimeToken = genId(20);
    const expiresAt = new Date(Date.now() + config.oneTimeTokenTtlMs);
    const client = await pool.connect();
    let issuedToken = oneTimeToken;
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [9201, `${sessionId}:${fingerprint}`]);

      try {
        const allowedDevicesPerQr = config.antiForwardStrict ? 1 : config.maxDevicesPerQr;
        const { rows: existingRows } = await client.query(
          `select token from qr_tokens
           where session_id = $1
             and parent_qr_token = $2
             and fingerprint = $3
             and is_one_time = true
             and expires_at > now()
           order by expires_at desc
           limit 1`,
          [sessionId, token, fingerprint]
        );
        if (existingRows[0]?.token) {
          issuedToken = existingRows[0].token;
        }

        const { rows: countRows } = await client.query(
          `select count(distinct fingerprint) as c
           from qr_tokens
           where parent_qr_token = $1 and is_one_time = true and expires_at > now()`,
          [token]
        );
        const count = parseInt(countRows[0]?.c || 0, 10);
        if (!existingRows[0]?.token && count >= allowedDevicesPerQr) {
          await client.query('rollback');
          const errCode = config.antiForwardStrict ? 'qr_forward_blocked' : 'qr_code_overused';
          return res.status(403).json({
            error: errCode,
            message: config.antiForwardStrict
              ? 'Этот QR уже использован другим устройством. Дождитесь обновления кода и сканируйте заново.'
              : 'Этим кодом уже отметилось слишком много устройств. Отсканируйте свежий QR с экрана.'
          });
        }

        if (!existingRows[0]?.token) {
          try {
            await client.query(
              `insert into qr_tokens (token, session_id, expires_at, fingerprint, is_one_time, parent_qr_token)
               values ($1,$2,$3,$4,true,$5)`,
              [oneTimeToken, sessionId, expiresAt, fingerprint, token]
            );
            issuedToken = oneTimeToken;
          } catch (e) {
            if (e.code !== '23505') throw e;
            const { rows: conflictRows } = await client.query(
              `select token from qr_tokens
               where session_id = $1
                 and parent_qr_token = $2
                 and fingerprint = $3
                 and is_one_time = true
                 and expires_at > now()
               order by expires_at desc
               limit 1`,
              [sessionId, token, fingerprint]
            );
            if (!conflictRows[0]?.token) throw e;
            issuedToken = conflictRows[0].token;
          }
        }
      } catch (e) {
        if (e.code !== '42703') throw e;
        await client.query(
          `insert into qr_tokens (token, session_id, expires_at, fingerprint, is_one_time)
           values ($1,$2,$3,$4,true)`,
          [oneTimeToken, sessionId, expiresAt, fingerprint]
        );
        issuedToken = oneTimeToken;
      }
      await client.query('commit');
    } catch (e) {
      try { await client.query('rollback'); } catch (_) {}
      throw e;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      oneTimeToken: issuedToken,
      session: { id: session.id, subject: session.subject }
    });
    if (config.debugDeviceTrace) {
      console.log(`[trace/check] issued session=${sessionId} fp=${fpShort(fingerprint)} token=${fpShort(issuedToken)}`);
    }
  } catch (e) {
    console.error('check error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
