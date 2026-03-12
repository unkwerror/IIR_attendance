import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import pkg from 'pg';
import { google } from 'googleapis';

dotenv.config();

const { Pool } = pkg;

// DATABASE_URL должен указывать на PostgreSQL (Supabase/Neon/Railway)
// пример: postgres://user:pass@host:5432/dbname
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }
});

const app = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({ origin: '*'}));
app.use(express.json());

// === Google Sheets client (для учёта посещаемости в таблице) ===
let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;
  const raw = process.env.GOOGLE_SHEETS_CREDENTIALS;
  const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
  if (!raw || !spreadsheetId) return null;

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('Invalid GOOGLE_SHEETS_CREDENTIALS JSON', e);
    return null;
  }

  const jwt = new google.auth.JWT(
    creds.client_email,
    null,
    creds.private_key,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  sheetsClient = {
    sheets: google.sheets({ version: 'v4', auth: jwt }),
    spreadsheetId
  };
  return sheetsClient;
}

// Добавляем строку в Google Sheets: дата, ФИО, группа, мероприятие
async function appendAttendanceToSheet({ createdAt, studentName, studentGroup, sessionSubject }) {
  const client = getSheetsClient();
  if (!client) return; // Sheets не настроены — просто выходим
  const { sheets, spreadsheetId } = client;

  const values = [[
    new Date(createdAt || Date.now()).toISOString(), // дата
    studentName || '',
    studentGroup || '',
    sessionSubject || ''
  ]];

  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'A:D',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('append to Google Sheets error', e);
  }
}

// Простая health‑проверка
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

function genId(len = 24) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// Создание сессии преподавателем
app.post('/api/sessions', async (req, res) => {
  const {
    subject,
    qrInterval,
    geoLat,
    geoLng,
    geoRadius,
    fingerprintRequired = true,
    geoRequired = false
  } = req.body || {};

  if (!subject || !qrInterval) {
    return res.status(400).json({ error: 'subject и qrInterval обязательны' });
  }

  const sessionId = genId(16);
  const values = [
    sessionId,
    subject,
    Number(qrInterval) || 15,
    geoLat ?? null,
    geoLng ?? null,
    geoRadius != null ? Number(geoRadius) : null,
    !!fingerprintRequired,
    !!geoRequired
  ];

  try {
    const { rows } = await pool.query(
      `insert into sessions
         (id, subject, qr_interval, geo_lat, geo_lng, geo_radius,
          fingerprint_required, geo_required)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning *`,
      values
    );
    const sess = rows[0];
    res.status(201).json({
      sessionId,
      session: {
        id: sess.id,
        subject: sess.subject,
        qrInterval: sess.qr_interval,
        geoLat: sess.geo_lat,
        geoLng: sess.geo_lng,
        geoRadius: sess.geo_radius,
        fingerprintRequired: sess.fingerprint_required,
        geoRequired: sess.geo_required,
        startedAt: sess.started_at,
        endedAt: sess.ended_at
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('create session error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Генерация нового QR‑токена для сессии
app.post('/api/sessions/:id/qr-token', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      'select id, qr_interval, ended_at from sessions where id = $1',
      [id]
    );
    const session = rows[0];
    if (!session) {
      return res.status(404).json({ error: 'session not found' });
    }
    if (session.ended_at) {
      return res.status(400).json({ error: 'session already ended' });
    }

    const token = genId(14);
    const lifetimeSec = Number(req.body?.lifetimeSec) || session.qr_interval || 15;
    const expiresAt = new Date(Date.now() + lifetimeSec * 1000);

    await pool.query(
      `insert into qr_tokens (token, session_id, expires_at, is_one_time)
       values ($1,$2,$3,false)`,
      [token, id, expiresAt]
    );

    res.status(201).json({
      token,
      expiresAt: expiresAt.toISOString()
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('qr-token error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Проверка доступа студента по QR (до формы)
app.post('/api/check', async (req, res) => {
  const { sessionId, token, fingerprint, geoLat, geoLng } = req.body || {};

  if (!sessionId || !token || !fingerprint) {
    return res.status(400).json({ error: 'sessionId, token и fingerprint обязательны' });
  }

  try {
    const { rows: sessRows } = await pool.query(
      `select id, subject, geo_lat, geo_lng, geo_radius,
              fingerprint_required, geo_required, ended_at
         from sessions
        where id = $1`,
      [sessionId]
    );
    const session = sessRows[0];
    if (!session) {
      return res.status(404).json({ error: 'session not found' });
    }
    if (session.ended_at) {
      return res.status(400).json({ error: 'session already ended' });
    }

    const { rows: tokRows } = await pool.query(
      `select token, expires_at
         from qr_tokens
        where token = $1 and session_id = $2 and is_one_time = false`,
      [token, sessionId]
    );
    const tokenInfo = tokRows[0];
    if (!tokenInfo) {
      return res.status(400).json({ error: 'invalid token' });
    }
    if (new Date() > tokenInfo.expires_at) {
      return res.status(400).json({ error: 'token expired' });
    }

    // Проверка георадиуса
    if (session.geo_required && session.geo_lat != null && session.geo_lng != null) {
      if (typeof geoLat !== 'number' || typeof geoLng !== 'number') {
        return res.status(400).json({ error: 'geolocation required' });
      }
      const dist = haversine(geoLat, geoLng, session.geo_lat, session.geo_lng);
      const radius = session.geo_radius || 100;
      if (dist > radius) {
        return res.status(403).json({ error: 'out_of_radius', distance: dist, radius });
      }
    }

    // Проверка fingerprint
    if (session.fingerprint_required) {
      const { rows: existRows } = await pool.query(
        `select 1 from attendances
          where session_id = $1 and fingerprint = $2
          limit 1`,
        [sessionId, fingerprint]
      );
      if (existRows.length > 0) {
        return res.status(403).json({ error: 'already_marked' });
      }
    }

    // Раздаём одноразовый токен для формы
    const oneTimeToken = genId(20);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query(
      `insert into qr_tokens (token, session_id, expires_at, fingerprint, is_one_time)
       values ($1,$2,$3,$4,true)`,
      [oneTimeToken, sessionId, expiresAt, fingerprint]
    );

    res.json({
      ok: true,
      oneTimeToken,
      session: {
        id: session.id,
        subject: session.subject
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('check error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Отправка формы студентом
app.post('/api/attendances', async (req, res) => {
  const { sessionId, oneTimeToken, fingerprint, studentName, studentGroup } = req.body || {};

  if (!sessionId || !oneTimeToken || !fingerprint || !studentName || !studentGroup) {
    return res.status(400).json({ error: 'required fields missing' });
  }

  try {
    // Небольшой отдельный запрос, чтобы узнать subject сессии (для Google Sheets)
    let sessionSubject = '';
    try {
      const { rows: sRows } = await pool.query(
        'select subject from sessions where id = $1',
        [sessionId]
      );
      if (sRows[0]) sessionSubject = sRows[0].subject || '';
    } catch (e) {
      // ignore, учёт в БД от этого не ломаем
    }

    const { rows: tokRows } = await pool.query(
      `select token, session_id, expires_at, fingerprint
         from qr_tokens
        where token = $1 and session_id = $2 and is_one_time = true`,
      [oneTimeToken, sessionId]
    );
    const tokenInfo = tokRows[0];
    if (!tokenInfo || tokenInfo.fingerprint !== fingerprint) {
      return res.status(400).json({ error: 'invalid oneTimeToken' });
    }
    if (new Date() > tokenInfo.expires_at) {
      return res.status(400).json({ error: 'oneTimeToken expired' });
    }

    const id = genId(18);
    const name = String(studentName).trim();
    const group = String(studentGroup).trim();

    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: existRows } = await client.query(
        `select 1 from attendances
          where session_id = $1 and fingerprint = $2
          limit 1`,
        [sessionId, fingerprint]
      );
      if (existRows.length > 0) {
        await client.query('rollback');
        return res.status(403).json({ error: 'already_marked' });
      }

      const { rows: insRows } = await client.query(
        `insert into attendances
           (id, session_id, fingerprint, student_name, student_group)
         values ($1,$2,$3,$4,$5)
         returning id, session_id, fingerprint, student_name, student_group, created_at`,
        [id, sessionId, fingerprint, name, group]
      );

      await client.query('delete from qr_tokens where token = $1', [oneTimeToken]);

      await client.query('commit');
      const a = insRows[0];

      // Не блокируем ответ пользователю, если Google Sheets недоступны
      appendAttendanceToSheet({
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
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('attendance error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Список отмеченных студентов для сессии
app.get('/api/sessions/:id/attendances', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: sessRows } = await pool.query(
      'select id from sessions where id = $1',
      [id]
    );
    if (sessRows.length === 0) {
      return res.status(404).json({ error: 'session not found' });
    }
    const { rows } = await pool.query(
      `select id, student_name, student_group, created_at
         from attendances
        where session_id = $1
        order by created_at asc`,
      [id]
    );
    res.json({
      count: rows.length,
      items: rows.map(a => ({
        id: a.id,
        name: a.student_name,
        group: a.student_group,
        createdAt: a.created_at
      }))
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('list attendances error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Завершение сессии
app.post('/api/sessions/:id/end', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `update sessions
          set ended_at = now()
        where id = $1 and ended_at is null
        returning *`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'session not found or already ended' });
    }
    const sess = rows[0];
    res.json({
      ok: true,
      session: {
        id: sess.id,
        subject: sess.subject,
        qrInterval: sess.qr_interval,
        geoLat: sess.geo_lat,
        geoLng: sess.geo_lng,
        geoRadius: sess.geo_radius,
        fingerprintRequired: sess.fingerprint_required,
        geoRequired: sess.geo_required,
        startedAt: sess.started_at,
        endedAt: sess.ended_at
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('end session error', e);
    res.status(500).json({ error: 'internal_error' });
  }
});

// Haversine distance (метры)
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`NSU attendance backend listening on port ${PORT}`);
});

