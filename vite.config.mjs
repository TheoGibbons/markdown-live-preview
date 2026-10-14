import { resolve } from 'node:path';
import { cssFiles, updateCssVersions } from './scripts/update-css-version.mjs';
import { VitePWA } from 'vite-plugin-pwa';

export default {
    plugins: [{
        name: 'update-css-versions',
        buildStart() {
            updateCssVersions();
        },
        configureServer(server) {
            server.watcher.add(cssFiles);
            server.watcher.on('change', path => {
                if (cssFiles.includes(resolve(path))) {
                    updateCssVersions();
                }
            });
        }
    }, VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        manifest: {
            name: 'Markdown Live Preview',
            short_name: 'Markdown Preview',
            description: 'A private Markdown editor that works offline.',
            id: './',
            start_url: './',
            scope: './',
            display: 'standalone',
            theme_color: '#444444',
            background_color: '#ffffff',
            icons: [
                { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
            ]
        },
        workbox: {
            clientsClaim: true,
            // Include lazy-loaded diagram code, both themes, local images and fonts.
            globPatterns: ['**/*.{js,css,html,svg,png,webp,ttf,woff,woff2,webmanifest}'],
            maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
            ignoreURLParametersMatching: [/^v$/, /^utm_/, /^fbclid$/],
            // Preview URLs are user content: only the app's static assets are cached.
            runtimeCaching: []
        }
    })]
};
