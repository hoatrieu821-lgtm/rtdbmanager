import { apiFetch, navigate, store, toast } from '../app.js';
import { Modal, confirmDialog } from '../components/Modal.js';

const projectUi = {
  viewMode: localStorage.getItem('rtdb.projects.viewMode') || 'cards',
  search: '',
  authMode: 'all',
  sortBy: localStorage.getItem('rtdb.projects.sortBy') || 'name',
  sortDir: localStorage.getItem('rtdb.projects.sortDir') || 'asc'
};

if (!['cards', 'grid', 'list'].includes(projectUi.viewMode)) {
  projectUi.viewMode = 'cards';
}

let currentRoot = null;

/**
 * Renders the projects page.
 * @returns {Promise<HTMLElement>} Projects page.
 */
export async function renderProjects() {
  const root = document.createElement('section');
  currentRoot = root;
  root.className = 'p-4 md:p-6';
  root.innerHTML = `
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-xl font-semibold tracking-normal">Projects</h1>
        <p class="mt-1 text-sm text-gray-400">Manage Firebase Realtime Database connections.</p>
      </div>
      <button class="add rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">Add Project</button>
    </header>
    <div class="mb-4 grid gap-3 rounded-md border border-gray-800 bg-gray-900 p-3 xl:grid-cols-[1fr_180px_280px]">
      <label class="grid gap-1 text-sm">
        <span class="text-xs font-medium uppercase tracking-normal text-gray-400">Search</span>
        <input class="search rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500" placeholder="Name, URL, project id..." value="${escapeHtml(projectUi.search)}">
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-xs font-medium uppercase tracking-normal text-gray-400">Filter</span>
        <select class="auth-filter rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
          <option value="all">All auth modes</option>
          <option value="credentials">Credentials</option>
          <option value="secret">Secret</option>
        </select>
      </label>
      <div class="grid gap-1 text-sm">
        <span class="text-xs font-medium uppercase tracking-normal text-gray-400">View</span>
        <div class="grid grid-cols-3 gap-1 rounded-md border border-gray-700 bg-gray-950 p-1">
          <button type="button" data-view="cards" class="view-btn rounded px-3 py-1.5 text-sm hover:bg-gray-800">Cards</button>
          <button type="button" data-view="grid" class="view-btn rounded px-3 py-1.5 text-sm hover:bg-gray-800">Grid</button>
          <button type="button" data-view="list" class="view-btn rounded px-3 py-1.5 text-sm hover:bg-gray-800">List</button>
        </div>
      </div>
    </div>
    <div class="projects"></div>
  `;

  root.querySelector('.auth-filter').value = projectUi.authMode;
  root.querySelector('.add').addEventListener('click', () => openProjectModal());
  root.querySelector('.search').addEventListener('input', (event) => {
    projectUi.search = event.target.value;
    renderProjectsList(root);
  });
  root.querySelector('.auth-filter').addEventListener('change', (event) => {
    projectUi.authMode = event.target.value;
    renderProjectsList(root);
  });
  root.querySelectorAll('[data-view]').forEach((button) => {
    button.addEventListener('click', () => {
      projectUi.viewMode = button.dataset.view;
      localStorage.setItem('rtdb.projects.viewMode', projectUi.viewMode);
      renderProjectsList(root);
    });
  });

  await loadProjects(root);
  return root;
}

/**
 * Loads and renders projects.
 * @param {HTMLElement} root Page root.
 * @returns {Promise<void>} Resolves after load.
 */
async function loadProjects(root = currentRoot || document) {
  const response = await apiFetch('/projects');
  store.projects = response.projects;
  renderProjectsList(root);
}

/**
 * Renders the active projects view.
 * @param {HTMLElement} root Page root.
 * @returns {void}
 */
function renderProjectsList(root) {
  const container = root.querySelector('.projects');
  const projects = getSortedProjects(getFilteredProjects());
  updateViewButtons(root);

  if (!projects.length) {
    container.className = 'projects';
    container.innerHTML = `
      <div class="rounded-md border border-gray-800 bg-gray-900 px-5 py-8 text-sm text-gray-400">
        No projects match the current search/filter.
      </div>
    `;
    return;
  }

  if (projectUi.viewMode === 'grid') {
    renderProjectGrid(container, projects);
    return;
  }

  if (projectUi.viewMode === 'list') {
    renderProjectList(container, projects);
    return;
  }

  renderProjectCards(container, projects);
}

/**
 * Returns projects matching search and filters.
 * @returns {object[]} Filtered projects.
 */
function getFilteredProjects() {
  const query = projectUi.search.trim().toLowerCase();

  return store.projects.filter((project) => {
    if (projectUi.authMode !== 'all' && project.authMode !== projectUi.authMode) {
      return false;
    }

    if (!query) {
      return true;
    }

    const searchable = [
      project.name,
      project.databaseUrl,
      project.authMode,
      project.credentialsJson?.projectId,
      project.secret
    ].filter(Boolean).join(' ').toLowerCase();

    return searchable.includes(query);
  });
}

/**
 * Returns projects sorted by the active header.
 * @param {object[]} projects Filtered projects.
 * @returns {object[]} Sorted projects.
 */
function getSortedProjects(projects) {
  const direction = projectUi.sortDir === 'desc' ? -1 : 1;

  return [...projects].sort((left, right) => {
    const leftValue = sortValue(left, projectUi.sortBy);
    const rightValue = sortValue(right, projectUi.sortBy);

    if (leftValue < rightValue) return -1 * direction;
    if (leftValue > rightValue) return 1 * direction;
    return String(left.name || '').localeCompare(String(right.name || ''));
  });
}

/**
 * Extracts a sortable value from a project.
 * @param {object} project Project.
 * @param {string} field Sort field.
 * @returns {string|number} Sort value.
 */
function sortValue(project, field) {
  if (field === 'databaseUrl') return String(project.databaseUrl || '').toLowerCase();
  if (field === 'authMode') return String(project.authMode || '').toLowerCase();
  if (field === 'createdAt') return Number(project.createdAt || 0);
  if (field === 'updatedAt') return Number(project.updatedAt || 0);
  return String(project.name || '').toLowerCase();
}

/**
 * Updates sort state and re-renders.
 * @param {string} field Sort field.
 * @returns {void}
 */
function setSort(field) {
  if (projectUi.sortBy === field) {
    projectUi.sortDir = projectUi.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    projectUi.sortBy = field;
    projectUi.sortDir = 'asc';
  }

  localStorage.setItem('rtdb.projects.sortBy', projectUi.sortBy);
  localStorage.setItem('rtdb.projects.sortDir', projectUi.sortDir);
  renderProjectsList(currentRoot);
}

/**
 * Renders a clickable sort header button.
 * @param {string} field Sort field.
 * @param {string} label Header label.
 * @param {string} extraClass Extra CSS classes.
 * @returns {string} Header HTML.
 */
function sortHeader(field, label, extraClass = '') {
  const active = projectUi.sortBy === field;
  const indicator = active ? (projectUi.sortDir === 'asc' ? '^' : 'v') : '';
  return `
    <button type="button" data-sort="${field}" class="sort-header inline-flex items-center gap-1 ${extraClass} hover:text-blue-300">
      <span>${label}</span><span class="w-3 text-blue-300">${indicator}</span>
    </button>
  `;
}

/**
 * Wires sort header buttons in a container.
 * @param {HTMLElement} container View container.
 * @returns {void}
 */
function wireSortHeaders(container) {
  container.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => setSort(button.dataset.sort));
  });
}

/**
 * Updates view mode button state.
 * @param {HTMLElement} root Page root.
 * @returns {void}
 */
function updateViewButtons(root) {
  root.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === projectUi.viewMode;
    button.classList.toggle('bg-blue-600', active);
    button.classList.toggle('text-white', active);
    button.classList.toggle('text-gray-300', !active);
  });
}

/**
 * Renders project cards.
 * @param {HTMLElement} container Cards container.
 * @param {object[]} projects Projects.
 * @returns {void}
 */
function renderProjectCards(container, projects) {
  container.className = 'projects grid gap-3 lg:grid-cols-2 xl:grid-cols-3';
  container.innerHTML = '';

  for (const project of projects) {
    const card = document.createElement('article');
    card.className = 'rounded-md border border-gray-800 bg-gray-900 p-4';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-base font-medium">${escapeHtml(project.name)}</h2>
          <p class="mt-1 truncate text-xs text-gray-400" title="${escapeHtml(project.databaseUrl)}">${escapeHtml(project.databaseUrl)}</p>
        </div>
        <span class="rounded bg-gray-800 px-2 py-1 text-xs text-blue-300">${escapeHtml(project.authMode)}</span>
      </div>
      <div class="mt-4 flex items-center justify-between gap-3 text-xs text-gray-400">
        <span class="latency">Checking...</span>
        <span>${escapeHtml(projectAuthLabel(project))}</span>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="open rounded-md bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500">Open Explorer</button>
        <button class="edit rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Edit</button>
        <button class="delete rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-300 hover:bg-red-950">Delete</button>
      </div>
    `;

    wireProjectActions(card, project);
    container.append(card);
    checkLatency(project, card.querySelector('.latency'));
  }
}

/**
 * Renders projects as a compact grid/table.
 * @param {HTMLElement} container View container.
 * @param {object[]} projects Projects.
 * @returns {void}
 */
function renderProjectGrid(container, projects) {
  container.className = 'projects overflow-hidden rounded-md border border-gray-800 bg-gray-900';
  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full min-w-[820px] text-left text-sm">
        <thead class="border-b border-gray-800 text-xs uppercase tracking-normal text-gray-400">
          <tr>
            <th class="px-4 py-3 font-medium">${sortHeader('name', 'Name')}</th>
            <th class="px-4 py-3 font-medium">${sortHeader('databaseUrl', 'Database URL')}</th>
            <th class="px-4 py-3 font-medium">${sortHeader('authMode', 'Auth')}</th>
            <th class="px-4 py-3 font-medium">${sortHeader('updatedAt', 'Updated')}</th>
            <th class="px-4 py-3 font-medium">Latency</th>
            <th class="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;

  const tbody = container.querySelector('tbody');
  for (const project of projects) {
    const row = document.createElement('tr');
    row.className = 'border-b border-gray-800 last:border-b-0 hover:bg-gray-950';
    row.innerHTML = `
      <td class="max-w-[220px] px-4 py-3">
        <div class="truncate font-medium">${escapeHtml(project.name)}</div>
        <div class="truncate text-xs text-gray-500">${escapeHtml(projectAuthLabel(project))}</div>
      </td>
      <td class="max-w-[360px] px-4 py-3">
        <div class="truncate font-mono text-xs text-gray-400" title="${escapeHtml(project.databaseUrl)}">${escapeHtml(project.databaseUrl)}</div>
      </td>
      <td class="px-4 py-3">
        <span class="rounded bg-gray-800 px-2 py-1 text-xs text-blue-300">${escapeHtml(project.authMode)}</span>
      </td>
      <td class="px-4 py-3 text-xs text-gray-400">${formatDate(project.updatedAt)}</td>
      <td class="px-4 py-3"><span class="latency text-gray-400">Checking...</span></td>
      <td class="px-4 py-3">
        <div class="flex justify-end gap-2">
          <button class="open rounded-md bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-500">Open</button>
          <button class="edit rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Edit</button>
          <button class="delete rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950">Delete</button>
        </div>
      </td>
    `;

    wireProjectActions(row, project);
    tbody.append(row);
    checkLatency(project, row.querySelector('.latency'));
  }

  wireSortHeaders(container);
}

/**
 * Renders projects as a dense list.
 * @param {HTMLElement} container View container.
 * @param {object[]} projects Projects.
 * @returns {void}
 */
function renderProjectList(container, projects) {
  container.className = 'projects overflow-x-auto rounded-md border border-gray-800 bg-gray-900';
  container.innerHTML = `
    <div class="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_110px_140px_180px] gap-3 border-b border-gray-800 px-4 py-3 text-xs uppercase tracking-normal text-gray-400">
      <div>${sortHeader('name', 'Name')}</div>
      <div>${sortHeader('authMode', 'Auth')}</div>
      <div>${sortHeader('updatedAt', 'Updated')}</div>
      <div class="text-right">Actions</div>
    </div>
    <div class="list-body"></div>
  `;

  const body = container.querySelector('.list-body');
  for (const project of projects) {
    const row = document.createElement('div');
    row.className = 'grid min-w-[760px] grid-cols-[minmax(220px,1fr)_110px_140px_180px] items-center gap-3 border-b border-gray-800 px-4 py-3 text-sm last:border-b-0 hover:bg-gray-950';
    row.innerHTML = `
      <div class="min-w-0">
        <div class="truncate font-medium">${escapeHtml(project.name)}</div>
        <div class="truncate font-mono text-xs text-gray-400" title="${escapeHtml(project.databaseUrl)}">${escapeHtml(project.databaseUrl)}</div>
      </div>
      <div>
        <span class="rounded bg-gray-800 px-2 py-1 text-xs text-blue-300">${escapeHtml(project.authMode)}</span>
      </div>
      <div>
        <div class="text-xs text-gray-400">${formatDate(project.updatedAt)}</div>
        <div class="latency mt-1 text-xs text-gray-500">Checking...</div>
      </div>
      <div class="flex justify-end gap-2">
        <button class="open rounded-md bg-blue-600 px-2.5 py-1.5 text-xs text-white hover:bg-blue-500">Open</button>
        <button class="edit rounded-md border border-gray-700 px-2.5 py-1.5 text-xs text-gray-300 hover:bg-gray-800">Edit</button>
        <button class="delete rounded-md border border-red-500/40 px-2.5 py-1.5 text-xs text-red-300 hover:bg-red-950">Delete</button>
      </div>
    `;

    wireProjectActions(row, project);
    body.append(row);
    checkLatency(project, row.querySelector('.latency'));
  }

  wireSortHeaders(container);
}

/**
 * Wires common project action buttons.
 * @param {HTMLElement} element Project row/card.
 * @param {object} project Project.
 * @returns {void}
 */
function wireProjectActions(element, project) {
  element.querySelector('.open').addEventListener('click', () => navigate(`#/explorer/${project.id}`));
  element.querySelector('.edit').addEventListener('click', () => openProjectModal(project));
  const deleteButton = element.querySelector('.delete');
  if (deleteButton) {
    deleteButton.addEventListener('click', () => deleteProject(project));
  }
}

/**
 * Checks project latency and updates its badge.
 * @param {object} project Project.
 * @param {HTMLElement} target Target element.
 * @returns {Promise<void>} Resolves after check.
 */
async function checkLatency(project, target) {
  try {
    const response = await apiFetch(`/projects/${project.id}/test`);
    target.textContent = `${response.result.latency} ms`;
    target.className = 'latency text-green-400';
  } catch {
    target.textContent = 'Offline';
    target.className = 'latency text-red-300';
  }
}

/**
 * Opens the create/edit project modal.
 * @param {object|null} project Existing project.
 * @returns {void}
 */
function openProjectModal(project = null) {
  let credentialsJson = null;
  const body = document.createElement('form');
  body.className = 'grid gap-4';
  body.innerHTML = `
    <div class="grid gap-1 text-sm">
      <label class="text-gray-300" for="project-name">Name</label>
      <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input id="project-name" name="name" required value="${escapeHtml(project?.name || '')}" class="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
        <button type="button" class="generate-name rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Generate</button>
      </div>
    </div>
    <label class="grid gap-1 text-sm">
      <span class="text-gray-300">Database URL</span>
      <input name="databaseUrl" required value="${escapeHtml(project?.databaseUrl || '')}" class="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
    </label>
    <fieldset class="grid gap-2 text-sm">
      <legend class="text-gray-300">Authentication</legend>
      <label class="flex items-center gap-2"><input type="radio" name="authMode" value="credentials" ${project?.authMode !== 'secret' ? 'checked' : ''}> Service Account</label>
      <label class="flex items-center gap-2"><input type="radio" name="authMode" value="secret" ${project?.authMode === 'secret' ? 'checked' : ''}> Database Secret</label>
    </fieldset>
    <label class="credentials-field grid gap-1 text-sm">
      <span class="text-gray-300">credentials.json</span>
      <input type="file" accept="application/json" class="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-300 file:mr-3 file:rounded file:border-0 file:bg-gray-800 file:px-3 file:py-1 file:text-gray-200">
      <span class="text-xs text-gray-500">${project ? 'Leave empty to keep current credentials.' : ''}</span>
    </label>
    <label class="secret-field grid gap-1 text-sm">
      <span class="text-gray-300">Database Secret</span>
      <input name="secret" type="password" placeholder="${project ? 'Leave empty to keep current secret' : ''}" class="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500">
    </label>
  `;

  const footer = document.createElement('div');
  footer.className = 'flex flex-wrap justify-between gap-2';
  footer.innerHTML = `
    <button type="button" class="exit rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Thoat</button>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="test rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800">Test Connection</button>
      <button type="submit" form="project-form" class="save rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-500">Save</button>
    </div>
  `;
  body.id = 'project-form';

  const modal = new Modal({
    title: project ? 'Edit Project' : 'Add Project',
    body,
    footer,
    closeOnBackdrop: false,
    closeOnEscape: false,
    showCloseButton: false
  }).open();
  const authRadios = [...body.querySelectorAll('[name="authMode"]')];
  const credentialsField = body.querySelector('.credentials-field');
  const secretField = body.querySelector('.secret-field');

  const syncAuthFields = () => {
    const mode = body.querySelector('[name="authMode"]:checked').value;
    credentialsField.classList.toggle('hidden', mode !== 'credentials');
    secretField.classList.toggle('hidden', mode !== 'secret');
  };
  authRadios.forEach((radio) => radio.addEventListener('change', syncAuthFields));
  syncAuthFields();

  footer.querySelector('.exit').addEventListener('click', () => modal.close());
  body.querySelector('.generate-name').addEventListener('click', () => {
    const databaseUrl = body.querySelector('[name="databaseUrl"]').value;
    const generatedName = generateNameFromDatabaseUrl(databaseUrl);
    if (!generatedName) {
      toast.warning('Enter a valid Firebase Realtime Database URL first.');
      return;
    }
    body.querySelector('[name="name"]').value = generatedName;
  });

  body.querySelector('input[type="file"]').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      credentialsJson = await file.text();
      JSON.parse(credentialsJson);
      toast.success('credentials.json loaded');
    } catch {
      credentialsJson = null;
      toast.error('credentials.json is not valid JSON');
    }
  });

  const buildPayload = () => {
    const form = new FormData(body);
    const payload = {
      name: form.get('name'),
      databaseUrl: form.get('databaseUrl'),
      authMode: form.get('authMode')
    };

    if (payload.authMode === 'credentials') {
      if (credentialsJson) payload.credentialsJson = credentialsJson;
    } else {
      const secret = form.get('secret');
      if (secret) payload.secret = secret;
    }

    return payload;
  };

  footer.querySelector('.test').addEventListener('click', async () => {
    try {
      const payload = buildPayload();
      const response = project && !payload.credentialsJson && !payload.secret
        ? await apiFetch(`/projects/${project.id}/test`)
        : await apiFetch('/projects/test', { method: 'POST', body: JSON.stringify(payload) });
      toast.success(`Connection OK (${response.result.latency} ms)`);
    } catch (error) {
      toast.error(error.message);
    }
  });

  body.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const payload = buildPayload();
      await apiFetch(project ? `/projects/${project.id}` : '/projects', {
        method: project ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });
      modal.close();
      toast.success(project ? 'Project updated' : 'Project created');
      await loadProjects();
    } catch (error) {
      toast.error(error.message);
    }
  });
}

/**
 * Deletes a project after confirmation.
 * @param {object} project Project.
 * @returns {Promise<void>} Resolves after delete.
 */
async function deleteProject(project) {
  if (!await confirmDialog(`Delete ${project.name}?`)) {
    return;
  }

  await apiFetch(`/projects/${project.id}`, { method: 'DELETE' });
  toast.success('Project deleted');
  await loadProjects();
}

/**
 * Generates a project name from an RTDB URL.
 * @param {string} databaseUrl Database URL.
 * @returns {string} Generated name or empty string.
 */
function generateNameFromDatabaseUrl(databaseUrl) {
  try {
    const url = new URL(String(databaseUrl || '').trim());
    const host = url.hostname;
    const firstLabel = host.split('.')[0] || '';

    return firstLabel
      .replace(/-default-rtdb$/, '')
      .replace(/-rtdb$/, '')
      .trim();
  } catch {
    return '';
  }
}

/**
 * Returns a compact auth label for a project.
 * @param {object} project Project.
 * @returns {string} Auth label.
 */
function projectAuthLabel(project) {
  return project.credentialsJson?.hasCredentials
    ? project.credentialsJson.projectId || 'service account'
    : project.secret || 'secret';
}

/**
 * Formats a timestamp for compact UI display.
 * @param {number} timestamp Timestamp in milliseconds.
 * @returns {string} Formatted date.
 */
function formatDate(timestamp) {
  if (!timestamp) {
    return '-';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

/**
 * Escapes text before injecting it into HTML.
 * @param {*} value Value.
 * @returns {string} Escaped HTML.
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
