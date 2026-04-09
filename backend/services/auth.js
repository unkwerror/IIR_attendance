import crypto from 'crypto';
import { config } from '../config.js';
import { pool } from './db.js';

export function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    Buffer.from(b, 'utf8');
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export async function isTeacherTokenValid(token) {
  if (!token || typeof token !== 'string') return false;
  try {
    const { rows } = await pool.query(
      'select 1 from teacher_tokens where token = $1 and expires_at > now() limit 1',
      [token]
    );
    return rows.length > 0;
  } catch (e) {
    console.error('[auth] token check error', e.message);
    return false;
  }
}

export async function createTeacherToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.tokenTtlMs);
  try {
    await pool.query(
      'insert into teacher_tokens (token, expires_at) values ($1, $2)',
      [token, expiresAt]
    );
  } catch (e) {
    console.error('[auth] token create error', e.message);
  }
  return token;
}

export async function cleanupExpiredTokens() {
  try {
    const { rowCount } = await pool.query(
      'delete from teacher_tokens where expires_at < now()'
    );
    return rowCount || 0;
  } catch (_) {
    return 0;
  }
}

export function isTeacherAuthConfigured() {
  return Boolean(config.teacherSecret);
}

export function validateTeacherCode(code) {
  return constantTimeCompare(code, config.teacherSecret);
}
