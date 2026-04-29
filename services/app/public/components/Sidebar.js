/**
 * Renders the application sidebar.
 * @param {{user: object, currentRoute: string, theme: string, onNavigate: Function, onThemeChange: Function, onLogout: Function}} props Sidebar props.
 * @returns {HTMLElement} Sidebar element.
 */
export function Sidebar({ user, currentRoute, theme, onNavigate, onThemeChange, onLogout }) {
  const root = document.createElement('div');
  root.className = 'flex h-full flex-col gap-4 p-4';
  root.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="grid h-9 w-9 place-items-center rounded-md bg-blue-600 font-semibold text-white">R</div>
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold">RTDB Manager</div>
        <div class="truncate text-xs text-gray-400">${user.email}</div>
      </div>
    </div>
    <nav class="grid gap-1">
      <button data-route="#/projects" class="nav-projects flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-900">Projects</button>
      <button data-route="#/settings" class="nav-settings flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-gray-900">Settings</button>
    </nav>
    <div class="rounded-md border border-gray-800 bg-gray-900 p-2">
      <div class="mb-2 text-xs font-medium uppercase tracking-normal text-gray-400">Theme</div>
      <div class="grid grid-cols-2 gap-1">
        <button data-theme="dark" class="theme-dark rounded-md px-2 py-1.5 text-sm hover:bg-gray-800">Dark</button>
        <button data-theme="light" class="theme-light-btn rounded-md px-2 py-1.5 text-sm hover:bg-gray-800">Light</button>
      </div>
    </div>
    <div class="mt-auto border-t border-gray-800 pt-4">
      <button class="logout w-full rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-900 hover:text-gray-100">Sign out</button>
    </div>
  `;

  const activeClass = 'bg-gray-900 text-blue-300';
  const active = currentRoute === 'settings' ? root.querySelector('.nav-settings') : root.querySelector('.nav-projects');
  active.classList.add(...activeClass.split(' '));

  root.querySelectorAll('[data-route]').forEach((button) => {
    button.addEventListener('click', () => onNavigate(button.dataset.route));
  });
  root.querySelectorAll('[data-theme]').forEach((button) => {
    if (button.dataset.theme === theme) {
      button.classList.add('bg-blue-600', 'text-white');
    }
    button.addEventListener('click', () => onThemeChange(button.dataset.theme));
  });
  root.querySelector('.logout').addEventListener('click', onLogout);

  return root;
}
