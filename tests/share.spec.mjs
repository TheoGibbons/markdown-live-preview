import { test, expect } from '@playwright/test';
import { createShareUrl, readSharedText } from '../src/share.js';

test('compressed links preserve Unicode, empty documents and URL punctuation', async () => {
    for (const text of ['', '# Hello 🌍\n日本語 & + ? # / %', 'repeat\n'.repeat(10000)]) {
        const url = await createShareUrl(text);
        expect(url).toMatch(/^https:\/\/theogibbons.github.io\/markdown-live-preview\/\?share=v1\.[\w-]+$/);
        expect(await readSharedText(new URL(url).search)).toBe(text);
    }
    await expect(readSharedText('?share=v1.invalid')).rejects.toThrow();
    await expect(createShareUrl('a'.repeat(1024 * 1024 + 1))).rejects.toThrow(/too large/);
    const random = Array.from({ length: 20000 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join('');
    await expect(createShareUrl(random)).rejects.toThrow(/limit/);
});

test('shared text opens in preview mode and can be edited and shared again', async ({ page }) => {
    const text = '# Shared 🌍\n\nHello **reader**.';
    const url = await createShareUrl(text);
    await page.addInitScript(() => localStorage.setItem('com.markdownlivepreview_hidden_pane', 'preview'));
    await page.goto(`./${new URL(url).search}`);
    await expect(page.locator('#output h1')).toHaveText('Shared 🌍');
    await expect(page.locator('#edit')).toBeHidden();
    await expect(page.locator('#preview')).toBeVisible();
    await page.locator('#toggle-edit-pane').click();
    await expect(page.locator('#edit')).toBeVisible();
    await page.locator('#share-button').click();
    await expect(page.locator('#share-dialog')).toBeVisible();
    const generated = await page.locator('#share-link').inputValue();
    expect(await readSharedText(new URL(generated).search)).toBe(text);
});

test('invalid shared text leaves the editor usable', async ({ page }) => {
    const errors = [];
    page.on('dialog', async (dialog) => { errors.push(dialog.message()); await dialog.accept(); });
    await page.goto('./?share=v1.invalid');
    await expect(page.locator('.monaco-editor textarea')).toBeVisible();
    await expect.poll(() => errors.length).toBe(1);
    await expect(page.locator('#output h1').first()).toHaveText('Markdown syntax guide');
});
