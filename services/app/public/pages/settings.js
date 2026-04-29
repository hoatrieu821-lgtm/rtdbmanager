import { apiFetch, store, toast } from '../app.js';
import { confirmDialog } from '../components/Modal.js';

/**
 * Renders the settings page.
 * @returns {Promise<HTMLElement>} Settings page.
 */
export async function renderSettings() {
  const root = document.createElement('section');
  root.className = 'p-4 md:p-6';
  root.innerHTML = `
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-normal">Settings</h1>
      <p class="mt-1 text-sm text-gray-400">Account, backup, restore, and API access.</p>
    </header>
    <div class="grid gap-4 xl:grid-cols-2">
      <section class="rounded-md border border-gray-800 bg-gray-900 p-4">
        <h2 class="mb-3 text-base font-medium">Account</h2>
        <div class="text-sm text-gray-300">${store.user.displayName || store.user.email}</div>
        <div class="mt-1 text-sm text-gray-400">${store.user.email}</div>
        <div class="mt-1 font-mono text-xs text-gray-500">${store.user.uid}</div>
      </section>
      <section class="rounded-md border border-gray-800 bg-gray-900 p-4">
        <h2 class="mb-3 text-base font-medium">Backup</h2>
        <div class="flex flex-wrap gap-2">
          <button class="export rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500">Export Config</button>
          <label class="restore cursor-pointer rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">
            Restore Config
            <input type="file" accept="application/json" class="hidden">
          </label>
        </div>
      </section>
      <section class="rounded-md border border-yellow-500/30 bg-gray-900 p-4 xl:col-span-2">
        <h2 class="mb-3 text-base font-medium">Master Database</h2>
        <p class="mb-4 text-sm text-gray-400">
          Dumps all accounts and projects. Credentials are exported in portable form and re-encrypted with the target server CRYPTO_KEY during restore. Sessions are not exported.
        </p>
        <div class="grid gap-3 lg:grid-cols-[1fr_180px_auto]">
          <label class="grid gap-1 text-sm">
            <span class="text-gray-300">Master backup password</span>
            <input type="password" class="master-password rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500" autocomplete="current-password">
          </label>
          <label class="grid gap-1 text-sm">
            <span class="text-gray-300">Restore mode</span>
            <select class="master-restore-mode rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
              <option value="merge">Merge users</option>
              <option value="replace">Replace all users</option>
            </select>
          </label>
          <div class="flex flex-wrap items-end gap-2">
            <button class="master-dump rounded-md bg-yellow-500 px-3 py-2 text-sm font-medium text-gray-950 hover:bg-yellow-400">Dump Database</button>
            <label class="master-restore cursor-pointer rounded-md border border-yellow-500/50 px-3 py-2 text-sm text-yellow-300 hover:bg-yellow-950">
              Restore Database
              <input type="file" accept="application/json" class="hidden">
            </label>
          </div>
        </div>
      </section>
      <section class="rounded-md border border-gray-800 bg-gray-900 p-4 xl:col-span-2">
        <h2 class="mb-3 text-base font-medium">API Key</h2>
        <div class="flex flex-wrap items-center gap-2">
          <code class="api-key rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm text-gray-300">****</code>
          <button class="reveal rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Reveal</button>
          <button class="regenerate rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-950">Regenerate</button>
        </div>
      </section>
    </div>
  `;

  root.querySelector('.export').addEventListener('click', exportBackup);
  root.querySelector('.restore input').addEventListener('change', restoreBackup);
  root.querySelector('.master-dump').addEventListener('click', () => dumpMasterDatabase(root));
  root.querySelector('.master-restore input').addEventListener('change', (event) => restoreMasterDatabase(event, root));
  root.querySelector('.reveal').addEventListener('click', async () => {
    try {
      const revealed = root.querySelector('.reveal').dataset.revealed === 'true';
      const response = await apiFetch(`/auth/api-key?reveal=${!revealed}`);
      root.querySelector('.api-key').textContent = response.key;
      root.querySelector('.reveal').dataset.revealed = String(!revealed);
      root.querySelector('.reveal').textContent = revealed ? 'Reveal' : 'Hide';
    } catch (error) {
      toast.error(error.message);
    }
  });
  root.querySelector('.regenerate').addEventListener('click', async () => {
    try {
      await apiFetch('/auth/api-key/regenerate', { method: 'POST' });
    } catch (error) {
      toast.warning(error.message);
    }
  });

  const key = await apiFetch('/auth/api-key');
  root.querySelector('.api-key').textContent = key.key;

  return root;
}

/**
 * Downloads config backup.
 * @returns {Promise<void>} Resolves after download starts.
 */
async function exportBackup() {
  const response = await fetch('/projects/backup/export', { credentials: 'same-origin' });
  if (!response.ok) {
    toast.error('Could not export backup');
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `rtdb-manager-config-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Restores config backup from a JSON file.
 * @param {Event} event File input event.
 * @returns {Promise<void>} Resolves after restore.
 */
async function restoreBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await file.text());
    const count = Array.isArray(backup.projects) ? backup.projects.length : 0;
    if (!await confirmDialog(`Import ${count} project metadata record(s)? Credentials must be re-entered after restore.`)) {
      return;
    }

    const response = await apiFetch('/projects/backup/restore', {
      method: 'POST',
      body: JSON.stringify({ backup })
    });
    toast.success(`Imported ${response.summary.imported}, skipped ${response.summary.skipped}`);
  } catch (error) {
    toast.error(error.message);
  } finally {
    event.target.value = '';
  }
}

/**
 * Returns the master backup password from settings.
 * @param {HTMLElement} root Settings root.
 * @returns {string} Password.
 */
function getMasterPassword(root) {
  return root.querySelector('.master-password').value.trim();
}

/**
 * Downloads a portable dump of the master database.
 * @param {HTMLElement} root Settings root.
 * @returns {Promise<void>} Resolves after download starts.
 */
async function dumpMasterDatabase(root) {
  const password = getMasterPassword(root);
  if (!password) {
    toast.warning('Enter the master backup password first.');
    return;
  }

  try {
    const response = await fetch('/admin/master-dump', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.message || 'Could not dump master database.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `rtdb-manager-master-dump-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Master database dump downloaded');
  } catch (error) {
    toast.error(error.message);
  }
}

/**
 * Restores the master database from a portable dump.
 * @param {Event} event File input event.
 * @param {HTMLElement} root Settings root.
 * @returns {Promise<void>} Resolves after restore.
 */
async function restoreMasterDatabase(event, root) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const password = getMasterPassword(root);
    if (!password) {
      toast.warning('Enter the master backup password first.');
      return;
    }

    const backup = JSON.parse(await file.text());
    const mode = root.querySelector('.master-restore-mode').value;
    const users = backup.counts?.users ?? Object.keys(backup.data?.users || {}).length;
    const projects = backup.counts?.projects ?? Object.values(backup.data?.users || {})
      .reduce((total, user) => total + Object.keys(user.projects || {}).length, 0);
    const action = mode === 'replace' ? 'replace all users with' : 'merge';

    if (!await confirmDialog(`Restore master database and ${action} ${users} account(s), ${projects} project(s)?`)) {
      return;
    }

    const response = await apiFetch('/admin/master-restore', {
      method: 'POST',
      body: JSON.stringify({
        password,
        backup,
        mode
      })
    });

    toast.success(`Restored ${response.summary.users} account(s), ${response.summary.projects} project(s)`);
  } catch (error) {
    toast.error(error.message);
  } finally {
    event.target.value = '';
  }
}
