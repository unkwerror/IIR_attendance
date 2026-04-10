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

async function requireTeacher(req, res) {
  if (!authService.isTeacherAuthConfigured()) {
    res.status(503).json({ error: 'teacher_auth_not_configured' });
    return false;
  }
  const teacherToken = getTeacherToken(req);
  const valid = await authService.isTeacherTokenValid(teacherToken);
  if (!valid) {
    res.status(403).json({ error: 'teacher_required' });
    return false;
  }
  return true;
}

router.post('/api/sessions', async (req, res) => {
  if (!(await requireTeacher(req, res))) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const subjectRaw = body.subject;
  const qrIntervalRaw = body.qrInterval;
  const fingerprintRequired = body.fingerprintRequired !== undefined
    ? body.fingerprintRequired
    : true;
  const subjectStr = String(subjectRaw || '').trim() || 'Занятие';
  if (subjectStr.length > config.subjectMaxLength) {
    return res.status(400).json({ error: 'subject слишком длинное' });
  }
  const sessionId = genId(16);
  const qrIntervalCap = Math.min(
    config.qrTokenLifetimeSec.max,
    Math.max(config.qrTokenLifetimeSec.min, Number(qrIntervalRaw) || 15)
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
  if (!(await requireTeacher(req, res))) return;
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
    const totalTtlSec = lifetimeSec + (config.qrTokenGraceSec || 0);
    const expiresAt = new Date(Date.now() + totalTtlSec * 1000);
    await pool.query(
      `with deleted as (
         delete from qr_tokens where session_id = $1 and is_one_time = false
       )
       insert into qr_tokens (token, session_id, expires_at, is_one_time)
       values ($2, $1, $3, false)`,
      [id, token, expiresAt]
    );
    res.status(201).json({ token, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    console.error('qr-token error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/api/sessions/:id/attendances', async (req, res) => {
  if (!(await requireTeacher(req, res))) return;
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const { rows } = await pool.query(
      `select a.id, a.student_name, a.student_group, a.created_at, s.id as sid
       from sessions s
       left join attendances a on a.session_id = s.id
       where s.id = $1
       order by a.created_at asc`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'session not found' });
    const items = rows[0].id ? rows.map((a) => ({
      id: a.id,
      name: a.student_name,
      group: a.student_group,
      createdAt: a.created_at
    })) : [];
    res.json({ count: items.length, items });
  } catch (e) {
    console.error('list attendances error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/api/sessions/:id/attendances/csv', async (req, res) => {
  if (!(await requireTeacher(req, res))) return;
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const { rows } = await pool.query(
      `select s.subject, a.student_name, a.student_group, a.created_at, a.id as aid
       from sessions s
       left join attendances a on a.session_id = s.id
       where s.id = $1
       order by a.created_at asc`,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'session not found' });
    const session = { subject: rows[0].subject };
    const attendances = rows[0].aid ? rows : [];
    const escapeCsv = (v) => {
      const s = String(v || '');
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = '\uFEFF№,ФИО,Группа,Время отметки\n';
    const lines = attendances.map((a, i) => {
      const t = new Date(a.created_at).toLocaleString('ru-RU', { timeZone: 'Asia/Novosibirsk' });
      return `${i + 1},${escapeCsv(a.student_name)},${escapeCsv(a.student_group)},${escapeCsv(t)}`;
    }).join('\n');
    const filename = `attendance_${escapeCsv(session.subject)}_${id}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(header + lines);
  } catch (e) {
    console.error('csv export error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/api/sessions/:id/stats', async (req, res) => {
  if (!(await requireTeacher(req, res))) return;
  const { id } = req.params;
  if (!isValidId(id)) return res.status(400).json({ error: 'invalid session id' });
  try {
    const { rows: aggRows } = await pool.query(
      `select s.started_at,
              count(a.id)::int as total,
              min(a.created_at) as first_mark,
              max(a.created_at) as last_mark,
              round(avg(extract(epoch from a.created_at - s.started_at)))::int as avg_delay_sec
       from sessions s
       left join attendances a on a.session_id = s.id
       where s.id = $1
       group by s.id`,
      [id]
    );
    if (aggRows.length === 0) return res.status(404).json({ error: 'session not found' });
    const agg = aggRows[0];
    if (agg.total === 0) {
      return res.json({ total: 0, firstMarkAt: null, lastMarkAt: null, avgDelaySec: 0, timeline: [] });
    }
    const bucketSec = 15;
    const { rows: buckets } = await pool.query(
      `select (width_bucket(
                extract(epoch from a.created_at - s.started_at),
                0,
                extract(epoch from $2::timestamptz - s.started_at) + $3,
                greatest(1, ceil((extract(epoch from $2::timestamptz - s.started_at) + $3) / $3)::int)
              ) - 1) * $3 as offset_sec,
              count(*)::int as cnt
       from attendances a
       join sessions s on s.id = a.session_id
       where a.session_id = $1
       group by offset_sec
       order by offset_sec`,
      [id, agg.last_mark, bucketSec]
    );
    const timeline = buckets.map((b) => ({ offsetSec: b.offset_sec ?? 0, count: b.cnt }));
    res.json({
      total: agg.total,
      firstMarkAt: agg.first_mark ? new Date(agg.first_mark).toISOString() : null,
      lastMarkAt: agg.last_mark ? new Date(agg.last_mark).toISOString() : null,
      avgDelaySec: agg.avg_delay_sec || 0,
      timeline
    });
  } catch (e) {
    console.error('session stats error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.post('/api/sessions/:id/end', async (req, res) => {
  if (!(await requireTeacher(req, res))) return;
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
