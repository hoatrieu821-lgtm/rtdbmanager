import express from 'express';
import { config } from '../config.js';
import { requireSession } from '../middleware/session.js';
import { getMasterAuth, getMasterDb } from '../services/firebase.js';

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
 * Saves a session and returns a promise.
 * @param {import('express-session').Session & Partial<import('express-session').SessionData>} session Express session.
 * @returns {Promise<void>} Resolves when saved.
 */
function saveSession(session) {
  return new Promise((resolve, reject) => {
    session.save((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Destroys a session and returns a promise.
 * @param {import('express-session').Session & Partial<import('express-session').SessionData>} session Express session.
 * @returns {Promise<void>} Resolves when destroyed.
 */
function destroySession(session) {
  return new Promise((resolve, reject) => {
    session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

/**
 * Checks whether an email is allowed to sign in.
 * @param {string} email User email.
 * @returns {boolean} True when allowed.
 */
function isAllowedEmail(email) {
  const normalized = String(email || '').toLowerCase();
  return config.allowedEmails.includes('*') || config.allowedEmails.includes(normalized);
}

router.get('/firebase-config', (req, res) => {
  const firebaseConfig = {
    apiKey: config.firebaseApiKey,
    authDomain: config.firebaseAuthDomain,
    projectId: config.masterFirebase.projectId,
    databaseURL: config.masterFirebase.databaseUrl
  };

  if (config.firebaseAppId) {
    firebaseConfig.appId = config.firebaseAppId;
  }
  if (config.firebaseMessagingSenderId) {
    firebaseConfig.messagingSenderId = config.firebaseMessagingSenderId;
  }
  if (config.firebaseStorageBucket) {
    firebaseConfig.storageBucket = config.firebaseStorageBucket;
  }

  res.json({ ok: true, config: firebaseConfig });
});

router.post('/login-google', asyncHandler(async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== 'string') {
    res.status(400).json({ ok: false, error: 'INVALID_ID_TOKEN', message: 'idToken is required.' });
    return;
  }

  const decoded = await getMasterAuth().verifyIdToken(idToken);
  if (!decoded.email || !isAllowedEmail(decoded.email)) {
    res.status(403).json({
      ok: false,
      error: 'EMAIL_NOT_ALLOWED',
      message: 'This Google account is not allowed to access RTDB Manager.'
    });
    return;
  }

  const user = {
    uid: decoded.uid,
    email: decoded.email,
    displayName: decoded.name || decoded.email,
    photoURL: decoded.picture || null
  };

  const profileRef = getMasterDb().ref(`/users/${decoded.uid}/profile`);
  const profileSnapshot = await profileRef.once('value');
  const existing = profileSnapshot.val() || {};
  await profileRef.set({
    ...existing,
    ...user,
    createdAt: existing.createdAt || Date.now(),
    updatedAt: Date.now()
  });

  req.session.user = user;
  await saveSession(req.session);

  res.json({ ok: true, user });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  if (req.session) {
    await destroySession(req.session);
  }

  res.clearCookie('rtdb.sid');
  res.json({ ok: true });
}));

router.get('/me', requireSession, (req, res) => {
  res.json({ ok: true, user: req.session.user });
});

router.get('/api-key', requireSession, (req, res) => {
  const reveal = req.query.reveal === 'true';
  const key = reveal ? config.apiSecretKey : `****${config.apiSecretKey.slice(-4)}`;
  res.json({ ok: true, key, revealed: reveal });
});

router.post('/api-key/regenerate', requireSession, (req, res) => {
  res.status(501).json({
    ok: false,
    error: 'ENV_MANAGED_SECRET',
    message: 'API_SECRET_KEY is managed through the .env file. Update .env and restart the container to rotate it.'
  });
});

export default router;
