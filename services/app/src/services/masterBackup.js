import { decrypt, encrypt } from './crypto.js';
import { getMasterDb } from './firebase.js';

const FORMAT = 'rtdb-manager-master-database-dump';

/**
 * Deep clones JSON-compatible data.
 * @param {*} value Value to clone.
 * @returns {*} Cloned value.
 */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * Converts encrypted project credentials to portable plaintext fields.
 * @param {object} project Stored project record.
 * @returns {object} Portable project record.
 */
function projectToPortable(project) {
  const portable = clone(project);

  if (project.secret) {
    portable.secretPlaintext = decrypt(project.secret);
  }
  if (project.credentialsJson) {
    portable.credentialsJsonPlaintext = decrypt(project.credentialsJson);
  }

  delete portable.secret;
  delete portable.credentialsJson;
  return portable;
}

/**
 * Converts portable plaintext credential fields to encrypted storage fields.
 * @param {object} project Portable project record.
 * @returns {object} Stored project record.
 */
function projectFromPortable(project) {
  const stored = clone(project);

  if (project.secretPlaintext) {
    stored.secret = encrypt(project.secretPlaintext);
  } else {
    stored.secret = null;
  }

  if (project.credentialsJsonPlaintext) {
    stored.credentialsJson = encrypt(project.credentialsJsonPlaintext);
  } else {
    stored.credentialsJson = null;
  }

  delete stored.secretPlaintext;
  delete stored.credentialsJsonPlaintext;
  return stored;
}

/**
 * Converts all users to a portable dump structure.
 * @param {object} users Stored /users tree.
 * @returns {object} Portable users tree.
 */
function usersToPortable(users) {
  const output = {};

  for (const [uid, user] of Object.entries(users || {})) {
    output[uid] = clone(user);
    output[uid].projects = {};

    for (const [projectId, project] of Object.entries(user.projects || {})) {
      output[uid].projects[projectId] = projectToPortable(project);
    }
  }

  return output;
}

/**
 * Converts portable users to stored /users data for the current server.
 * @param {object} users Portable users tree.
 * @returns {{users: object, userCount: number, projectCount: number}} Stored users and counts.
 */
function usersFromPortable(users) {
  const output = {};
  let userCount = 0;
  let projectCount = 0;

  for (const [uid, user] of Object.entries(users || {})) {
    userCount += 1;
    output[uid] = clone(user);
    output[uid].projects = {};

    for (const [projectId, project] of Object.entries(user.projects || {})) {
      projectCount += 1;
      output[uid].projects[projectId] = projectFromPortable(project);
    }
  }

  return { users: output, userCount, projectCount };
}

/**
 * Exports the master database users tree as a portable dump.
 * @param {object} actor Authenticated user performing the dump.
 * @returns {Promise<object>} Portable master dump.
 */
export async function exportMasterDatabase(actor) {
  const snapshot = await getMasterDb().ref('/users').once('value');
  const users = snapshot.val() || {};
  const portableUsers = usersToPortable(users);
  const projectCount = Object.values(portableUsers)
    .reduce((total, user) => total + Object.keys(user.projects || {}).length, 0);

  return {
    format: FORMAT,
    version: 1,
    exportedAt: Date.now(),
    exportedBy: {
      uid: actor?.uid || null,
      email: actor?.email || null
    },
    portability: {
      sessions: 'excluded',
      credentials: 'plaintext-in-dump-reencrypted-on-restore',
      cryptoKeyIndependent: true,
      sessionSecretIndependent: true
    },
    counts: {
      users: Object.keys(portableUsers).length,
      projects: projectCount
    },
    data: {
      users: portableUsers
    }
  };
}

/**
 * Restores a portable master database dump.
 * @param {object} backup Portable dump.
 * @param {{mode?: 'merge'|'replace', clearSessions?: boolean}} options Restore options.
 * @returns {Promise<{mode: string, users: number, projects: number, sessionsCleared: boolean}>} Restore summary.
 */
export async function restoreMasterDatabase(backup, options = {}) {
  if (!backup || backup.format !== FORMAT || backup.version !== 1 || !backup.data?.users) {
    const error = new Error('Invalid master database dump format.');
    error.code = 'INVALID_MASTER_DUMP';
    error.status = 400;
    throw error;
  }

  const mode = options.mode === 'replace' ? 'replace' : 'merge';
  const { users, userCount, projectCount } = usersFromPortable(backup.data.users);
  const db = getMasterDb();

  if (mode === 'replace') {
    await db.ref('/users').set(users);
  } else {
    const updates = {};
    for (const [uid, user] of Object.entries(users)) {
      updates[`/users/${uid}`] = user;
    }
    await db.ref().update(updates);
  }

  const sessionsCleared = mode === 'replace' || options.clearSessions === true;
  if (sessionsCleared) {
    await db.ref('/sessions').remove();
  }

  return {
    mode,
    users: userCount,
    projects: projectCount,
    sessionsCleared
  };
}
