import { Router } from 'express';
import * as authService from '../services/auth.js';
import * as rateLimit from '../services/rateLimit.js';
import { config } from '../config.js';

const router = Router();

router.post('/api/verify-teacher', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (rateLimit.isVerifyRateLimited(ip)) {
    return res.status(429).json({ error: 'too_many_attempts' });
  }
  const code = (req.body?.code) ? String(req.body.code).trim() : '';
  if (!authService.isTeacherAuthConfigured()) {
    return res.status(503).json({ error: 'teacher_auth_not_configured' });
  }
  if (!authService.validateTeacherCode(code)) {
    rateLimit.recordVerifyAttempt(ip, false);
    return res.status(401).json({ error: 'invalid_code' });
  }
  rateLimit.recordVerifyAttempt(ip, true);
  const token = authService.createTeacherToken();
  res.json({ ok: true, token });
});

router.post('/api/check-teacher-token', (req, res) => {
  const token = (req.body?.token) ? String(req.body.token) : '';
  if (!authService.isTeacherTokenValid(token)) {
    return res.status(401).json({ error: 'invalid_or_expired' });
  }
  res.json({ ok: true });
});

export default router;
