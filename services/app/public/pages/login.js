import { navigate, signInWithGoogle, toast } from '../app.js';

/**
 * Renders the login page.
 * @returns {HTMLElement} Login page.
 */
export function renderLogin() {
  const root = document.createElement('main');
  root.className = 'grid min-h-screen place-items-center bg-gray-950 p-6';
  root.innerHTML = `
    <section class="w-full max-w-sm">
      <div class="mb-8">
        <div class="mb-4 grid h-12 w-12 place-items-center rounded-md bg-blue-600 text-lg font-semibold text-white">R</div>
        <h1 class="text-2xl font-semibold tracking-normal text-gray-100">RTDB Manager</h1>
        <p class="mt-2 text-sm text-gray-400">Central Firebase Realtime Database control panel.</p>
      </div>
      <button class="login w-full rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-wait disabled:opacity-60">
        Sign in with Google
      </button>
      <p class="mt-4 min-h-5 text-sm text-red-300" role="alert"></p>
    </section>
  `;

  const button = root.querySelector('.login');
  const errorBox = root.querySelector('[role="alert"]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = 'Signing in...';
    errorBox.textContent = '';

    try {
      await signInWithGoogle();
      toast.success('Signed in');
      navigate('#/projects');
    } catch (error) {
      errorBox.textContent = error.message;
      toast.error(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in with Google';
    }
  });

  return root;
}
