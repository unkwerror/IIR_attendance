import { Router } from 'express';
import { pool } from '../services/db.js';
import { appendAttendanceRow } from '../services/sheets.js';
import { genId, isValidId } from '../util/id.js';
import { config } from '../config.js';
import { checkGenericLimit, recordGenericLimit } from '../services/rateLimit.js';

const router = Router();
const LIMIT_NAME = 'api-attendances';

router.post('/api/attendances', async (req, res) => {
  const { sessionId, oneTimeToken, fingerprint, studentName, studentGroup } = req.body || {};
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const rateScope = `${sessionId || 'unknown'}:${fingerprint || 'unknown'}`;
  if (!checkGenericLimit(LIMIT_NAME, ip, config.rateLimit.attendancesPerMinute, rateScope)) {
    return res.status(429).json({ error: 'too_many_requests' });
  }
  recordGenericLimit(LIMIT_NAME, ip, rateScope);
  if (!sessionId || !oneTimeToken || !fingerprint || !studentName || !studentGroup) {
    return res.status(400).json({ error: 'required fields missing' });
  }
  const name = String(studentName).trim();
  const group = String(studentGroup).trim();
  const normalizedName = name.toLowerCase();
  const normalizedGroup = group.toLowerCase();
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

  try {
    let sessionSubject = '';
    try {
      const { rows: sRows } = await pool.query('select subject from sessions where id = $1', [sessionId]);
      if (sRows[0]) sessionSubject = sRows[0].subject || '';
    } catch (_) {}

    const id = genId(18);
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [9301, `${sessionId}:${fingerprint}`]);
      await client.query(
        'select pg_advisory_xact_lock($1, hashtext($2))',
        [9302, `${sessionId}:${normalizedName}:${normalizedGroup}`]
      );
      const { rows: tokRows } = await client.query(
        `select token, expires_at, fingerprint from qr_tokens
         where token = $1 and session_id = $2 and is_one_time = true
         for update`,
        [oneTimeToken, sessionId]
      );
      const tokenInfo = tokRows[0];
      if (!tokenInfo || tokenInfo.fingerprint !== fingerprint) {
        await client.query('rollback');
        return res.status(400).json({ error: 'invalid oneTimeToken' });
      }
      if (new Date() > tokenInfo.expires_at) {
        await client.query('rollback');
        return res.status(400).json({ error: 'oneTimeToken expired' });
      }
      const { rows: existFp } = await client.query(
        `select 1 from attendances where session_id = $1 and fingerprint = $2 limit 1`,
        [sessionId, fingerprint]
      );
      if (existFp.length > 0) {
        await client.query('rollback');
        return res.status(403).json({ error: 'already_marked' });
      }
      const { rows: existStudent } = await client.query(
        `select 1 from attendances
         where session_id = $1 and lower(student_name) = lower($2) and lower(student_group) = lower($3) limit 1`,
        [sessionId, name, group]
      );
      if (existStudent.length > 0) {
        await client.query('rollback');
        return res.status(403).json({ error: 'already_marked' });
      }

      const { rows: insRows } = await client.query(
        `insert into attendances (id, session_id, fingerprint, student_name, student_group)
         values ($1,$2,$3,$4,$5)
         returning id, session_id, fingerprint, student_name, student_group, created_at`,
        [id, sessionId, fingerprint, name, group]
      );

      await client.query('delete from qr_tokens where token = $1', [oneTimeToken]);
      await client.query('commit');
      const a = insRows[0];

      appendAttendanceRow({
        createdAt: a.created_at,
        studentName: a.student_name,
        studentGroup: a.student_group,
        sessionSubject
      }).catch(() => {});

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
      await client.query('rollback');
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
