import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  pgSsl: process.env.PGSSLMODE === 'disable',
  teacherSecret: process.env.TEACHER_SECRET || '',
  tokenTtlMs: 24 * 60 * 60 * 1000,
  verifyRateWindowMs: 15 * 60 * 1000,
  verifyMaxAttempts: 5,
  maxDevicesPerQr: 45,
  qrTokenLifetimeSec: { min: 5, max: 30 },
  oneTimeTokenTtlMs: 10 * 60 * 1000,
  subjectMaxLength: 300,
  studentNameMaxLength: 200,
  studentGroupMaxLength: 80,
  fingerprintMaxLength: 500,
  localTz: process.env.LOCAL_TZ || 'Asia/Novosibirsk',
  googleSheets: {
    credentials: process.env.GOOGLE_SHEETS_CREDENTIALS,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  },
  rateLimit: {
    checkPerMinute: 120,
    attendancesPerMinute: 60
  },
  pool: {
    max: 20,
    idleTimeoutMillis: 30000
  }
};
