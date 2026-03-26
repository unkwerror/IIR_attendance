import { Router } from 'express';
import { pool } from '../services/db.js';
import * as authService from '../services/auth.js';
import { genId, isValidId } from '../util/id.js';
import { config } from '../config.js';

const router = Router();

function getTeacherToken(req) {
  const authHeader = req.get('authorization');
  if (typeof authHeader === 'string') {
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m && m[1]) return m[1].trim();
  }
  if (req.body?.teacherToken) return String(req.body.teacherToken);
  if (req.query?.teacherToken) return String(req.query.teacherToken);
  return '';
}

function requireTeacher(req, res) {
  if (!authService.isTeacherAuthConfigured()) {
    res.status(503).json({ error: 'teacher_auth_not_configured' });
    return false;
  }
  const teacherToken = getTeacherToken(req);
  if (!authService.isTeacherTokenValid(teacherToken)) {
    res.status(403).json({ error: 'teacher_required' });
    return false;
  }
  return true;
}

router.post('/api/sessions', async (req, res) => {
  if (!requireTeacher(req, res)) return;
  const {
    subject,
    qrInterval,
    fingerprintRequired = true
  } = req.body || {};
  if (!subject) {
    return res.status(400).json({ error: 'subject обязателен' });
  }
  const subjectStr = String(subject).trim();
  if (subjectStr.length > config.subjectMaxLength) {
    return res.status(400).json({ error: 'subject слишком длинное' });
  }
  const sessionId = genId(16);
  const qrIntervalCap = Math.min(
    config.qrTokenLifetimeSec.max,
    Math.max(config.qrTokenLifetimeSec.min, Number(qrInterval) || 15)
  );
  try {
    const { rows } = await pool.query(
      `insert into sessions
         (id, subject, qr_interval, geo_lat, geo_lng, geo_radius, fingerprint_required, geo_required)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      [
        sessionId,
        subjectStr,
        qrIntervalCap,
        null,
        null,
        null,
        !!fingerprintRequired,
        false
      ]
    );
    const s = rows[0];
    res.status(201).json({
      sessionId,
      session: {
        id: s.id,
        subject: s.subject,
        qrInterval: s.qr_interval,
        geoLat: s.geo_lat,
        geoLng: s.geo_lng,
        geoRadius: s.geo_radius,
        fingerprintRequired: s.fingerprint_required,
        geoRequired: s.geo_required,
        startedAt: s.started_at,
        endedAt: s.ended_at
      }
    });
  } catch (e) {
    console.error('create session error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/api/sessions/:id/qr-token', async (req, res) => {
  if (!requireTeacher(req, res)) return;
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const { rows } = await pool.query(
      'select id, qr_interval, ended_at from sessions where id = $1',
      [id]
    );
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'session not found' });
    if (session.ended_at) return res.status(400).json({ error: 'session already ended' });
    const token = genId(14);
    const requestedSec = Number(req.body?.lifetimeSec) || session.qr_interval || 15;
    const lifetimeSec = Math.min(
      config.qrTokenLifetimeSec.max,
      Math.max(config.qrTokenLifetimeSec.min, requestedSec)
    );
    const expiresAt = new Date(Date.now() + lifetimeSec * 1000);
    await pool.query(
      `insert into qr_tokens (token, session_id, expires_at, is_one_time) values ($1,$2,$3,false)`,
      [token, id, expiresAt]
    );
    res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    console.error('qr-token error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/api/sessions/:id/attendances', async (req, res) => {
  if (!requireTeacher(req, res)) return;
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const { rows: sessRows } = await pool.query('select id from sessions where id = $1', [id]);
    if (sessRows.length === 0) return res.status(404).json({ error: 'session not found' });
    const { rows } = await pool.query(
      `select id, student_name, student_group, created_at from attendances
       where session_id = $1 order by created_at asc`,
      [id]
    );
    res.json({
      count: rows.length,
      items: rows.map((a) => ({
        id: a.id,
        name: a.student_name,
        group: a.student_group,
        createdAt: a.created_at
      }))
    });
  } catch (e) {
    console.error('list attendances error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/api/sessions/:id/end', async (req, res) => {
  if (!requireTeacher(req, res)) return;
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const { rows } = await pool.query(
      `update sessions set ended_at = now() where id = $1 and ended_at is null returning *`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'session not found or already ended' });
    const s = rows[0];
    res.json({
      ok: true,
      session: {
        id: s.id,
        subject: s.subject,
        qrInterval: s.qr_interval,
        geoLat: s.geo_lat,
        geoLng: s.geo_lng,
        geoRadius: s.geo_radius,
        fingerprintRequired: s.fingerprint_required,
        geoRequired: s.geo_required,
        startedAt: s.started_at,
        endedAt: s.ended_at
      }
    });
  } catch (e) {
    console.error('end session error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
