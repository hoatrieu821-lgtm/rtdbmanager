import express from 'express';
import { randomUUID } from 'crypto';
import { encrypt, decrypt } from '../services/crypto.js';
import { parseServiceAccount, removeApp } from '../services/firebase.js';
import {
  deleteUserProjectRaw,
  exportConfig,
  findProjectRaw,
  getUserProjectRaw,
  getUserProjectsRaw,
  hydrateProject,
  importConfig,
  listAllProjectsRaw,
  projectToClient,
  saveUserProjectRaw
} from '../services/backup.js';
import {
  deleteData,
  displayPath,
  normalizePath,
  paginateIfNeeded,
  readData,
  setData,
  testProjectConnection,
  typeOfData,
  updateData
} from '../services/rtdb.js';

export const router = express.Router();

/**
 * Builds API response metadata.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {{requestId: string, timestamp: number}} Metadata.
 */
function meta(req, res) {
  return {
    requestId: res.locals.requestId || req.requestId || null,
    timestamp: Date.now()
  };
}

/**
 * Sends a successful standard API response.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {*} data Response data.
 * @param {number} status HTTP status.
 * @returns {void}
 */
function ok(req, res, data, status = 200) {
  res.status(status).json({ ok: true, data, error: null, meta: meta(req, res) });
}

/**
 * Sends an error standard API response.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {number} status HTTP status.
 * @param {string} code Error code.
 * @param {string} message Error message.
 * @returns {void}
 */
function fail(req, res, status, code, message) {
  res.status(status).json({
    ok: false,
    data: null,
    error: { code, message },
    meta: meta(req, res)
  });
}

/**
 * Wraps API async handlers with standardized errors.
 * @param {Function} handler Async Express route handler.
 * @returns {import('express').RequestHandler} Express route handler.
 */
function asyncHandler(handler) {
  return (req, res) => Promise.resolve(handler(req, res)).catch((error) => {
    fail(req, res, error.status || 500, error.code || 'INTERNAL_ERROR', error.status ? error.message : 'Internal server error.');
  });
}

/**
 * Returns the target user id from headers, query, or body.
 * @param {import('express').Request} req Express request.
 * @returns {string|null} User id or null.
 */
function getTargetUid(req) {
  return req.get('X-User-Id') || req.query.uid || req.body?.uid || req.body?.ownerUid || null;
}

/**
 * Validates an RTDB URL.
 * @param {string} value URL value.
 * @returns {string} Normalized URL.
 */
function validateDatabaseUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const isRealtimeDatabaseHost = url.hostname.endsWith('firebaseio.com')
      || url.hostname.endsWith('firebasedatabase.app');

    if (!/^https:$/.test(url.protocol) || !isRealtimeDatabaseHost) {
      throw new Error('Invalid databaseUrl.');
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
 * Normalizes credentials JSON.
 * @param {string|object|null} value Credentials input.
 * @returns {string|null} Minified JSON or null.
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
 * Normalizes a secret.
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
 * Builds a plaintext project candidate from request body.
 * @param {object} body Request body.
 * @param {string} id Project id.
 * @returns {object} Plaintext project candidate.
 */
function buildCreateCandidate(body, id) {
  const name = String(body.name || '').trim();
  if (!name) {
    const error = new Error('name is required.');
    error.code = 'INVALID_NAME';
    error.status = 400;
    throw error;
  }

  const databaseUrl = validateDatabaseUrl(body.databaseUrl);
  let secret = normalizeSecret(body.secret);
  let credentialsJson = normalizeCredentialsJson(body.credentialsJson);

  if (!secret && !credentialsJson) {
    const error = new Error('Provide either secret or credentialsJson.');
    error.code = 'MISSING_CREDENTIALS';
    error.status = 400;
    throw error;
  }

  let authMode = body.authMode === 'secret' ? 'secret' : credentialsJson ? 'credentials' : 'secret';
  if (authMode === 'secret') {
    if (!secret) {
      const error = new Error('secret is required for secret auth mode.');
      error.code = 'MISSING_SECRET';
      error.status = 400;
      throw error;
    }
    credentialsJson = null;
  } else {
    if (!credentialsJson) {
      const error = new Error('credentialsJson is required for credentials auth mode.');
      error.code = 'MISSING_CREDENTIALS';
      error.status = 400;
      throw error;
    }
    secret = null;
  }

  return { id, name, databaseUrl, authMode, secret, credentialsJson };
}

/**
 * Converts plaintext project data into encrypted storage data.
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

router.get('/health', asyncHandler(async (req, res) => {
  const projects = await listAllProjectsRaw();
  ok(req, res, {
    ok: true,
    uptime: process.uptime(),
    projectCount: projects.length
  });
}));

router.get('/projects', asyncHandler(async (req, res) => {
  const uid = getTargetUid(req);
  if (uid) {
    const projects = await getUserProjectsRaw(uid);
    ok(req, res, { projects: projects.map((project) => projectToClient(project, { ownerUid: uid })) });
    return;
  }

  const projects = await listAllProjectsRaw();
  ok(req, res, {
    projects: projects.map(({ ownerUid, project }) => projectToClient(project, { ownerUid }))
  });
}));

router.post('/projects', asyncHandler(async (req, res) => {
  const uid = getTargetUid(req);
  if (!uid) {
    fail(req, res, 400, 'MISSING_UID', 'Provide ownerUid in body or X-User-Id header.');
    return;
  }

  const id = randomUUID();
  const candidate = buildCreateCandidate(req.body || {}, id);
  const result = await testProjectConnection(candidate, 5_000);
  await removeApp(id);

  if (!result.ok) {
    fail(req, res, 400, result.error || 'CONNECTION_FAILED', result.message || 'Connection test failed.');
    return;
  }

  const stored = toStoredProject(candidate);
  await saveUserProjectRaw(uid, stored);
  ok(req, res, { project: projectToClient(stored, { ownerUid: uid }), test: result }, 201);
}));

router.get('/projects/:id', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.id, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  ok(req, res, { project: projectToClient(found.project, { ownerUid: found.ownerUid }) });
}));

router.put('/projects/:id', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.id, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const body = req.body || {};
  const existing = found.project;
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

  if (candidate.authMode === 'secret') {
    if (!candidate.secret) {
      fail(req, res, 400, 'MISSING_SECRET', 'secret is required for secret auth mode.');
      return;
    }
    candidate.credentialsJson = null;
  } else {
    candidate.authMode = 'credentials';
    if (!candidate.credentialsJson) {
      fail(req, res, 400, 'MISSING_CREDENTIALS', 'credentialsJson is required for credentials auth mode.');
      return;
    }
    candidate.secret = null;
  }

  await removeApp(existing.id);
  const result = await testProjectConnection(candidate, 5_000);
  await removeApp(existing.id);

  if (!result.ok) {
    fail(req, res, 400, result.error || 'CONNECTION_FAILED', result.message || 'Connection test failed.');
    return;
  }

  const stored = toStoredProject(candidate, existing);
  await saveUserProjectRaw(found.ownerUid, stored);
  ok(req, res, { project: projectToClient(stored, { ownerUid: found.ownerUid }), test: result });
}));

router.delete('/projects/:id', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.id, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  await deleteUserProjectRaw(found.ownerUid, req.params.id);
  await removeApp(req.params.id);
  ok(req, res, { deleted: true });
}));

router.get('/data/:projectId', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.projectId, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const path = normalizePath(req.query.path || '/');
  const value = await readData(hydrateProject(found.project), path);
  const page = paginateIfNeeded(value, req.query.startKey || null);
  ok(req, res, {
    path: displayPath(path),
    data: page.data,
    type: typeOfData(value),
    truncated: page.truncated,
    nextKey: page.nextKey
  });
}));

router.put('/data/:projectId', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.projectId, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const path = normalizePath(req.query.path || '/');
  await setData(hydrateProject(found.project), path, req.body?.value);
  ok(req, res, { path: displayPath(path) });
}));

router.patch('/data/:projectId', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.projectId, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const path = normalizePath(req.query.path || '/');
  await updateData(hydrateProject(found.project), path, req.body?.value);
  ok(req, res, { path: displayPath(path) });
}));

router.delete('/data/:projectId', asyncHandler(async (req, res) => {
  const found = await findProjectRaw(req.params.projectId, getTargetUid(req));
  if (!found) {
    fail(req, res, 404, 'NOT_FOUND', 'Project not found.');
    return;
  }

  const path = normalizePath(req.query.path || '/');
  await deleteData(hydrateProject(found.project), path);
  ok(req, res, { path: displayPath(path) });
}));

router.post('/backup', asyncHandler(async (req, res) => {
  const uid = getTargetUid(req);
  if (!uid) {
    fail(req, res, 400, 'MISSING_UID', 'Provide uid in body/query or X-User-Id header.');
    return;
  }

  const backup = JSON.parse(await exportConfig(uid));
  ok(req, res, { backup });
}));

router.post('/restore', asyncHandler(async (req, res) => {
  const uid = getTargetUid(req);
  if (!uid) {
    fail(req, res, 400, 'MISSING_UID', 'Provide uid in body/query or X-User-Id header.');
    return;
  }

  const summary = await importConfig(uid, req.body?.backup);
  ok(req, res, summary);
}));

export default router;
