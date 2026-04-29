import express from 'express';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../services/crypto.js';
import { parseServiceAccount, removeApp } from '../services/firebase.js';
import {
  deleteUserProjectRaw,
  exportConfig,
  getUserProjectRaw,
  getUserProjectsRaw,
  hydrateProject,
  importConfig,
  projectToClient,
  saveUserProjectRaw
} from '../services/backup.js';
import { testProjectConnection } from '../services/rtdb.js';

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
 * Sends a consistent non-public route error payload.
 * @param {import('express').Response} res Express response.
 * @param {number} status HTTP status.
 * @param {string} error Error code.
 * @param {string} message Human-readable message.
 * @returns {void}
 */
function sendError(res, status, error, message) {
  res.status(status).json({ ok: false, error, message });
}

/**
 * Validates an RTDB URL.
 * @param {string} value URL string.
 * @returns {string} Normalized URL string.
 */
function validateDatabaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const isRealtimeDatabaseHost = url.hostname.endsWith('firebaseio.com')
      || url.hostname.endsWith('firebasedatabase.app');

    if (!/^https:$/.test(url.protocol) || !isRealtimeDatabaseHost) {
      throw new Error('Database URL must be an https Firebase Realtime Database URL.');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    const error = new Error('databaseUrl must be a valid Firebase Realtime Database URL.');
    error.code = 'INVALID_DATABASE_URL';
    error.status = 400;
    throw error;
  }
}

/**
 * Normalizes credentials JSON from a string or object.
 * @param {string|object|null} value Credentials input.
 * @returns {string|null} Minified credentials JSON or null.
 */
function normalizeCredentialsJson(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  parseServiceAccount(parsed);
  return JSON.stringify(parsed);
}

/**
 * Normalizes a database secret input.
 * @param {string|null} value Secret input.
 * @returns {string|null} Secret or null.
 */
function normalizeSecret(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }

  return String(value).trim();
}

/**
 * Builds a plaintext project candidate from a create request.
 * @param {object} body Request body.
 * @param {string} id Project id.
 * @returns {object} Plaintext project candidate.
 */
function buildCreateCandidate(body, id) {
  const name = String(body.name || '').trim();
  if (!name) {
    const error = new Error('name is required.');
    error.code = 'INVALID_NAME';
    throw error;
  }

  const databaseUrl = validateDatabaseUrl(body.databaseUrl);
  let secret = normalizeSecret(body.secret);
  let credentialsJson = normalizeCredentialsJson(body.credentialsJson);

  if (!secret && !credentialsJson) {
    const error = new Error('Provide either secret or credentialsJson.');
    error.code = 'MISSING_CREDENTIALS';
    throw error;
  }

  let authMode = body.authMode === 'secret' ? 'secret' : credentialsJson ? 'credentials' : 'secret';
  if (authMode === 'secret') {
    if (!secret) {
      const error = new Error('secret is required for secret auth mode.');
      error.code = 'MISSING_SECRET';
      throw error;
    }
    credentialsJson = null;
  } else {
    if (!credentialsJson) {
      const error = new Error('credentialsJson is required for credentials auth mode.');
      error.code = 'MISSING_CREDENTIALS';
      throw error;
    }
    secret = null;
  }

  return { id, name, databaseUrl, authMode, secret, credentialsJson };
}

/**
 * Converts a plaintext project candidate to a stored project.
 * @param {object} candidate Plaintext project.
 * @param {object|null} existing Existing raw project.
 * @returns {object} Raw encrypted project.
 */
function toStoredProject(candidate, existing = null) {
  const now = Date.now();
  return {
    id: candidate.id,
    name: candidate.name,
    databaseUrl: candidate.databaseUrl,
    secret: candidate.secret ? encrypt(candidate.secret) : null,
    credentialsJson: candidate.credentialsJson ? encrypt(candidate.credentialsJson) : null,
    authMode: candidate.authMode,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
}

router.get('/backup/export', asyncHandler(async (req, res) => {
  const backup = await exportConfig(req.session.user.uid);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="rtdb-manager-config-${Date.now()}.json"`);
  res.send(backup);
}));

router.post('/backup/restore', asyncHandler(async (req, res) => {
  const summary = await importConfig(req.session.user.uid, req.body?.backup || req.body);
  res.json({ ok: true, summary });
}));

router.post('/test', asyncHandler(async (req, res) => {
  const id = randomUUID();
  const candidate = buildCreateCandidate(req.body || {}, id);
  const result = await testProjectConnection(candidate, 5_000);
  await removeApp(id);

  if (!result.ok) {
    sendError(res, 400, result.error || 'CONNECTION_FAILED', result.message || 'Connection test failed.');
    return;
  }

  res.json({ ok: true, result });
}));

router.get('/', asyncHandler(async (req, res) => {
  const projects = await getUserProjectsRaw(req.session.user.uid);
  res.json({ ok: true, projects: projects.map((project) => projectToClient(project)) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const id = randomUUID();
  const candidate = buildCreateCandidate(req.body || {}, id);
  const result = await testProjectConnection(candidate, 5_000);
  await removeApp(id);

  if (!result.ok) {
    sendError(res, 400, result.error || 'CONNECTION_FAILED', result.message || 'Connection test failed.');
    return;
  }

  const stored = toStoredProject(candidate);
  await saveUserProjectRaw(req.session.user.uid, stored);
  res.status(201).json({ ok: true, project: projectToClient(stored), test: result });
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const project = await getUserProjectRaw(req.session.user.uid, req.params.id);
  if (!project) {
    sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  res.json({ ok: true, project: projectToClient(project) });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const existing = await getUserProjectRaw(req.session.user.uid, req.params.id);
  if (!existing) {
    sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const body = req.body || {};
  const candidate = {
    id: existing.id,
    name: body.name === undefined ? existing.name : String(body.name || '').trim(),
    databaseUrl: body.databaseUrl === undefined ? existing.databaseUrl : validateDatabaseUrl(body.databaseUrl),
    authMode: body.authMode || existing.authMode,
    secret: Object.prototype.hasOwnProperty.call(body, 'secret')
      ? normalizeSecret(body.secret)
      : existing.secret ? decrypt(existing.secret) : null,
    credentialsJson: Object.prototype.hasOwnProperty.call(body, 'credentialsJson')
      ? normalizeCredentialsJson(body.credentialsJson)
      : existing.credentialsJson ? decrypt(existing.credentialsJson) : null
  };

  if (!candidate.name) {
    sendError(res, 400, 'INVALID_NAME', 'name is required.');
    return;
  }

  if (candidate.authMode === 'secret') {
    if (!candidate.secret) {
      sendError(res, 400, 'MISSING_SECRET', 'secret is required for secret auth mode.');
      return;
    }
    candidate.credentialsJson = null;
  } else {
    candidate.authMode = 'credentials';
    if (!candidate.credentialsJson) {
      sendError(res, 400, 'MISSING_CREDENTIALS', 'credentialsJson is required for credentials auth mode.');
      return;
    }
    candidate.secret = null;
  }

  await removeApp(existing.id);
  const result = await testProjectConnection(candidate, 5_000);
  await removeApp(existing.id);

  if (!result.ok) {
    sendError(res, 400, result.error || 'CONNECTION_FAILED', result.message || 'Connection test failed.');
    return;
  }

  const stored = toStoredProject(candidate, existing);
  await saveUserProjectRaw(req.session.user.uid, stored);
  res.json({ ok: true, project: projectToClient(stored), test: result });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const project = await getUserProjectRaw(req.session.user.uid, req.params.id);
  if (!project) {
    sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  await deleteUserProjectRaw(req.session.user.uid, req.params.id);
  await removeApp(req.params.id);
  res.json({ ok: true });
}));

router.get('/:id/test', asyncHandler(async (req, res) => {
  const project = await getUserProjectRaw(req.session.user.uid, req.params.id);
  if (!project) {
    sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const result = await testProjectConnection(hydrateProject(project), 5_000);
  if (!result.ok) {
    sendError(res, 400, result.error || 'CONNECTION_FAILED', result.message || 'Connection test failed.');
    return;
  }

  res.json({ ok: true, result });
}));

export default router;
