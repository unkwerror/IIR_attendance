import { Router } from 'express';
import * as authService from '../services/auth.js';

const router = Router();

router.post('/api/verify-teacher', async (req, res) => {
  const code = (req.body?.code) ? String(req.body.code).trim() : '';
  if (!authService.isTeacherAuthConfigured()) {
    return res.status(503).json({ error: 'teacher_auth_not_configured' });
  }
  if (!authService.validateTeacherCode(code)) {
    return res.status(401).json({ error: 'invalid_code' });
  }
  const token = await authService.createTeacherToken();
  res.json({ ok: true, token });
});

router.post('/api/check-teacher-token', async (req, res) => {
  const token = (req.body?.token) ? String(req.body.token) : '';
  const valid = await authService.isTeacherTokenValid(token);
  if (!valid) {
    return res.status(401).json({ error: 'invalid_or_expired' });
  }
  res.json({ ok: true });
});

export default router;
