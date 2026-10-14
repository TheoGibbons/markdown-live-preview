import { registerSW } from 'virtual:pwa-register';

export function setupPwa() {
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

    const updateSW = registerSW({
        immediate: true,
        onNeedRefresh() {
            updateButton.hidden = false;
        },
        onRegisterError(error) {
            console.warn('Unable to enable offline support.', error);
        }
    });

    updateButton.addEventListener('click', () => updateSW(true));
}
