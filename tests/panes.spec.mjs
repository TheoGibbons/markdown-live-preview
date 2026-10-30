import { test, expect } from '@playwright/test';

const HIDDEN_PANE_KEY = 'com.markdownlivepreview_hidden_pane';

async function openPage(page) {
    await page.goto('./');
    await expect(page.locator('.monaco-editor textarea')).toBeVisible();
}

async function paneWidth(page, selector) {
    return page.locator(selector).evaluate((pane) => pane.getBoundingClientRect().width);
}

async function containerWidth(page) {
    return page.locator('#container').evaluate((container) => container.getBoundingClientRect().width);
}

for (const [hiddenSelector, visibleSelector, hideButton, otherButton] of [
    ['#edit', '#preview', '#toggle-edit-pane', '#toggle-preview-pane'],
    ['#preview', '#edit', '#toggle-preview-pane', '#toggle-edit-pane']
]) {
    test(`${hideButton} hides ${hiddenSelector} across reloads and shows it again`, async ({ page }) => {
        await openPage(page);
        await expect(page.locator(hideButton)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(otherButton)).toBeEnabled();

        await page.locator(hideButton).click();
        for (const _ of [0, 1]) {
            await expect(page.locator(hiddenSelector)).toBeHidden();
            await expect(page.locator('#split-divider')).toBeHidden();
            await expect(page.locator(hideButton)).toHaveAttribute('aria-pressed', 'false');
            await expect(page.locator(otherButton)).toBeDisabled();
            await expect.poll(() => paneWidth(page, visibleSelector)).toBeCloseTo(await containerWidth(page), 0);
            await page.reload();
            await expect(page.locator('#toggle-edit-pane')).toBeVisible();
        }

        await page.locator(hideButton).click();
        await expect(page.locator(hiddenSelector)).toBeVisible();
        await expect(page.locator('#split-divider')).toBeVisible();
        await expect(page.locator(hideButton)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator(otherButton)).toBeEnabled();
        await expect.poll(async () => (await paneWidth(page, '#edit')) / (await paneWidth(page, '#preview'))).toBeCloseTo(1, 2);
        await page.reload();
        await expect(page.locator(hiddenSelector)).toBeVisible();
    });
}

test('invalid saved panes show both panes', async ({ page }) => {
    await openPage(page);
    for (const value of ['split-divider', 'container', '']) {
        await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: HIDDEN_PANE_KEY, value });
        await page.reload();
        await expect(page.locator('#edit')).toBeVisible();
        await expect(page.locator('#preview')).toBeVisible();
        await expect(page.locator('#split-divider')).toBeVisible();
    }
});
