import { apiFetch, toast } from '../app.js';
import { JsonTree } from '../components/JsonTree.js';
import { Modal, confirmDialog } from '../components/Modal.js';

/**
 * Renders the RTDB explorer page.
 * @param {string} projectId Project id.
 * @returns {Promise<HTMLElement>} Explorer page.
 */
export async function renderExplorer(projectId) {
  const root = document.createElement('section');
  root.className = 'grid min-h-screen grid-rows-[auto_1fr]';
  root.innerHTML = `
    <header class="border-b border-gray-800 bg-gray-950 p-4">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="project-name text-lg font-semibold tracking-normal">Explorer</h1>
          <p class="database-url mt-1 text-xs text-gray-400"></p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button class="refresh rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800" title="Refresh">Refresh</button>
          <button class="export rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800" title="Export JSON">Export</button>
          <button class="add rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500" title="Add node">Add Node</button>
        </div>
      </div>
      <div class="grid gap-2 md:grid-cols-[1fr_260px]">
        <nav class="breadcrumbs flex min-h-10 flex-wrap items-center gap-1 rounded-md border border-gray-800 bg-gray-900 px-3 py-2 text-sm"></nav>
        <input class="path-input rounded-md border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm text-gray-100 outline-none focus:border-blue-500" value="/">
      </div>
    </header>
    <div class="grid min-h-0 grid-cols-1 lg:grid-cols-[220px_1fr]">
      <aside class="hidden border-r border-gray-800 bg-gray-950 p-4 text-sm text-gray-400 lg:block">
        <div class="mb-2 font-medium text-gray-300">Path</div>
        <div class="side-path break-all font-mono text-xs text-gray-400">/</div>
      </aside>
      <main class="min-w-0 overflow-auto">
        <div class="tree min-h-full p-3"></div>
      </main>
    </div>
  `;

  const state = {
    projectId,
    project: null,
    path: '/',
    data: null
  };

  const loadProject = async () => {
    const response = await apiFetch(`/projects/${projectId}`);
    state.project = response.project;
    root.querySelector('.project-name').textContent = response.project.name;
    root.querySelector('.database-url').textContent = response.project.databaseUrl;
  };

  const loadData = async (path = state.path) => {
    state.path = normalizeDisplayPath(path);
    root.querySelector('.path-input').value = state.path;
    root.querySelector('.side-path').textContent = state.path;
    renderBreadcrumbs(root, state.path, loadData);
    root.querySelector('.tree').innerHTML = '<div class="p-4 text-sm text-gray-400">Loading...</div>';

    const response = await apiFetch(`/data/${projectId}?path=${encodeURIComponent(state.path)}`);
    state.data = response.data;
    renderTree(root, state, loadData);
  };

  root.querySelector('.refresh').addEventListener('click', () => loadData().catch((error) => toast.error(error.message)));
  root.querySelector('.export').addEventListener('click', () => {
    window.location.href = `/data/${projectId}/export?path=${encodeURIComponent(state.path)}`;
  });
  root.querySelector('.add').addEventListener('click', () => openAddNode(projectId, state.path, loadData));
  root.querySelector('.path-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      loadData(event.target.value).catch((error) => toast.error(error.message));
    }
  });

  await loadProject();
  await loadData('/');
  return root;
}

/**
 * Normalizes display paths.
 * @param {string} path Path.
 * @returns {string} Normalized path.
 */
function normalizeDisplayPath(path) {
  const cleaned = String(path || '/').trim();
  if (cleaned === '' || cleaned === '/') return '/';
  return `/${cleaned.replace(/^\/+|\/+$/g, '')}`;
}

/**
 * Renders breadcrumbs.
 * @param {HTMLElement} root Page root.
 * @param {string} path Current path.
 * @param {Function} loadData Data loader.
 * @returns {void}
 */
function renderBreadcrumbs(root, path, loadData) {
  const breadcrumbs = root.querySelector('.breadcrumbs');
  const parts = path === '/' ? [] : path.replace(/^\//, '').split('/');
  breadcrumbs.innerHTML = '';

  const rootButton = breadcrumbButton('/', () => loadData('/'));
  breadcrumbs.append(rootButton);

  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    const separator = document.createElement('span');
    separator.className = 'text-gray-600';
    separator.textContent = '/';
    breadcrumbs.append(separator);
    breadcrumbs.append(breadcrumbButton(part, () => loadData(current)));
  }
}

/**
 * Creates a breadcrumb button.
 * @param {string} label Button label.
 * @param {Function} onClick Click handler.
 * @returns {HTMLElement} Button.
 */
function breadcrumbButton(label, onClick) {
  const button = document.createElement('button');
  button.className = 'rounded px-2 py-1 text-blue-300 hover:bg-gray-800';
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Renders the JSON tree.
 * @param {HTMLElement} root Page root.
 * @param {object} state Explorer state.
 * @param {Function} loadData Data loader.
 * @returns {void}
 */
function renderTree(root, state, loadData) {
  const container = root.querySelector('.tree');
  container.innerHTML = '';
  const tree = new JsonTree({
    projectId: state.projectId,
    path: state.path,
    data: state.data,
    apiFetch,
    onCopy: async (value) => {
      await navigator.clipboard.writeText(value);
      toast.success('Copied');
    },
    onEdit: async (path, value) => {
      await openEditNode(state.projectId, path, value, () => loadData(state.path));
    },
    onDelete: async (path) => {
      await deleteNode(state.projectId, path, () => loadData(state.path));
    },
    onAdd: async (path) => {
      await openAddNode(state.projectId, path, () => loadData(state.path));
    }
  });
  container.append(tree.render());
}

/**
 * Opens an edit modal or saves primitive inline edits.
 * @param {string} projectId Project id.
 * @param {string} path Node path.
 * @param {*} value New or current value.
 * @param {Function} refresh Refresh callback.
 * @returns {Promise<void>} Resolves after edit.
 */
async function openEditNode(projectId, path, value, refresh) {
  if (value === null || typeof value !== 'object') {
    await apiFetch(`/data/${projectId}?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: JSON.stringify({ value })
    });
    toast.success('Value saved');
    await refresh();
    return;
  }

  const body = document.createElement('div');
  body.className = 'grid gap-2';
  body.innerHTML = `
    <textarea class="editor min-h-[320px] rounded-md border border-gray-700 bg-gray-950 p-3 font-mono text-sm text-gray-100 outline-none focus:border-blue-500"></textarea>
    <p class="error min-h-5 text-sm text-red-300"></p>
  `;
  body.querySelector('.editor').value = JSON.stringify(value, null, 2);

  const footer = document.createElement('div');
  footer.className = 'flex justify-end gap-2';
  footer.innerHTML = `
    <button class="save rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500">Save</button>
  `;

  const modal = new Modal({ title: `Edit ${path}`, body, footer }).open();
  footer.querySelector('.save').addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(body.querySelector('.editor').value);
      await apiFetch(`/data/${projectId}?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: parsed })
      });
      modal.close();
      toast.success('Node saved');
      await refresh();
    } catch (error) {
      body.querySelector('.error').textContent = error.message;
    }
  });
}

/**
 * Opens the add node modal.
 * @param {string} projectId Project id.
 * @param {string} parentPath Parent path.
 * @param {Function} refresh Refresh callback.
 * @returns {Promise<void>} Resolves after adding.
 */
async function openAddNode(projectId, parentPath, refresh) {
  const body = document.createElement('form');
  body.className = 'grid gap-3';
  body.innerHTML = `
    <label class="grid gap-1 text-sm">
      <span class="text-gray-300">Key</span>
      <input name="key" required class="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
    </label>
    <label class="grid gap-1 text-sm">
      <span class="text-gray-300">Type</span>
      <select name="type" class="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
        <option value="string">String</option>
        <option value="number">Number</option>
        <option value="boolean">Boolean</option>
        <option value="null">Null</option>
        <option value="object">Object</option>
        <option value="array">Array</option>
      </select>
    </label>
    <label class="grid gap-1 text-sm">
      <span class="text-gray-300">Value</span>
      <textarea name="value" class="min-h-28 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-gray-100 outline-none focus:border-blue-500"></textarea>
    </label>
    <p class="error min-h-5 text-sm text-red-300"></p>
  `;

  const footer = document.createElement('div');
  footer.className = 'flex justify-end';
  footer.innerHTML = '<button type="submit" form="add-node-form" class="rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500">Add</button>';
  body.id = 'add-node-form';

  const modal = new Modal({ title: `Add child to ${parentPath}`, body, footer }).open();
  body.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const form = new FormData(body);
      const path = `${normalizeDisplayPath(parentPath).replace(/\/$/, '')}/${form.get('key')}`.replace(/^\/\//, '/');
      const value = parseValue(form.get('type'), form.get('value'));
      await apiFetch(`/data/${projectId}?path=${encodeURIComponent(path)}`, {
        method: 'PUT',
        body: JSON.stringify({ value })
      });
      modal.close();
      toast.success('Node added');
      await refresh();
    } catch (error) {
      body.querySelector('.error').textContent = error.message;
    }
  });
}

/**
 * Parses add-node values by selected type.
 * @param {string} type Value type.
 * @param {string} raw Raw input.
 * @returns {*} Parsed value.
 */
function parseValue(type, raw) {
  if (type === 'string') return String(raw || '');
  if (type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('Value must be a number.');
    return value;
  }
  if (type === 'boolean') return raw === 'true' || raw === '1';
  if (type === 'null') return null;
  if (type === 'array' || type === 'object') {
    const parsed = raw ? JSON.parse(raw) : type === 'array' ? [] : {};
    if (type === 'array' && !Array.isArray(parsed)) throw new Error('Value must be a JSON array.');
    if (type === 'object' && (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')) throw new Error('Value must be a JSON object.');
    return parsed;
  }
  return raw;
}

/**
 * Deletes a node after confirmation.
 * @param {string} projectId Project id.
 * @param {string} path Node path.
 * @param {Function} refresh Refresh callback.
 * @returns {Promise<void>} Resolves after delete.
 */
async function deleteNode(projectId, path, refresh) {
  if (!await confirmDialog(`Delete ${path}?`)) return;
  await apiFetch(`/data/${projectId}?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
  toast.success('Node deleted');
  await refresh();
}
