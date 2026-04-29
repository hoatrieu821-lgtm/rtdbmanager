import { Toast } from './components/Toast.js';
import { Sidebar } from './components/Sidebar.js';
import { renderLogin } from './pages/login.js';
import { renderProjects } from './pages/projects.js';
import { renderExplorer } from './pages/explorer.js';
import { renderSettings } from './pages/settings.js';

export const store = {
  user: null,
  projects: [],
  firebaseConfig: null,
  ui: {
    theme: localStorage.getItem('rtdb.theme') || 'dark'
  }
};

export const toast = new Toast();

let firebaseApp = null;
let firebaseSdkPromise = null;

/**
 * Loads Firebase Auth modules only when sign-in needs them.
 * @returns {Promise<object>} Firebase app/auth module helpers.
 */
async function loadFirebaseSdk() {
  if (!firebaseSdkPromise) {
    firebaseSdkPromise = Promise.all([
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js')
    ]).then(([appModule, authModule]) => ({
      initializeApp: appModule.initializeApp,
      getApps: appModule.getApps,
      getAuth: authModule.getAuth,
      GoogleAuthProvider: authModule.GoogleAuthProvider,
      signInWithPopup: authModule.signInWithPopup
    }));
  }

  return firebaseSdkPromise;
}

/**
 * Applies the current visual theme to the document.
 * @returns {void}
 */
export function applyTheme() {
  const isLight = store.ui.theme === 'light';
  document.documentElement.classList.toggle('theme-light', isLight);
  document.documentElement.classList.toggle('theme-dark', !isLight);
  document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
}

/**
 * Updates and persists the visual theme.
 * @param {'light'|'dark'} theme Theme value.
 * @returns {void}
 */
export function setTheme(theme) {
  store.ui.theme = theme === 'light' ? 'light' : 'dark';
  localStorage.setItem('rtdb.theme', store.ui.theme);
  applyTheme();
}

/**
 * Fetches JSON with standard error handling.
 * @param {string} url Request URL.
 * @param {RequestInit} options Fetch options.
 * @returns {Promise<any>} Parsed JSON response.
 */
export async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    credentials: 'same-origin',
    ...options,
    headers
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok || payload?.ok === false) {
    const message = payload?.message || payload?.error?.message || payload?.error || response.statusText;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

/**
 * Navigates to a hash route.
 * @param {string} hash Hash route.
 * @returns {void}
 */
export function navigate(hash) {
  window.location.hash = hash;
}

/**
 * Loads public Firebase client config from the backend.
 * @returns {Promise<object>} Firebase client config.
 */
async function loadFirebaseConfig() {
  if (store.firebaseConfig) {
    return store.firebaseConfig;
  }

  const response = await apiFetch('/auth/firebase-config');
  store.firebaseConfig = response.config;
  return store.firebaseConfig;
}

/**
 * Returns the Firebase Auth instance.
 * @returns {Promise<object>} Firebase Auth helpers.
 */
async function getFirebaseAuth() {
  const [config, sdk] = await Promise.all([
    loadFirebaseConfig(),
    loadFirebaseSdk()
  ]);

  firebaseApp = sdk.getApps().length ? sdk.getApps()[0] : sdk.initializeApp(config);
  return {
    auth: sdk.getAuth(firebaseApp),
    GoogleAuthProvider: sdk.GoogleAuthProvider,
    signInWithPopup: sdk.signInWithPopup
  };
}

/**
 * Warms Firebase Auth in the background after the login page is visible.
 * @returns {Promise<object>} Firebase Auth helpers.
 */
export async function preloadFirebaseAuth() {
  return getFirebaseAuth();
}

/**
 * Converts Firebase Auth errors into actionable UI messages.
 * @param {unknown} error Firebase Auth error.
 * @returns {Error} Normalized error.
 */
function normalizeAuthError(error) {
  if (error?.code === 'auth/internal-error') {
    return new Error('Google sign-in could not load correctly. Check browser popup blocking, Firebase Auth authorized domains, and API key restrictions.');
  }

  if (error?.code === 'auth/configuration-not-found') {
    return new Error('Firebase Authentication is not configured for this Firebase project/API key. Enable Authentication and Google provider in Firebase Console, then copy the exact Web app config into .env.');
  }

  if (error?.code === 'auth/unauthorized-domain') {
    return new Error(`This domain is not authorized in Firebase Auth. Add ${window.location.hostname} in Firebase Console > Authentication > Settings > Authorized domains.`);
  }

  if (error?.code === 'auth/popup-blocked') {
    return new Error('The browser blocked the Google sign-in popup.');
  }

  if (error?.code === 'auth/popup-closed-by-user') {
    return new Error('The Google sign-in popup was closed before sign-in finished.');
  }

  return error instanceof Error ? error : new Error('Google sign-in failed.');
}

/**
 * Starts Google sign-in and creates a server-side session.
 * @returns {Promise<object>} Authenticated user.
 */
export async function signInWithGoogle() {
  const { auth, GoogleAuthProvider, signInWithPopup } = await getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  let credential;

  try {
    credential = await signInWithPopup(auth, provider);
  } catch (error) {
    throw normalizeAuthError(error);
  }

  const idToken = await credential.user.getIdToken();
  const response = await apiFetch('/auth/login-google', {
    method: 'POST',
    body: JSON.stringify({ idToken })
  });

  store.user = response.user;
  return response.user;
}

/**
 * Logs out of the server-side session.
 * @returns {Promise<void>} Resolves after logout.
 */
export async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  store.user = null;
  store.projects = [];
  navigate('#/login');
}

/**
 * Checks the existing server-side session.
 * @returns {Promise<void>} Resolves after session check.
 */
async function checkSession() {
  try {
    const response = await apiFetch('/auth/me');
    store.user = response.user;
  } catch (error) {
    store.user = null;
  }
}

/**
 * Parses the current hash route.
 * @returns {{name: string, params: object}} Route info.
 */
function parseRoute() {
  const hash = window.location.hash || '#/projects';
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const name = parts[0] || 'projects';

  if (name === 'explorer') {
    return { name, params: { projectId: parts[1] } };
  }

  return { name, params: {} };
}

/**
 * Renders the application shell and active page.
 * @returns {Promise<void>} Resolves after render.
 */
async function render() {
  const app = document.getElementById('app');
  const route = parseRoute();

  if (!store.user && route.name !== 'login') {
    navigate('#/login');
    return;
  }

  if (store.user && route.name === 'login') {
    navigate('#/projects');
    return;
  }

  let page;
  if (route.name === 'login') {
    page = await renderLogin();
  } else if (route.name === 'settings') {
    page = await renderSettings();
  } else if (route.name === 'explorer' && route.params.projectId) {
    page = await renderExplorer(route.params.projectId);
  } else {
    page = await renderProjects();
  }

  if (route.name === 'login') {
    app.innerHTML = '';
    app.append(page);
    return;
  }

  app.innerHTML = `
    <div class="grid min-h-screen grid-cols-1 md:grid-cols-[240px_1fr]">
      <aside id="sidebar" class="border-b border-gray-800 bg-gray-950 md:border-b-0 md:border-r"></aside>
      <main id="main" class="min-w-0 bg-gray-950"></main>
    </div>
  `;

  document.getElementById('sidebar').append(Sidebar({
    user: store.user,
    currentRoute: route.name,
    theme: store.ui.theme,
    onNavigate: navigate,
    onThemeChange: (theme) => {
      setTheme(theme);
      render().catch((error) => toast.error(error.message));
    },
    onLogout: async () => {
      try {
        await logout();
      } catch (error) {
        toast.error(error.message);
      }
    }
  }));
  document.getElementById('main').append(page);
}

window.addEventListener('hashchange', () => {
  render().catch((error) => toast.error(error.message));
});

window.addEventListener('DOMContentLoaded', async () => {
  applyTheme();
  await checkSession();
  await render();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
});
