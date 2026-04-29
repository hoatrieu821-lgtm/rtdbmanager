import fetch from 'node-fetch';
import { getDatabase } from 'firebase-admin/database';
import { getApp, withTimeout } from './firebase.js';

const MAX_RESPONSE_BYTES = 500 * 1024;
const FORBIDDEN_KEY_CHARS = /[.#$\[\]\u0000-\u001f\u007f]/;

/**
 * Normalizes and validates a Firebase RTDB path.
 * @param {string} input Path input.
 * @returns {string} Normalized path without leading slash.
 */
export function normalizePath(input = '/') {
  const raw = String(input || '/').trim();
  if (raw === '/' || raw === '') {
    return '';
  }

  const segments = raw
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean);

  for (const segment of segments) {
    if (segment === '.' || segment === '..' || FORBIDDEN_KEY_CHARS.test(segment)) {
      const error = new Error(`Invalid RTDB path segment: ${segment}`);
      error.code = 'INVALID_PATH';
      throw error;
    }
  }

  return segments.join('/');
}

/**
 * Returns a display path with a leading slash.
 * @param {string} path Normalized path.
 * @returns {string} Display path.
 */
export function displayPath(path) {
  const normalized = normalizePath(path);
  return normalized ? `/${normalized}` : '/';
}

/**
 * Determines the JSON value type.
 * @param {*} value Value.
 * @returns {string} JSON type label.
 */
export function typeOfData(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Returns the UTF-8 JSON size for a value.
 * @param {*} value Value.
 * @returns {number} Approximate bytes.
 */
export function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
}

/**
 * Paginates a large object by key while keeping the payload under the limit.
 * @param {*} value Value to paginate.
 * @param {string|null} startAfter Key to start after.
 * @param {number} maxBytes Max payload bytes.
 * @returns {{data: *, truncated: boolean, nextKey: string|null}} Pagination result.
 */
export function paginateIfNeeded(value, startAfter = null, maxBytes = MAX_RESPONSE_BYTES) {
  if (jsonSize(value) <= maxBytes || value === null || typeof value !== 'object') {
    return { data: value, truncated: false, nextKey: null };
  }

  const keys = Object.keys(value).sort();
  const page = Array.isArray(value) ? [] : {};
  let truncated = false;
  let nextKey = null;

  for (const key of keys) {
    if (startAfter && key <= startAfter) {
      continue;
    }

    const candidate = Array.isArray(value)
      ? [...page, value[key]]
      : { ...page, [key]: value[key] };

    if (jsonSize(candidate) > maxBytes && Object.keys(page).length > 0) {
      truncated = true;
      nextKey = key;
      break;
    }

    page[key] = value[key];
  }

  return { data: page, truncated, nextKey };
}

/**
 * Builds a Firebase REST URL for secret-mode projects.
 * @param {string} databaseUrl RTDB database URL.
 * @param {string} path RTDB path.
 * @param {Record<string, string>} query Query params.
 * @returns {URL} REST URL.
 */
function buildRestUrl(databaseUrl, path, query = {}) {
  const base = String(databaseUrl).replace(/\/+$/, '');
  const normalized = normalizePath(path);
  const encodedPath = normalized.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  const url = new URL(`${base}${encodedPath ? `/${encodedPath}.json` : '/.json'}`);

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

/**
 * Performs a Firebase REST request with timeout.
 * @param {object} project Project config with plaintext secret.
 * @param {string} path RTDB path.
 * @param {object} options Request options.
 * @returns {Promise<*>} Parsed JSON response.
 */
async function restRequest(project, path, options = {}) {
  if (!project.secret) {
    const error = new Error('Project is missing a database secret.');
    error.code = 'MISSING_SECRET';
    throw error;
  }

  const {
    method = 'GET',
    body = undefined,
    timeoutMs = 10_000,
    shallow = false
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = buildRestUrl(project.databaseUrl, path, {
    auth: project.secret,
    shallow: shallow ? 'true' : undefined
  });

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const error = new Error(payload?.error || `Firebase REST request failed with ${response.status}`);
      error.code = response.status === 401 || response.status === 403 ? 'FIREBASE_AUTH_FAILED' : 'FIREBASE_REST_ERROR';
      error.status = response.status;
      throw error;
    }

    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error('Cannot reach database after 10s');
      timeoutError.code = 'CONNECTION_TIMEOUT';
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Reads data from a managed RTDB project.
 * @param {object} project Project config with plaintext credentials or secret.
 * @param {string} path RTDB path.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @returns {Promise<*>} RTDB value.
 */
export async function readData(project, path = '/', timeoutMs = 10_000) {
  const normalized = normalizePath(path);

  if (project.credentialsJson) {
    const app = getApp(project);
    const snapshot = await withTimeout(
      getDatabase(app).ref(normalized || '/').once('value'),
      timeoutMs,
      'Cannot reach database after 10s'
    );
    return snapshot.val();
  }

  return restRequest(project, normalized, { method: 'GET', timeoutMs });
}

/**
 * Sets data at a managed RTDB path.
 * @param {object} project Project config with plaintext credentials or secret.
 * @param {string} path RTDB path.
 * @param {*} value Value to set.
 * @returns {Promise<void>} Resolves when saved.
 */
export async function setData(project, path, value) {
  const normalized = normalizePath(path);

  if (project.credentialsJson) {
    const app = getApp(project);
    await withTimeout(
      getDatabase(app).ref(normalized || '/').set(value),
      10_000,
      'Cannot reach database after 10s'
    );
    return;
  }

  await restRequest(project, normalized, { method: 'PUT', body: value });
}

/**
 * Updates object data at a managed RTDB path.
 * @param {object} project Project config with plaintext credentials or secret.
 * @param {string} path RTDB path.
 * @param {object} value Object patch.
 * @returns {Promise<void>} Resolves when updated.
 */
export async function updateData(project, path, value) {
  const normalized = normalizePath(path);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('PATCH value must be an object.');
    error.code = 'INVALID_VALUE';
    throw error;
  }

  if (project.credentialsJson) {
    const app = getApp(project);
    await withTimeout(
      getDatabase(app).ref(normalized || '/').update(value),
      10_000,
      'Cannot reach database after 10s'
    );
    return;
  }

  await restRequest(project, normalized, { method: 'PATCH', body: value });
}

/**
 * Deletes data at a managed RTDB path.
 * @param {object} project Project config with plaintext credentials or secret.
 * @param {string} path RTDB path.
 * @returns {Promise<void>} Resolves when deleted.
 */
export async function deleteData(project, path) {
  const normalized = normalizePath(path);

  if (project.credentialsJson) {
    const app = getApp(project);
    await withTimeout(
      getDatabase(app).ref(normalized || '/').remove(),
      10_000,
      'Cannot reach database after 10s'
    );
    return;
  }

  await restRequest(project, normalized, { method: 'DELETE' });
}

/**
 * Tests connectivity to a managed RTDB project.
 * @param {object} project Project config with plaintext credentials or secret.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @returns {Promise<{ok: boolean, rootKeys: string[], error?: string, message?: string}>} Test result.
 */
export async function testProjectConnection(project, timeoutMs = 5_000) {
  try {
    let value;

    if (project.credentialsJson) {
      const app = getApp(project);
      const snapshot = await withTimeout(
        getDatabase(app).ref('/').limitToFirst(20).once('value'),
        timeoutMs,
        'Cannot reach database after 5s'
      );
      value = snapshot.val();
    } else {
      value = await restRequest(project, '/', {
        method: 'GET',
        timeoutMs,
        shallow: true
      });
    }

    return {
      ok: true,
      rootKeys: value && typeof value === 'object' ? Object.keys(value).slice(0, 20) : []
    };
  } catch (error) {
    return {
      ok: false,
      error: error.code || 'CONNECTION_FAILED',
      message: error.code === 'CONNECTION_TIMEOUT'
        ? 'Cannot reach database after 5s'
        : error.message
    };
  }
}
