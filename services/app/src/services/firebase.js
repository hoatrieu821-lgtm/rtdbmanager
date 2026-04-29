import { cert, deleteApp, getApp as getNamedApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { config } from '../config.js';

const APP_POOL = new Map();

/**
 * Creates or returns the master Firebase app.
 * @returns {import('firebase-admin/app').App} Firebase Admin app.
 */
function initMasterApp() {
  const existing = getApps().find((app) => app.name === 'master');
  if (existing) {
    return existing;
  }

  return initializeApp({
    credential: cert({
      projectId: config.masterFirebase.projectId,
      clientEmail: config.masterFirebase.clientEmail,
      privateKey: config.masterFirebase.privateKey
    }),
    databaseURL: config.masterFirebase.databaseUrl
  }, 'master');
}

const masterApp = initMasterApp();

/**
 * Gets the master RTDB instance.
 * @returns {import('firebase-admin/database').Database} Master RTDB database.
 */
export function getMasterDb() {
  return getDatabase(masterApp);
}

/**
 * Gets the master Firebase Auth instance.
 * @returns {import('firebase-admin/auth').Auth} Master Firebase Auth instance.
 */
export function getMasterAuth() {
  return getAuth(masterApp);
}

/**
 * Parses and validates a service account JSON string.
 * @param {string|object} credentialsJson Service account JSON.
 * @returns {object} Parsed service account.
 */
export function parseServiceAccount(credentialsJson) {
  const serviceAccount = typeof credentialsJson === 'string'
    ? JSON.parse(credentialsJson)
    : credentialsJson;

  const required = ['project_id', 'client_email', 'private_key'];
  const missing = required.filter((field) => !serviceAccount?.[field]);
  if (missing.length > 0) {
    const error = new Error(`credentials.json is missing required field(s): ${missing.join(', ')}`);
    error.code = 'INVALID_CREDENTIALS';
    throw error;
  }

  return {
    ...serviceAccount,
    private_key: String(serviceAccount.private_key).replace(/\\n/g, '\n')
  };
}

/**
 * Returns an Admin SDK app for a managed project, using a connection pool.
 * @param {object} projectConfig Project config with plaintext credentialsJson.
 * @returns {import('firebase-admin/app').App|null} Firebase app, or null for secret mode.
 */
export function getApp(projectConfig) {
  if (!projectConfig?.credentialsJson) {
    return null;
  }

  const poolKey = projectConfig.id || projectConfig.name || projectConfig.databaseUrl;
  if (APP_POOL.has(poolKey)) {
    return APP_POOL.get(poolKey);
  }

  const serviceAccount = parseServiceAccount(projectConfig.credentialsJson);
  const appName = `project-${poolKey}`;

  let app;
  try {
    app = getNamedApp(appName);
  } catch {
    app = initializeApp({
      credential: cert(serviceAccount),
      databaseURL: projectConfig.databaseUrl
    }, appName);
  }

  APP_POOL.set(poolKey, app);
  return app;
}

/**
 * Removes a project app from the connection pool.
 * @param {string} projectId Project id.
 * @returns {Promise<void>} Resolves when removed.
 */
export async function removeApp(projectId) {
  const app = APP_POOL.get(projectId);
  if (!app) {
    return;
  }

  APP_POOL.delete(projectId);
  await deleteApp(app);
}

/**
 * Races an async Firebase operation with a timeout.
 * @template T
 * @param {Promise<T>} promise Operation promise.
 * @param {number} timeoutMs Timeout in milliseconds.
 * @param {string} message Timeout message.
 * @returns {Promise<T>} Operation result.
 */
export function withTimeout(promise, timeoutMs, message = 'Operation timed out') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(message);
      error.code = 'CONNECTION_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Verifies that the master RTDB is reachable during startup.
 * @returns {Promise<void>} Resolves when reachable.
 */
export async function assertMasterConnection() {
  await withTimeout(
    getMasterDb().ref('/.info/serverTimeOffset').once('value'),
    10_000,
    'Cannot reach master Firebase Realtime Database after 10s'
  );
}

/**
 * Returns the number of pooled Firebase Admin apps.
 * @returns {number} Connection pool size.
 */
export function getPoolSize() {
  return APP_POOL.size;
}
