import { randomUUID } from 'crypto';
import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  timestamp: () => `,"timestamp":${Date.now()}`
});

/**
 * Adds a request id and writes one structured access log per response.
 * @param {import('express').Request} req Express request.
 * @param {import('express').Response} res Express response.
 * @param {import('express').NextFunction} next Express next callback.
 * @returns {void}
 */
export function requestLogger(req, res, next) {
  const requestId = req.get('X-Request-Id') || randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.locals.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    logger.info({
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      duration: Math.round(duration),
      userId: req.session?.user?.uid || null
    });
  });

  next();
}
