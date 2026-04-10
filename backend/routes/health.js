import { Router } from 'express';
import { pool } from '../services/db.js';

const router = Router();

router.get('/health', async (req, res) => {
  try {
    await pool.query({ text: 'select 1', timeout: 3000 });
    res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() });
  } catch (e) {
    console.error('[health] error:', e.message || e);
    res.status(503).json({ status: 'degraded', db: 'error', time: new Date().toISOString() });
  }
});

export default router;
