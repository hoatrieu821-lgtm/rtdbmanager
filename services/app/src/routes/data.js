import express from 'express';
import { getUserProjectRaw, hydrateProject } from '../services/backup.js';
import {
  deleteData,
  displayPath,
  normalizePath,
  paginateIfNeeded,
  readData,
  setData,
  typeOfData,
  updateData
} from '../services/rtdb.js';

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
 * Sends a consistent route error payload.
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
 * Loads a user-owned project for data access.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {Promise<object|null>} Hydrated project or null.
 */
async function loadProject(req, res) {
  const project = await getUserProjectRaw(req.session.user.uid, req.params.projectId);
  if (!project) {
    sendError(res, 404, 'NOT_FOUND', 'Project not found.');
    return null;
  }

  return hydrateProject(project);
}

router.get('/:projectId/export', asyncHandler(async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const path = normalizePath(req.query.path || '/');
  const data = await readData(project, path);

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="export-${Date.now()}.json"`);
  res.send(JSON.stringify(data, null, 2));
}));

router.get('/:projectId', asyncHandler(async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const path = normalizePath(req.query.path || '/');
  const value = await readData(project, path);
  const page = paginateIfNeeded(value, req.query.startKey || null);

  res.json({
    ok: true,
    path: displayPath(path),
    data: page.data,
    type: typeOfData(value),
    truncated: page.truncated,
    nextKey: page.nextKey
  });
}));

router.put('/:projectId', asyncHandler(async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'value')) {
    sendError(res, 400, 'INVALID_VALUE', 'Body must include value.');
    return;
  }

  const path = normalizePath(req.query.path || '/');
  await setData(project, path, req.body.value);
  res.json({ ok: true, path: displayPath(path) });
}));

router.patch('/:projectId', asyncHandler(async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const path = normalizePath(req.query.path || '/');
  await updateData(project, path, req.body?.value);
  res.json({ ok: true, path: displayPath(path) });
}));

router.delete('/:projectId', asyncHandler(async (req, res) => {
  const project = await loadProject(req, res);
  if (!project) return;

  const path = normalizePath(req.query.path || '/');
  await deleteData(project, path);
  res.json({ ok: true, path: displayPath(path) });
}));

export default router;
