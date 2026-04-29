import { decrypt } from './crypto.js';
import { getMasterDb } from './firebase.js';

/**
 * Returns all raw projects for a user.
 * @param {string} uid User id.
 * @returns {Promise<object[]>} Raw project records.
 */
export async function getUserProjectsRaw(uid) {
  const snapshot = await getMasterDb().ref(`/users/${uid}/projects`).once('value');
  const projects = snapshot.val() || {};
  return Object.values(projects);
}

/**
 * Returns one raw project for a user.
 * @param {string} uid User id.
 * @param {string} projectId Project id.
 * @returns {Promise<object|null>} Raw project record.
 */
export async function getUserProjectRaw(uid, projectId) {
  const snapshot = await getMasterDb().ref(`/users/${uid}/projects/${projectId}`).once('value');
  return snapshot.val() || null;
}

/**
 * Saves a raw project for a user.
 * @param {string} uid User id.
 * @param {object} project Raw project record.
 * @returns {Promise<void>} Resolves when saved.
 */
export async function saveUserProjectRaw(uid, project) {
  await getMasterDb().ref(`/users/${uid}/projects/${project.id}`).set(project);
}

/**
 * Deletes a raw project for a user.
 * @param {string} uid User id.
 * @param {string} projectId Project id.
 * @returns {Promise<void>} Resolves when deleted.
 */
export async function deleteUserProjectRaw(uid, projectId) {
  await getMasterDb().ref(`/users/${uid}/projects/${projectId}`).remove();
}

/**
 * Lists all projects across all users for API administration.
 * @returns {Promise<Array<{ownerUid: string, project: object}>>} Project records with owners.
 */
export async function listAllProjectsRaw() {
  const snapshot = await getMasterDb().ref('/users').once('value');
  const users = snapshot.val() || {};
  const output = [];

  for (const [ownerUid, user] of Object.entries(users)) {
    for (const project of Object.values(user.projects || {})) {
      output.push({ ownerUid, project });
    }
  }

  return output;
}

/**
 * Finds a project across users, optionally scoped by uid.
 * @param {string} projectId Project id.
 * @param {string|null} uid Optional owner uid.
 * @returns {Promise<{ownerUid: string, project: object}|null>} Match or null.
 */
export async function findProjectRaw(projectId, uid = null) {
  if (uid) {
    const project = await getUserProjectRaw(uid, projectId);
    return project ? { ownerUid: uid, project } : null;
  }

  const allProjects = await listAllProjectsRaw();
  return allProjects.find((entry) => entry.project.id === projectId) || null;
}

/**
 * Decrypts a raw project for internal RTDB operations.
 * @param {object} project Raw project.
 * @returns {object} Project with plaintext credentials in memory.
 */
export function hydrateProject(project) {
  return {
    ...project,
    secret: project.secret ? decrypt(project.secret) : null,
    credentialsJson: project.credentialsJson ? decrypt(project.credentialsJson) : null
  };
}

/**
 * Masks a secret by showing only its last four characters.
 * @param {string|null} encryptedSecret Encrypted secret.
 * @returns {string|null} Masked secret.
 */
function maskSecret(encryptedSecret) {
  if (!encryptedSecret) {
    return null;
  }

  const secret = decrypt(encryptedSecret);
  return secret ? `****${secret.slice(-4)}` : null;
}

/**
 * Masks service account credentials metadata.
 * @param {string|null} encryptedCredentials Encrypted credentials JSON.
 * @returns {{hasCredentials: boolean, projectId: string|null}} Masked credentials metadata.
 */
function maskCredentials(encryptedCredentials) {
  if (!encryptedCredentials) {
    return { hasCredentials: false, projectId: null };
  }

  try {
    const parsed = JSON.parse(decrypt(encryptedCredentials));
    return {
      hasCredentials: true,
      projectId: parsed.project_id || parsed.projectId || null
    };
  } catch {
    return { hasCredentials: true, projectId: null };
  }
}

/**
 * Converts a raw project to a safe client/API response.
 * @param {object} project Raw project.
 * @param {object} options Formatting options.
 * @returns {object} Safe project.
 */
export function projectToClient(project, options = {}) {
  const safe = {
    id: project.id,
    name: project.name,
    databaseUrl: project.databaseUrl,
    authMode: project.authMode,
    secret: maskSecret(project.secret),
    credentialsJson: maskCredentials(project.credentialsJson),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };

  if (options.ownerUid) {
    safe.ownerUid = options.ownerUid;
  }

  return safe;
}

/**
 * Exports safe project config for one user.
 * @param {string} uid User id.
 * @returns {Promise<string>} JSON backup string.
 */
export async function exportConfig(uid) {
  const projects = await getUserProjectsRaw(uid);
  return JSON.stringify({
    version: 1,
    exportedAt: Date.now(),
    uid,
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      databaseUrl: project.databaseUrl,
      authMode: project.authMode,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      requiresCredentials: true
    }))
  }, null, 2);
}

/**
 * Imports safe project config for one user.
 * @param {string} uid User id.
 * @param {string|object} backupJson Backup JSON string or object.
 * @returns {Promise<{imported: number, skipped: number, errors: string[]}>} Import summary.
 */
export async function importConfig(uid, backupJson) {
  const backup = typeof backupJson === 'string' ? JSON.parse(backupJson) : backupJson;
  if (!backup || !Array.isArray(backup.projects)) {
    const error = new Error('Backup must contain a projects array.');
    error.code = 'INVALID_BACKUP';
    throw error;
  }

  const existing = await getUserProjectsRaw(uid);
  const existingIds = new Set(existing.map((project) => project.id));
  const summary = { imported: 0, skipped: 0, errors: [] };
  const now = Date.now();

  for (const item of backup.projects) {
    try {
      if (!item.id || !item.name || !item.databaseUrl) {
        throw new Error(`Project ${item.id || '(missing id)'} is missing id, name, or databaseUrl.`);
      }

      if (existingIds.has(item.id)) {
        summary.skipped += 1;
        continue;
      }

      await saveUserProjectRaw(uid, {
        id: item.id,
        name: item.name,
        databaseUrl: item.databaseUrl,
        secret: null,
        credentialsJson: null,
        authMode: item.authMode === 'secret' ? 'secret' : 'credentials',
        createdAt: item.createdAt || now,
        updatedAt: now
      });
      summary.imported += 1;
    } catch (error) {
      summary.errors.push(error.message);
    }
  }

  return summary;
}
