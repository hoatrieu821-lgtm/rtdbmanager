import { createHash, timingSafeEqual } from 'crypto';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

/**
 * Builds the standard API response metadata.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @returns {{requestId: string, timestamp: number}} Response metadata.
 */
function meta(req, res) {
  return {
    requestId: res.locals.requestId || req.requestId || null,
    timestamp: Date.now()
  };
}

/**
 * Compares API keys without leaking timing information.
 * @param {string} provided User supplied key.
 * @param {string} expected Configured key.
 * @returns {boolean} True when the keys match.
 */
function safeEqual(provided, expected) {
  const left = createHash('sha256').update(provided || '').digest();
  const right = createHash('sha256').update(expected || '').digest();
  return timingSafeEqual(left, right);
}

export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({
      ok: false,
      data: null,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many API requests. Please retry later.'
      },
      meta: meta(req, res)
    });
  }
});

/**
 * Requires the X-API-Key header for public API routes.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 * @returns {void}
 */
export function requireApiKey(req, res, next) {
  const apiKey = req.get('X-API-Key') || '';
  if (safeEqual(apiKey, config.apiSecretKey)) {
    next();
    return;
  }

  res.status(401).json({
    ok: false,
    data: null,
    error: {
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid X-API-Key header.'
    },
    meta: meta(req, res)
  });
}
