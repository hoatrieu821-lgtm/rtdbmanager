import session from 'express-session';
import { config } from '../config.js';
import { getMasterDb } from '../services/firebase.js';

const DEFAULT_TTL_MS = 8 * 60 * 60 * 1000;

/**
 * Firebase Realtime Database backed express-session store.
 */
class FirebaseSessionStore extends session.Store {
  /**
   * Creates a Firebase RTDB session store.
   */
  constructor() {
    super();
    this.db = getMasterDb();
  }

  /**
   * Encodes a session id into an RTDB-safe key.
   * @param {string} sid Session id.
   * @returns {string} RTDB-safe key.
   */
  encodeKey(sid) {
    return Buffer.from(sid, 'utf8').toString('base64url');
  }

  /**
   * Loads a session.
   * @param {string} sid Session id.
   * @param {Function} callback Node-style callback.
   * @returns {void}
   */
  get(sid, callback) {
    this.db
      .ref(`/sessions/${this.encodeKey(sid)}`)
      .once('value')
      .then((snapshot) => {
        const record = snapshot.val();
        if (!record) {
          callback(null, null);
          return;
        }

        if (record.expiresAt && record.expiresAt < Date.now()) {
          this.destroy(sid, () => callback(null, null));
          return;
        }

        callback(null, record.session || null);
      })
      .catch((error) => callback(error));
  }

  /**
   * Persists a session.
   * @param {string} sid Session id.
   * @param {object} sess Session object.
   * @param {Function} callback Node-style callback.
   * @returns {void}
   */
  set(sid, sess, callback) {
    const cookieExpires = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : null;
    const expiresAt = Number.isFinite(cookieExpires) ? cookieExpires : Date.now() + DEFAULT_TTL_MS;

    this.db
      .ref(`/sessions/${this.encodeKey(sid)}`)
      .set({ expiresAt, session: sess })
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  /**
   * Deletes a session.
   * @param {string} sid Session id.
   * @param {Function} callback Node-style callback.
   * @returns {void}
   */
  destroy(sid, callback) {
    this.db
      .ref(`/sessions/${this.encodeKey(sid)}`)
      .remove()
      .then(() => callback(null))
      .catch((error) => callback(error));
  }

  /**
   * Refreshes a session expiration.
   * @param {string} sid Session id.
   * @param {object} sess Session object.
   * @param {Function} callback Node-style callback.
   * @returns {void}
   */
  touch(sid, sess, callback) {
    this.set(sid, sess, callback);
  }
}

/**
 * Builds the configured session middleware.
 * @returns {import('express').RequestHandler} Express middleware.
 */
export function createSessionMiddleware() {
  return session({
    name: 'rtdb.sid',
    secret: config.sessionSecret,
    store: new FirebaseSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.appBaseUrl.startsWith('https://'),
      maxAge: DEFAULT_TTL_MS
    }
  });
}

/**
 * Requires a valid server-side session.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 * @returns {void}
 */
export function requireSession(req, res, next) {
  if (req.session?.user?.uid) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    error: 'SESSION_EXPIRED',
    message: 'Session expired'
  });
}
