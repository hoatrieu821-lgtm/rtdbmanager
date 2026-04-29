import dotenv from 'dotenv';
import path from 'path';

dotenv.config({
  path: [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../.env'),
    path.resolve(process.cwd(), '../../.env')
  ],
  quiet: true
});

const DEFAULTS = {
  PORT: '3000',
  APP_BASE_URL: 'http://localhost:3000',
  LOG_LEVEL: 'info'
};

const REQUIRED_ENV = [
  'MASTER_FIREBASE_PROJECT_ID',
  'MASTER_FIREBASE_DATABASE_URL',
  'MASTER_FIREBASE_CLIENT_EMAIL',
  'MASTER_FIREBASE_PRIVATE_KEY',
  'SESSION_SECRET',
  'CRYPTO_KEY',
  'FIREBASE_API_KEY',
  'API_SECRET_KEY',
  'ALLOWED_EMAILS'
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key] || !String(process.env[key]).trim());

if (missing.length > 0) {
  console.error(`[config] Missing required environment variables: ${missing.join(', ')}`);
  console.error('[config] Copy .env.example to .env and fill in the Firebase/OAuth/secrets values.');
  process.exit(1);
}

/**
 * Reads an environment variable with a fallback default.
 * @param {string} key Environment variable name.
 * @returns {string} Environment variable value.
 */
function env(key) {
  return process.env[key] || DEFAULTS[key] || '';
}

/**
 * Parses comma-separated emails into a normalized allow list.
 * @param {string} value Comma-separated email addresses.
 * @returns {string[]} Lowercase email list.
 */
function parseAllowedEmails(value) {
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

let appBaseUrl;
try {
  appBaseUrl = new URL(env('APP_BASE_URL'));
} catch (error) {
  console.error(`[config] APP_BASE_URL is invalid: ${env('APP_BASE_URL')}`);
  process.exit(1);
}

export const config = Object.freeze({
  port: Number.parseInt(env('PORT'), 10) || 3000,
  appBaseUrl: appBaseUrl.toString().replace(/\/$/, ''),
  appOrigin: appBaseUrl.origin,
  logLevel: env('LOG_LEVEL'),
  sessionSecret: env('SESSION_SECRET'),
  cryptoKey: env('CRYPTO_KEY'),
  apiSecretKey: env('API_SECRET_KEY'),
  masterBackupPassword: process.env.MASTER_BACKUP_PASSWORD || '',
  firebaseApiKey: env('FIREBASE_API_KEY'),
  firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN || `${env('MASTER_FIREBASE_PROJECT_ID')}.firebaseapp.com`,
  firebaseAppId: process.env.FIREBASE_APP_ID || '',
  firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
  firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
  allowedEmails: parseAllowedEmails(env('ALLOWED_EMAILS')),
  masterFirebase: {
    projectId: env('MASTER_FIREBASE_PROJECT_ID'),
    databaseUrl: env('MASTER_FIREBASE_DATABASE_URL'),
    clientEmail: env('MASTER_FIREBASE_CLIENT_EMAIL'),
    privateKey: env('MASTER_FIREBASE_PRIVATE_KEY').replace(/\\n/g, '\n')
  }
});

export default config;
