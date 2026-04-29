const TYPE_CLASS = {
  string: 'text-green-400',
  number: 'text-blue-400',
  boolean: 'text-orange-400',
  null: 'text-gray-500',
  object: 'text-gray-300',
  array: 'text-gray-300'
};

/**
 * Returns the JSON type for a value.
 * @param {*} value Value.
 * @returns {string} JSON type.
 */
function getType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Joins an RTDB path with a child key.
 * @param {string} base Base path.
 * @param {string} key Child key.
 * @returns {string} Joined path.
 */
function joinPath(base, key) {
  const normalized = base === '/' ? '' : base.replace(/^\/|\/$/g, '');
  return `/${[normalized, key].filter(Boolean).join('/')}`;
}

/**
 * Parses inline editor input as JSON when possible.
 * @param {string} raw Raw input.
 * @returns {*} Parsed value.
 */
function parseInlineValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Renders and manages a recursive JSON tree.
 */
export class JsonTree {
  /**
   * Creates a JSON tree renderer.
   * @param {object} options Tree options.
   */
  constructor(options) {
    this.projectId = options.projectId;
    this.path = options.path || '/';
    this.data = options.data;
    this.apiFetch = options.apiFetch;
    this.onEdit = options.onEdit;
    this.onDelete = options.onDelete;
    this.onAdd = options.onAdd;
    this.onCopy = options.onCopy;
    this.expanded = new Set();
    this.renderLimits = new Map();
    this.root = document.createElement('div');
    this.root.className = 'font-mono text-sm';
  }

  /**
   * Renders the tree root.
   * @returns {HTMLElement} Root element.
   */
  render() {
    this.root.innerHTML = '';
    this.root.append(this.renderValue('(root)', this.data, this.path, 0, true));
    return this.root;
  }

  /**
   * Renders a value node.
   * @param {string} key Node key.
   * @param {*} value Node value.
   * @param {string} path Node path.
   * @param {number} depth Nesting depth.
   * @param {boolean} forceExpanded Whether root should render expanded.
   * @returns {HTMLElement} Node element.
   */
  renderValue(key, value, path, depth, forceExpanded = false) {
    const type = getType(value);
    const isBranch = type === 'object' || type === 'array';
    const wrapper = document.createElement('div');
    const row = document.createElement('div');
    row.className = 'group grid min-h-8 grid-cols-[24px_minmax(120px,240px)_1fr] items-center border-b border-gray-900 px-2 hover:bg-gray-900/80';
    row.style.paddingLeft = `${8 + depth * 18}px`;
    row.dataset.path = path;
    row.innerHTML = `
      <button class="toggle h-6 w-6 rounded text-gray-400 hover:bg-gray-800" title="${isBranch ? 'Expand' : 'Value'}">${isBranch ? (forceExpanded || this.expanded.has(path) ? 'v' : '>') : '.'}</button>
      <div class="truncate text-purple-400" title="${key}">${key}</div>
      <div class="value truncate ${TYPE_CLASS[type]}"></div>
    `;

    row.querySelector('.value').textContent = this.preview(value);
    row.addEventListener('contextmenu', (event) => this.openContextMenu(event, key, value, path, type));

    if (isBranch) {
      row.querySelector('.toggle').addEventListener('click', () => this.toggleBranch(wrapper, value, path, depth));
    } else {
      row.querySelector('.value').addEventListener('dblclick', () => this.startInlineEdit(row, value, path));
    }

    wrapper.append(row);

    if (isBranch && (forceExpanded || this.expanded.has(path))) {
      wrapper.append(this.renderChildren(value, path, depth + 1));
    }

    return wrapper;
  }

  /**
   * Renders object/array children.
   * @param {object|array} value Branch value.
   * @param {string} path Branch path.
   * @param {number} depth Nesting depth.
   * @returns {HTMLElement} Children element.
   */
  renderChildren(value, path, depth) {
    const children = document.createElement('div');
    const entries = Object.entries(value || {});
    const limit = this.renderLimits.get(path) || 200;

    for (const [key, child] of entries.slice(0, limit)) {
      children.append(this.renderValue(key, child, joinPath(path, key), depth));
    }

    if (entries.length > limit) {
      const button = document.createElement('button');
      button.className = 'ml-8 mt-2 rounded-md border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800';
      button.textContent = `Show ${Math.min(200, entries.length - limit)} more`;
      button.addEventListener('click', () => {
        this.renderLimits.set(path, limit + 200);
        this.render();
      });
      children.append(button);
    }

    return children;
  }

  /**
   * Toggles a branch node.
   * @param {HTMLElement} wrapper Node wrapper.
   * @param {*} value Node value.
   * @param {string} path Node path.
   * @param {number} depth Node depth.
   * @returns {Promise<void>} Resolves after toggle.
   */
  async toggleBranch(wrapper, value, path, depth) {
    if (this.expanded.has(path)) {
      this.expanded.delete(path);
      this.render();
      return;
    }

    this.expanded.add(path);
    this.render();

    if (value === null || typeof value !== 'object') {
      const response = await this.apiFetch(`/data/${this.projectId}?path=${encodeURIComponent(path)}`);
      this.data = response.data;
      this.render();
    }
  }

  /**
   * Returns a compact preview string.
   * @param {*} value Value.
   * @returns {string} Preview.
   */
  preview(value) {
    const type = getType(value);
    if (type === 'object') return `{ ${Object.keys(value || {}).length} keys }`;
    if (type === 'array') return `[ ${value.length} items ]`;
    if (type === 'string') return `"${value}"`;
    return String(value);
  }

  /**
   * Starts primitive inline editing.
   * @param {HTMLElement} row Row element.
   * @param {*} value Current value.
   * @param {string} path Node path.
   * @returns {void}
   */
  startInlineEdit(row, value, path) {
    const valueCell = row.querySelector('.value');
    const input = document.createElement('input');
    input.className = 'w-full rounded border border-blue-500 bg-gray-950 px-2 py-1 text-gray-100 outline-none';
    input.value = typeof value === 'string' ? value : JSON.stringify(value);
    valueCell.innerHTML = '';
    valueCell.append(input);
    input.focus();
    input.select();

    input.addEventListener('keydown', async (event) => {
      if (event.key === 'Escape') {
        this.render();
      }
      if (event.key === 'Enter') {
        await this.onEdit(path, parseInlineValue(input.value));
      }
    });
  }

  /**
   * Opens a right-click context menu.
   * @param {MouseEvent} event Mouse event.
   * @param {string} key Node key.
   * @param {*} value Node value.
   * @param {string} path Node path.
   * @param {string} type JSON type.
   * @returns {void}
   */
  openContextMenu(event, key, value, path, type) {
    event.preventDefault();
    document.querySelectorAll('.json-context-menu').forEach((menu) => menu.remove());

    const menu = document.createElement('div');
    menu.className = 'json-context-menu fixed z-50 w-44 overflow-hidden rounded-md border border-gray-700 bg-gray-900 text-sm shadow-xl';
    menu.style.left = `${event.clientX}px`;
    menu.style.top = `${event.clientY}px`;
    menu.innerHTML = `
      <button data-action="copy-path" class="block w-full px-3 py-2 text-left hover:bg-gray-800">Copy path</button>
      <button data-action="copy-value" class="block w-full px-3 py-2 text-left hover:bg-gray-800">Copy value</button>
      <button data-action="edit" class="block w-full px-3 py-2 text-left hover:bg-gray-800">Edit</button>
      <button data-action="add" class="block w-full px-3 py-2 text-left hover:bg-gray-800">Add child</button>
      <button data-action="delete" class="block w-full px-3 py-2 text-left text-red-300 hover:bg-red-950">Delete node</button>
    `;

    menu.addEventListener('click', async (clickEvent) => {
      const action = clickEvent.target.dataset.action;
      menu.remove();
      if (action === 'copy-path') await this.onCopy(path);
      if (action === 'copy-value') await this.onCopy(JSON.stringify(value, null, 2));
      if (action === 'edit') await this.onEdit(path, value);
      if (action === 'delete') await this.onDelete(path);
      if (action === 'add') await this.onAdd(type === 'object' || type === 'array' ? path : path.replace(/\/[^/]+$/, '') || '/');
    });

    document.body.append(menu);
    window.setTimeout(() => {
      document.addEventListener('click', () => menu.remove(), { once: true });
    });
  }
}
