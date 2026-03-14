import crypto from 'crypto';
import { config } from '../config.js';

const teacherTokens = new Map();

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

function cleanupExpired() {
  const now = Date.now();
  for (const [token, data] of teacherTokens.entries()) {
    if (data.expires < now) teacherTokens.delete(token);
  }
}

export function isTeacherTokenValid(token) {
  if (!token || typeof token !== 'string') return false;
  cleanupExpired();
  const data = teacherTokens.get(token);
  return data && data.expires > Date.now();
}

export function createTeacherToken() {
  const token = crypto.randomBytes(32).toString('hex');
  teacherTokens.set(token, { expires: Date.now() + config.tokenTtlMs });
  return token;
}

export function isTeacherAuthConfigured() {
  return Boolean(config.teacherSecret);
}

export function validateTeacherCode(code) {
  return constantTimeCompare(code, config.teacherSecret);
}
