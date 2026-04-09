import { Router } from 'express';
import { pool } from '../services/db.js';
import { appendAttendanceRow } from '../services/sheets.js';
import { genId, isValidId } from '../util/id.js';
import { config } from '../config.js';
import { fpShort, hashIp, hashUa } from '../util/format.js';

const router = Router();

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

router.post('/api/attendances', async (req, res) => {
  const { sessionId, oneTimeToken, fingerprint, studentName, studentGroup, deviceId } = req.body || {};
  if (!sessionId || !oneTimeToken || !fingerprint || !studentName || !studentGroup) {
    return res.status(400).json({ error: 'required fields missing' });
  }
  const name = normalizeText(studentName);
  const group = normalizeText(studentGroup);
  if (name.length < 1 || name.length > config.studentNameMaxLength) {
    return res.status(400).json({ error: 'studentName: длина 1–200 символов' });
  }
  if (group.length < 1 || group.length > config.studentGroupMaxLength) {
    return res.status(400).json({ error: 'studentGroup: длина 1–80 символов' });
  }
  if (
    !isValidId(sessionId) ||
    !isValidId(oneTimeToken) ||
    String(fingerprint).length > config.fingerprintMaxLength
  ) {
    return res.status(400).json({ error: 'invalid parameters' });
  }

  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const ua = req.get('user-agent') || '';
  const ipH = hashIp(ip);
  const uaH = hashUa(ua);
  const devId = (typeof deviceId === 'string' && deviceId.length > 0 && deviceId.length <= 200) ? deviceId : null;

  try {
    const id = genId(18);
    const client = await pool.connect();
    try {
      await client.query('begin');

      const { rows: tokRows } = await client.query(
        `select q.token, q.expires_at, q.fingerprint, s.subject
         from qr_tokens q
         join sessions s on s.id = q.session_id
         where q.token = $1 and q.session_id = $2 and q.is_one_time = true
         for update of q`,
        [oneTimeToken, sessionId]
      );
      const tokenInfo = tokRows[0];
      if (!tokenInfo || tokenInfo.fingerprint !== fingerprint) {
        console.log(JSON.stringify({ event: 'attendance_rejected', reason: 'invalid_token', sessionId, fp: fpShort(fingerprint), ip, ts: new Date().toISOString() }));
        await client.query('rollback');
        return res.status(400).json({ error: 'invalid oneTimeToken' });
      }
      if (new Date() > tokenInfo.expires_at) {
        console.log(JSON.stringify({ event: 'attendance_rejected', reason: 'token_expired', sessionId, fp: fpShort(fingerprint), ip, ts: new Date().toISOString() }));
        await client.query('rollback');
        return res.status(400).json({ error: 'oneTimeToken expired' });
      }
      const sessionSubject = tokenInfo.subject || '';

      if (devId) {
        const { rows: devDup } = await client.query(
          `select 1 from attendances where session_id = $1 and device_id = $2 limit 1`,
          [sessionId, devId]
        );
        if (devDup.length > 0) {
          console.log(JSON.stringify({ event: 'attendance_rejected', reason: 'duplicate_device_id', sessionId, fp: fpShort(fingerprint), devId, ip, ts: new Date().toISOString() }));
          await client.query('rollback');
          return res.status(403).json({ error: 'already_marked' });
        }
      }

      const { rows: insRows, rowCount } = await client.query(
        `insert into attendances (id, session_id, fingerprint, student_name, student_group, ip_hash, ua_hash, device_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (session_id, fingerprint) do nothing
         returning id, session_id, fingerprint, student_name, student_group, created_at`,
        [id, sessionId, fingerprint, name, group, ipH, uaH, devId]
      );
      if (rowCount === 0) {
        console.log(JSON.stringify({ event: 'attendance_rejected', reason: 'duplicate_fp', sessionId, fp: fpShort(fingerprint), ip, ts: new Date().toISOString() }));
        await client.query('rollback');
        return res.status(403).json({ error: 'already_marked' });
      }

      await client.query('delete from qr_tokens where token = $1', [oneTimeToken]);
      await client.query('commit');
      const a = insRows[0];

      appendAttendanceRow({
        createdAt: a.created_at,
        studentName: a.student_name,
        studentGroup: a.student_group,
        sessionSubject
      }).catch((err) => console.error('[sheets] append failed:', err.message || err));

      res.status(201).json({
        ok: true,
        attendance: {
          id: a.id,
          sessionId: a.session_id,
          fingerprint: a.fingerprint,
          studentName: a.student_name,
          studentGroup: a.student_group,
          createdAt: a.created_at
        }
      });
    } catch (e) {
      try { await client.query('rollback'); } catch (_) {}
      if (e.code === '23505') {
        return res.status(403).json({ error: 'already_marked' });
      }
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('attendance error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

export default router;
