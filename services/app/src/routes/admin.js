import express from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { config } from '../config.js';
import { exportMasterDatabase, restoreMasterDatabase } from '../services/masterBackup.js';

export const router = express.Router();

/**
 * Wraps async route handlers.
 * @param {Function} handler Async Express route handler.
 * @returns {import('express').RequestHandler} Express route handler.
 */
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/**
 * Compares passphrases without leaking timing information.
 * @param {string} provided Provided passphrase.
 * @param {string} expected Expected passphrase.
 * @returns {boolean} True when equal.
 */
function safeEqual(provided, expected) {
  const left = createHash('sha256').update(provided || '').digest();
  const right = createHash('sha256').update(expected || '').digest();
  return timingSafeEqual(left, right);
}

/**
 * Requires the master backup password from .env.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {boolean} Whether access is allowed.
 */
function requireMasterBackupPassword(req, res) {
  if (!config.masterBackupPassword) {
    res.status(503).json({
      ok: false,
      error: 'MASTER_BACKUP_DISABLED',
      message: 'MASTER_BACKUP_PASSWORD is not configured.'
    });
    return false;
  }

  if (!safeEqual(req.body?.password, config.masterBackupPassword)) {
    res.status(403).json({
      ok: false,
      error: 'INVALID_MASTER_BACKUP_PASSWORD',
      message: 'Invalid master backup password.'
    });
    return false;
  }

  return true;
}

router.post('/master-dump', asyncHandler(async (req, res) => {
  if (!requireMasterBackupPassword(req, res)) {
    return;
  }

  const dump = await exportMasterDatabase(req.session.user);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="rtdb-manager-master-dump-${Date.now()}.json"`);
  res.send(JSON.stringify(dump, null, 2));
}));

router.post('/master-restore', asyncHandler(async (req, res) => {
  if (!requireMasterBackupPassword(req, res)) {
    return;
  }

  const summary = await restoreMasterDatabase(req.body?.backup, {
    mode: req.body?.mode,
    clearSessions: req.body?.clearSessions === true
  });

  res.json({ ok: true, summary });
}));

export default router;
