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
let projectsLoading = false;

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
        <h1 class="text-primary text-xl font-semibold tracking-normal">Projects</h1>
        <p class="text-tertiary mt-1 text-sm">Manage Firebase Realtime Database connections.</p>
      </div>
      <button class="add btn-primary rounded-md px-3 py-2 text-sm font-medium">Add Project</button>
    </header>
    <div class="surface-secondary mb-4 grid gap-3 rounded-md border border-tertiary p-3 xl:grid-cols-[1fr_180px_280px]">
      <label class="grid gap-1 text-sm">
        <span class="text-tertiary text-xs font-medium uppercase tracking-normal">Search</span>
        <input class="search field rounded-md border px-3 py-2 outline-none" placeholder="Name, URL, project id..." value="${escapeHtml(projectUi.search)}">
      </label>
      <label class="grid gap-1 text-sm">
        <span class="text-tertiary text-xs font-medium uppercase tracking-normal">Filter</span>
        <select class="auth-filter field rounded-md border px-3 py-2 outline-none">
          <option value="all">All auth modes</option>
          <option value="credentials">Credentials</option>
          <option value="secret">Secret</option>
        </select>
      </label>
      <div class="grid gap-1 text-sm">
        <span class="text-tertiary text-xs font-medium uppercase tracking-normal">View</span>
        <div class="surface-primary grid grid-cols-3 gap-1 rounded-md border border-secondary p-1">
          <button type="button" data-view="cards" class="view-btn hover-surface rounded px-3 py-1.5 text-sm">Cards</button>
          <button type="button" data-view="grid" class="view-btn hover-surface rounded px-3 py-1.5 text-sm">Grid</button>
          <button type="button" data-view="list" class="view-btn hover-surface rounded px-3 py-1.5 text-sm">List</button>
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

  renderProjectsLoading(root);
  loadProjects(root).catch((error) => {
    renderProjectsError(root, error);
    toast.error(error.message);
  });

  return root;
}

/**
 * Loads and renders projects.
 * @param {HTMLElement} root Page root.
 * @returns {Promise<void>} Resolves after load.
 */
async function loadProjects(root = currentRoot || document) {
  projectsLoading = true;
  try {
    const response = await apiFetch('/projects');
    store.projects = Array.isArray(response.projects) ? response.projects : [];
    projectsLoading = false;
    renderProjectsList(root);
  } catch (error) {
    projectsLoading = false;
    throw error;
  }
}

/**
 * Shows the initial projects loading state.
 * @param {HTMLElement} root Page root.
 * @returns {void}
 */
function renderProjectsLoading(root) {
  const container = root.querySelector('.projects');
  if (!container) return;

  container.className = 'projects';
  container.innerHTML = `
    <div class="surface-secondary text-tertiary rounded-md border border-tertiary px-5 py-8 text-sm">
      Loading projects...
    </div>
  `;
}

/**
 * Shows a projects loading error with a retry action.
 * @param {HTMLElement} root Page root.
 * @param {Error} error Loading error.
 * @returns {void}
 */
function renderProjectsError(root, error) {
  const container = root.querySelector('.projects');
  if (!container || root !== currentRoot) return;

  container.className = 'projects';
  container.innerHTML = `
    <div class="surface-secondary text-danger rounded-md border border-secondary px-5 py-8 text-sm">
      <div>Could not load projects: ${escapeHtml(error.message)}</div>
      <button type="button" class="retry-projects btn-secondary mt-4 rounded-md border px-3 py-2 text-sm">Retry</button>
    </div>
  `;

  container.querySelector('.retry-projects').addEventListener('click', () => {
    renderProjectsLoading(root);
    loadProjects(root).catch((retryError) => {
      renderProjectsError(root, retryError);
      toast.error(retryError.message);
    });
  });
}

/**
 * Renders the active projects view.
 * @param {HTMLElement} root Page root.
 * @returns {void}
 */
function renderProjectsList(root) {
  const container = root.querySelector('.projects');
  if (!container) return;

  if (projectsLoading && !store.projects.length) {
    renderProjectsLoading(root);
    return;
  }

  const projects = getSortedProjects(getFilteredProjects());
  updateViewButtons(root);

  if (!projects.length) {
    container.className = 'projects';
    container.innerHTML = `
      <div class="surface-secondary text-tertiary rounded-md border border-tertiary px-5 py-8 text-sm">
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
    <button type="button" data-sort="${field}" class="sort-header inline-flex items-center gap-1 ${extraClass} text-secondary">
      <span>${label}</span><span class="w-3 text-info">${indicator}</span>
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
    button.classList.toggle('btn-primary', active);
    button.classList.toggle('text-secondary', !active);
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
    card.className = 'surface-secondary rounded-md border border-tertiary p-4';
    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-primary truncate text-base font-medium">${escapeHtml(project.name)}</h2>
          <p class="text-tertiary mt-1 truncate text-xs" title="${escapeHtml(project.databaseUrl)}">${escapeHtml(project.databaseUrl)}</p>
        </div>
        <span class="badge-info rounded px-2 py-1 text-xs">${escapeHtml(project.authMode)}</span>
      </div>
      <div class="text-tertiary mt-4 flex items-center justify-end gap-3 text-xs">
        <span>${escapeHtml(projectAuthLabel(project))}</span>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="open btn-primary rounded-md px-3 py-2 text-sm">Open Explorer</button>
        <button class="edit btn-secondary rounded-md border px-3 py-2 text-sm">Edit</button>
        <button class="delete btn-danger rounded-md border px-3 py-2 text-sm">Delete</button>
      </div>
    `;

    wireProjectActions(card, project);
    container.append(card);
  }
}

/**
 * Renders projects as a compact grid/table.
 * @param {HTMLElement} container View container.
 * @param {object[]} projects Projects.
 * @returns {void}
 */
function renderProjectGrid(container, projects) {
  container.className = 'projects surface-secondary overflow-hidden rounded-md border border-tertiary';
  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full min-w-[820px] text-left text-sm">
        <thead class="text-tertiary border-b border-tertiary text-xs uppercase tracking-normal">
          <tr>
            <th class="px-4 py-3 font-medium">${sortHeader('name', 'Name')}</th>
            <th class="px-4 py-3 font-medium">${sortHeader('databaseUrl', 'Database URL')}</th>
            <th class="px-4 py-3 font-medium">${sortHeader('authMode', 'Auth')}</th>
            <th class="px-4 py-3 font-medium">${sortHeader('updatedAt', 'Updated')}</th>
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
    row.className = 'hover-surface border-b border-tertiary last:border-b-0';
    row.innerHTML = `
      <td class="max-w-[220px] px-4 py-3">
        <div class="text-primary truncate font-medium">${escapeHtml(project.name)}</div>
        <div class="text-tertiary truncate text-xs">${escapeHtml(projectAuthLabel(project))}</div>
      </td>
      <td class="max-w-[360px] px-4 py-3">
        <div class="text-tertiary truncate font-mono text-xs" title="${escapeHtml(project.databaseUrl)}">${escapeHtml(project.databaseUrl)}</div>
      </td>
      <td class="px-4 py-3">
        <span class="badge-info rounded px-2 py-1 text-xs">${escapeHtml(project.authMode)}</span>
      </td>
      <td class="text-tertiary px-4 py-3 text-xs">${formatDate(project.updatedAt)}</td>
      <td class="px-4 py-3">
        <div class="flex justify-end gap-2">
          <button class="open btn-primary rounded-md px-2.5 py-1.5 text-xs">Open</button>
          <button class="edit btn-secondary rounded-md border px-2.5 py-1.5 text-xs">Edit</button>
          <button class="delete btn-danger rounded-md border px-2.5 py-1.5 text-xs">Delete</button>
        </div>
      </td>
    `;

    wireProjectActions(row, project);
    tbody.append(row);
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
  container.className = 'projects surface-secondary overflow-x-auto rounded-md border border-tertiary';
  container.innerHTML = `
    <div class="text-tertiary grid min-w-[760px] grid-cols-[minmax(220px,1fr)_110px_140px_180px] gap-3 border-b border-tertiary px-4 py-3 text-xs uppercase tracking-normal">
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
    row.className = 'hover-surface grid min-w-[760px] grid-cols-[minmax(220px,1fr)_110px_140px_180px] items-center gap-3 border-b border-tertiary px-4 py-3 text-sm last:border-b-0';
    row.innerHTML = `
      <div class="min-w-0">
        <div class="text-primary truncate font-medium">${escapeHtml(project.name)}</div>
        <div class="text-tertiary truncate font-mono text-xs" title="${escapeHtml(project.databaseUrl)}">${escapeHtml(project.databaseUrl)}</div>
      </div>
      <div>
        <span class="badge-info rounded px-2 py-1 text-xs">${escapeHtml(project.authMode)}</span>
      </div>
      <div>
        <div class="text-tertiary text-xs">${formatDate(project.updatedAt)}</div>
      </div>
      <div class="flex justify-end gap-2">
        <button class="open btn-primary rounded-md px-2.5 py-1.5 text-xs">Open</button>
        <button class="edit btn-secondary rounded-md border px-2.5 py-1.5 text-xs">Edit</button>
        <button class="delete btn-danger rounded-md border px-2.5 py-1.5 text-xs">Delete</button>
      </div>
    `;

    wireProjectActions(row, project);
    body.append(row);
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
      <label class="text-secondary" for="project-name">Name</label>
      <div class="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input id="project-name" name="name" required value="${escapeHtml(project?.name || '')}" class="field rounded-md border px-3 py-2 outline-none">
        <button type="button" class="generate-name btn-secondary rounded-md border px-3 py-2 text-sm">Generate</button>
      </div>
    </div>
    <label class="grid gap-1 text-sm">
      <span class="text-secondary">Database URL</span>
      <input name="databaseUrl" required value="${escapeHtml(project?.databaseUrl || '')}" class="field rounded-md border px-3 py-2 outline-none">
    </label>
    <fieldset class="grid gap-2 text-sm">
      <legend class="text-secondary">Authentication</legend>
      <label class="flex items-center gap-2"><input type="radio" name="authMode" value="credentials" ${project?.authMode !== 'secret' ? 'checked' : ''}> Service Account</label>
      <label class="flex items-center gap-2"><input type="radio" name="authMode" value="secret" ${project?.authMode === 'secret' ? 'checked' : ''}> Database Secret</label>
    </fieldset>
    <label class="credentials-field grid gap-1 text-sm">
      <span class="text-secondary">credentials.json</span>
      <input type="file" accept="application/json" class="field rounded-md border px-3 py-2 file:mr-3 file:rounded file:border-0 file:px-3 file:py-1">
      <span class="text-tertiary text-xs">${project ? 'Leave empty to keep current credentials.' : ''}</span>
    </label>
    <label class="secret-field grid gap-1 text-sm">
      <span class="text-secondary">Database Secret</span>
      <input name="secret" type="password" placeholder="${project ? 'Leave empty to keep current secret' : ''}" class="field rounded-md border px-3 py-2 outline-none">
    </label>
  `;

  const footer = document.createElement('div');
  footer.className = 'flex flex-wrap justify-between gap-2';
  footer.innerHTML = `
    <button type="button" class="exit btn-secondary rounded-md border px-3 py-2 text-sm">Thoat</button>
    <div class="flex flex-wrap gap-2">
      <button type="button" class="test btn-secondary rounded-md border px-3 py-2 text-sm">Test Connection</button>
      <button type="submit" form="project-form" class="save btn-primary rounded-md px-3 py-2 text-sm font-medium">Save</button>
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
      if (project && !payload.credentialsJson && !payload.secret) {
        await apiFetch(`/projects/${project.id}/test`);
      } else {
        await apiFetch('/projects/test', { method: 'POST', body: JSON.stringify(payload) });
      }
      toast.success('Connection OK');
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
