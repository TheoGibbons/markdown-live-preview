import { defineConfig } from '@playwright/test';

const basePath = process.env.TEST_BASE_PATH || '/markdown-live-preview/';

export default defineConfig({
    testDir: './tests',
    fullyParallel: true,
    workers: 2,
    use: {
        baseURL: `http://127.0.0.1:4174${basePath}`,
        timezoneId: 'America/Whitehorse',
        launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
        }
    },
    webServer: {
        command: `npm run preview -- --host 127.0.0.1 --port 4174 --strictPort --base=${basePath}`,
        url: `http://127.0.0.1:4174${basePath}`,
        reuseExistingServer: false
    }
});
