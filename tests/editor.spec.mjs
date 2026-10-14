import { test, expect } from '@playwright/test';

const AUTOSAVES_KEY = 'com.markdownlivepreview_autosaves';

async function openEditor(page) {
    await page.goto('./');
    await expect(page.locator('.monaco-editor textarea')).toBeVisible();
    await expect(page.locator('#output .mermaid svg')).toBeVisible();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

async function typeDraft(page, text) {
    await page.locator('.monaco-editor textarea').press('ControlOrMeta+A');
    await page.keyboard.insertText(text);
    await expect.poll(() => page.evaluate((expected) => Object.values(localStorage).some((raw) => {
        try { const item = JSON.parse(raw); return item.key === 'last_state' && item.value === expected; }
        catch { return false; }
    }), text)).toBe(true);
}

async function openDraft(page, content) {
    await page.locator('#open-file-input').setInputFiles({
        name: 'draft.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(content)
    });
    await expect.poll(() => page.evaluate((expected) => Object.values(localStorage).some((raw) => {
        try { const item = JSON.parse(raw); return item.key === 'last_state' && item.value === expected; }
        catch { return false; }
    }), content)).toBe(true);
}

async function autosaves(page) {
    return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), AUTOSAVES_KEY);
}

test('app has no external requests or draft uploads; user image URLs still load', async ({ page, context, baseURL }) => {
    const requests = [];
    context.on('request', (request) => requests.push(request));
    await openEditor(page);
    const draft = 'PRIVACY_TEST_PRIVATE_DRAFT';
    await typeDraft(page, draft);
    await expect(page.locator('#output')).toHaveText(draft);
    expect(requests.filter((request) => new URL(request.url()).origin !== new URL(baseURL).origin)).toEqual([]);
    expect(requests.filter((request) => `${request.url()} ${request.postData() || ''}`.includes(draft))).toEqual([]);

    await context.route('https://example.test/**', (route) => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    }));
    const imageURL = 'https://example.test/user-image?text=USER_CHOSEN_URL';
    await openDraft(page, `![Image](${imageURL})`);
    await expect.poll(() => requests.some((request) => request.url() === imageURL)).toBe(true);
    await expect(page.locator('#output img')).toHaveAttribute('src', imageURL);
});

test('all built-in assets, unused diagram code and the draft work after an offline reload', async ({ page, context }) => {
    await openEditor(page);
    await context.setOffline(true);
    // Discard the HTTP cache so this verifies the service worker's offline cache.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await page.reload();
    await expect(page.locator('footer')).toHaveCount(0);
    await expect(page.locator('#output .mermaid svg')).toBeVisible();
    expect(await page.locator('#output img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);

    await page.locator('#theme-checkbox').check();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.locator('#gh-markdown-link').evaluate((link) => !!link.sheet)).toBe(true);

    await openDraft(page, '# Offline draft\n\n```mermaid\nsequenceDiagram\n  Alice->>Bob: Works offline\n```');
    await expect(page.locator('#output .mermaid svg')).toBeVisible();
    await expect(page.locator('#output .mermaid')).toContainText('Works offline');
    await page.reload();
    await expect(page.locator('#output h1')).toHaveText('Offline draft');
    await expect(page.locator('#output .mermaid svg')).toBeVisible();

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.locator('#copy-button').click();
    await expect(page.locator('#copy-button')).toHaveText('Copied!');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Works offline');

    await page.evaluate(() => { window.print = () => { window.printCalled = true; }; });
    await page.locator('#export-button').click();
    await expect.poll(() => page.evaluate(() => window.printCalled)).toBe(true);
});

test('manifest and icons meet Chromium installation requirements at the deployment path', async ({ playwright, baseURL }) => {
    // Installation is disabled in Playwright's default incognito contexts.
    const context = await playwright.chromium.launchPersistentContext('', {
        baseURL,
        executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    });
    try {
        const page = context.pages()[0];
        await openEditor(page);
        const cdp = await context.newCDPSession(page);
        const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
        expect(installabilityErrors).toEqual([]);
        const manifestURL = await page.locator('link[rel="manifest"]').evaluate((link) => link.href);
        const manifest = await page.evaluate(async (url) => (await fetch(url)).json(), manifestURL);
        expect(new URL(manifest.start_url, manifestURL).href).toBe(baseURL);
        expect(new URL(manifest.scope, manifestURL).href).toBe(baseURL);
        expect(manifest.display).toBe('standalone');
        for (const size of [192, 512]) {
            const icon = manifest.icons.find((item) => item.sizes === `${size}x${size}`);
            const dimensions = await page.evaluate(async (url) => {
                const image = new Image();
                image.src = url;
                await image.decode();
                return [image.naturalWidth, image.naturalHeight];
            }, new URL(icon.src, manifestURL).href);
            expect(dimensions).toEqual([size, size]);
        }
    } finally {
        await context.close();
    }
});

test('autosaves changed text every 10 seconds, persists history, previews and restores snapshots', async ({ page }) => {
    await page.clock.install();
    await openEditor(page);
    await page.clock.setFixedTime(new Date('2026-10-13T22:50:44Z'));
    await page.clock.fastForward(20_000);
    expect(await autosaves(page)).toEqual([]);

    await openDraft(page, 'First saved draft');
    expect(await autosaves(page)).toEqual([]);
    await page.clock.fastForward(10_000);
    expect(await autosaves(page)).toMatchObject([{
        name: 'Autosave (2026-10-13 3:50:44 PM) First saved dra...', content: 'First saved draft'
    }]);
    await page.clock.fastForward(20_000);
    expect(await autosaves(page)).toHaveLength(1);

    await page.clock.setFixedTime(new Date('2026-10-13T22:50:54Z'));
    await openDraft(page, 'Second saved draft');
    await page.clock.fastForward(10_000);
    expect(await autosaves(page)).toHaveLength(2);
    await page.reload();
    await expect(page.locator('#output')).toHaveText('Second saved draft');
    await page.locator('#autosave-dropdown summary').hover();
    const entries = page.locator('#autosave-list button');
    await expect(entries).toHaveCount(2);
    await expect(entries.first()).toHaveText('Autosave (2026-10-13 3:50:54 PM) Second saved dr...');
    await entries.last().hover();
    await expect(page.locator('#autosave-preview pre')).toHaveText('First saved draft');
    await entries.last().focus();
    await expect(page.locator('#autosave-preview')).toBeVisible();
    await entries.last().click();
    await expect(page.locator('#output')).toHaveText('First saved draft');
    await expect(page.locator('#autosave-preview')).toBeHidden();
    await page.clock.fastForward(10_000);
    expect(await autosaves(page)).toHaveLength(2);
});

test('hover preview shows source without requesting images and stays within a mobile viewport', async ({ page, context }) => {
    const content = '![Private image](https://example.test/preview-image)\n<img src="https://example.test/html-image">';
    await page.addInitScript(({ key, content }) => localStorage.setItem(key, JSON.stringify([{
        id: 'preview-test', name: 'Autosave (2026-10-13 3:50:44 PM)', content
    }])), { key: AUTOSAVES_KEY, content });
    const remoteRequests = [];
    context.on('request', (request) => {
        if (request.url().startsWith('https://example.test/')) remoteRequests.push(request.url());
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await openEditor(page);
    await page.locator('#autosave-dropdown summary').hover();
    await page.locator('#autosave-list button').hover();
    await expect(page.locator('#autosave-list button')).toHaveText('Autosave (2026-10-13 3:50:44 PM) ![Private image...');
    await expect(page.locator('#autosave-preview pre')).toHaveText(content);
    await expect(page.locator('#autosave-preview img')).toHaveCount(0);
    expect(remoteRequests).toEqual([]);
    for (const selector of ['#autosave-menu', '#autosave-preview']) {
        const box = await page.locator(selector).boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(390);
        expect(box.y + box.height).toBeLessThanOrEqual(844);
    }
    await page.locator('#autosave-list button').press('Escape');
    await expect(page.locator('#autosave-preview')).toBeHidden();
    await expect(page.locator('#autosave-menu')).toBeHidden();
});

test('hover menu stays open while crossing into a preview to scroll, select and copy text', async ({ page, context }) => {
    const content = Array.from({ length: 80 }, (_, index) => `COPY_THIS_TEXT_${index}: This is a long saved draft.`).join('\n');
    await page.addInitScript(({ key, content }) => localStorage.setItem(key, JSON.stringify([{
        id: 'long-preview', name: 'Autosave (2026-10-14 9:45:24 AM)', content
    }])), { key: AUTOSAVES_KEY, content });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.clock.install();
    await openEditor(page);
    await openDraft(page, 'Pending new draft');
    const summary = page.locator('#autosave-dropdown summary');
    const menu = page.locator('#autosave-menu');
    const preview = page.locator('#autosave-preview');

    await summary.hover();
    await expect(menu).toBeVisible();
    await page.mouse.move(1100, 700);
    await page.clock.fastForward(500);
    await expect(menu).toBeHidden();

    await summary.hover();
    const entry = page.locator('#autosave-list button');
    await expect(entry).toHaveText('Autosave (2026-10-14 9:45:24 AM) COPY_THIS_TEXT_...');
    await entry.hover();
    const box = await entry.boundingBox();
    await page.mouse.move(box.x + box.width + 10, box.y + box.height / 2);
    await page.clock.fastForward(100);
    await expect(preview).toBeVisible();
    await preview.hover();
    await page.clock.fastForward(500);
    await expect(preview).toBeVisible();
    await expect(menu).toBeVisible();

    await page.mouse.wheel(0, 600);
    await expect.poll(() => preview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await preview.evaluate((element) => { element.scrollTop = 0; });
    const selectionBox = await preview.locator('pre').evaluate((element) => {
        const range = document.createRange();
        range.setStart(element.firstChild, 0);
        range.setEnd(element.firstChild, 15);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, right: rect.right, middle: rect.top + rect.height / 2 };
    });
    await page.mouse.move(selectionBox.left + 1, selectionBox.middle);
    await page.mouse.down();
    await page.mouse.move(selectionBox.right - 1, selectionBox.middle, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection().toString())).toBe('COPY_THIS_TEXT_');
    await page.clock.fastForward(10_000);
    await expect(preview).toBeVisible();
    await expect(menu).toBeVisible();
    await expect.poll(() => autosaves(page)).toHaveLength(2);
    // Updating the autosave list must preserve a selection in the preview.
    expect(await page.evaluate(() => window.getSelection().toString())).toBe('COPY_THIS_TEXT_');
    await page.keyboard.press('ControlOrMeta+C');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('COPY_THIS_TEXT_');
    await page.locator('#editor').click({ position: { x: 20, y: 100 } });
    await expect(preview).toBeHidden();
    await expect(menu).toBeHidden();
});

test('storage failure preserves history and retries the pending autosave', async ({ page }) => {
    await page.clock.install();
    await openEditor(page);
    await openDraft(page, 'Existing snapshot');
    await page.clock.fastForward(10_000);
    await page.evaluate((key) => {
        window.originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
            if (name === key) throw new DOMException('Storage full', 'QuotaExceededError');
            return window.originalSetItem.call(this, name, value);
        };
    }, AUTOSAVES_KEY);
    await openDraft(page, 'Pending snapshot');
    await page.clock.fastForward(10_000);
    expect(await autosaves(page)).toHaveLength(1);
    await expect(page.locator('#autosave-dropdown summary')).toHaveText('Autosaves (error)');
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; });
    await page.clock.fastForward(10_000);
    expect(await autosaves(page)).toMatchObject([{ content: 'Existing snapshot' }, { content: 'Pending snapshot' }]);
    await expect(page.locator('#autosave-dropdown summary')).toHaveText('Autosaves');
});
