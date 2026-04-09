import dotenv from 'dotenv';
dotenv.config();

function toInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function toList(value) {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const isServerless = Boolean(process.env.NETLIFY || process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

export const config = {
  port: toInt(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL,
  trustProxy: process.env.TRUST_PROXY !== 'false',
  corsAllowedOrigins: toList(process.env.CORS_ALLOWED_ORIGINS),
  teacherSecret: process.env.TEACHER_SECRET || '',
  debugDeviceTrace: process.env.DEBUG_DEVICE_TRACE === 'true',
  tokenTtlMs: 24 * 60 * 60 * 1000,
  maxDevicesPerQr: toInt(process.env.MAX_DEVICES_PER_QR, 250),
  antiForwardStrict: process.env.ANTI_FORWARD_STRICT === 'true',
  qrMinRemainingMs: toInt(process.env.QR_MIN_REMAINING_MS, 2000),
  qrTokenLifetimeSec: { min: 5, max: 60 },
  qrTokenGraceSec: toInt(process.env.QR_TOKEN_GRACE_SEC, 30),
  oneTimeTokenTtlMs: toInt(process.env.ONE_TIME_TOKEN_TTL_MS, 10 * 60 * 1000),
  subjectMaxLength: 300,
  studentNameMaxLength: 200,
  studentGroupMaxLength: 80,
  fingerprintMaxLength: 500,
  geoEnforced: process.env.GEO_ENFORCED === 'true',
  localTz: process.env.LOCAL_TZ || 'Asia/Novosibirsk',
  googleSheets: {
    credentials: process.env.GOOGLE_SHEETS_CREDENTIALS,
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
  },
  pool: {
    max: toInt(process.env.POOL_MAX, isServerless ? 1 : 15),
    idleTimeoutMillis: toInt(process.env.POOL_IDLE_TIMEOUT_MS, isServerless ? 10000 : 30000)
  },
  maintenance: {
    enabled: process.env.MAINTENANCE_ENABLED !== 'false',
    cleanupEveryMs: toInt(process.env.MAINTENANCE_CLEANUP_EVERY_MS, 60000),
    cleanupBatchSize: toInt(process.env.MAINTENANCE_CLEANUP_BATCH_SIZE, 5000)
  }
};
