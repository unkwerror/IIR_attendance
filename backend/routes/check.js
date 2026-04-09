import { Router } from 'express';
import { pool } from '../services/db.js';
import { haversine } from '../util/haversine.js';
import { genId, isValidId } from '../util/id.js';
import { config } from '../config.js';
import { maybeInlineCleanup } from '../services/maintenance.js';
import { fpShort, hashIp, hashUa } from '../util/format.js';

const router = Router();

const BOT_UA_PATTERNS = /Google-Read-Aloud|Googlebot|bingbot|AdsBot|Mediapartners|facebookexternalhit|Twitterbot|LinkedInBot|Slackbot|TelegramBot|WhatsApp|Applebot|okhttp|python-requests|curl|wget|HeadlessChrome|Lighthouse|Viber|Snapchat|Discord|PetalBot|SemrushBot|AhrefsBot|DotBot/i;

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
    if (config.antiForwardStrict) {
      const strictMinRemainingMs = Math.max(
        config.qrMinRemainingMs,
        Math.floor((Number(session.qr_interval) || 15) * 1000 * 0.15)
      );
      if (remainingMs < strictMinRemainingMs) {
        console.log(JSON.stringify({ event: 'check_rejected', reason: 'token_stale', sessionId, ip, remainingMs, ts: new Date().toISOString() }));
        return res.status(400).json({ error: 'token_stale' });
      }
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
      const ipH = hashIp(ip);
      const uaH = hashUa(ua);
      const { rows: existRows } = await pool.query(
        `select 1 from attendances
         where session_id = $1 and (fingerprint = $2 or (ip_hash = $3 and ua_hash = $4))
         limit 1`,
        [sessionId, fingerprint, ipH, uaH]
      );
      if (existRows.length > 0) {
        console.log(JSON.stringify({ event: 'check_rejected', reason: 'already_marked', sessionId, fp: fpShort(fingerprint), ip, ts: new Date().toISOString() }));
        return res.status(403).json({ error: 'already_marked' });
      }
    }

    const { rows: existingTokenRows } = await pool.query(
      `select token from qr_tokens
       where session_id = $1 and parent_qr_token = $2 and fingerprint = $3
         and is_one_time = true and expires_at > now()
       order by expires_at desc limit 1`,
      [sessionId, token, fingerprint]
    );
    if (existingTokenRows[0]?.token) {
      return res.json({ ok: true, oneTimeToken: existingTokenRows[0].token, session: { id: session.id, subject: session.subject } });
    }

    const { rows: countRows } = await pool.query(
      `select count(distinct fingerprint)::int as c from qr_tokens
       where parent_qr_token = $1 and is_one_time = true and expires_at > now()`,
      [token]
    );
    if ((countRows[0]?.c || 0) >= config.maxDevicesPerQr) {
      console.log(JSON.stringify({ event: 'check_rejected', reason: 'qr_overused', sessionId, tokenPrefix: token.slice(0, 8), ip, ts: new Date().toISOString() }));
      return res.status(403).json({
        error: 'qr_code_overused',
        message: 'Этим кодом уже отметилось слишком много устройств. Отсканируйте свежий QR с экрана.'
      });
    }

    const oneTimeToken = genId(20);
    const expiresAt = new Date(Date.now() + config.oneTimeTokenTtlMs);
    let issuedToken = oneTimeToken;
    try {
      await pool.query(
        `insert into qr_tokens (token, session_id, expires_at, fingerprint, is_one_time, parent_qr_token)
         values ($1,$2,$3,$4,true,$5)`,
        [oneTimeToken, sessionId, expiresAt, fingerprint, token]
      );
    } catch (e) {
      if (e.code !== '23505') throw e;
      const { rows: conflictRows } = await pool.query(
        `select token from qr_tokens
         where session_id = $1 and parent_qr_token = $2 and fingerprint = $3
           and is_one_time = true and expires_at > now()
         order by expires_at desc limit 1`,
        [sessionId, token, fingerprint]
      );
      if (!conflictRows[0]?.token) throw e;
      issuedToken = conflictRows[0].token;
    }

    res.json({ ok: true, oneTimeToken: issuedToken, session: { id: session.id, subject: session.subject } });
  } catch (e) {
    console.error('check error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
