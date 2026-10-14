import { registerSW } from 'virtual:pwa-register';

export function setupPwa() {
    const status = document.querySelector('#offline-status');
    const installButton = document.querySelector('#install-button');
    const updateButton = document.querySelector('#update-button');
    let installPrompt;

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        installPrompt = event;
        installButton.hidden = false;
    });

    installButton.addEventListener('click', async () => {
        if (!installPrompt) return;
        const prompt = installPrompt;
        installPrompt = null;
        installButton.hidden = true;
        await prompt.prompt();
    });

    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        installButton.hidden = true;
    });

    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

    status.textContent = 'Preparing offline access…';
    const updateSW = registerSW({
        immediate: true,
        onOfflineReady() {
            status.textContent = 'Ready offline';
        },
        onNeedRefresh() {
            status.textContent = 'Update available';
            updateButton.hidden = false;
        },
        onRegisteredSW(_url, registration) {
            if (registration?.active && !registration.waiting && updateButton.hidden) {
                status.textContent = 'Ready offline';
            }
        },
        onRegisterError() {
            status.textContent = 'Offline setup failed. Reload to retry.';
        }
    });

    updateButton.addEventListener('click', () => updateSW(true));
}
