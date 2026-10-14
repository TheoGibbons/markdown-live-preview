import { test, expect } from '@playwright/test';

const SPLIT_RATIO_KEY = 'com.markdownlivepreview_split_ratio';

async function openEditor(page) {
    await page.goto('./');
    await expect(page.locator('.monaco-editor textarea')).toBeVisible();
}

async function paneRatio(page) {
    return page.evaluate(() => {
        const leftWidth = document.querySelector('#edit').getBoundingClientRect().width;
        const rightWidth = document.querySelector('#preview').getBoundingClientRect().width;
        return leftWidth / (leftWidth + rightWidth);
    });
}

async function dragDivider(page, ratio) {
    const divider = await page.locator('#split-divider').boundingBox();
    const container = await page.locator('#container').boundingBox();
    const y = divider.y + divider.height / 2;
    await page.mouse.move(divider.x + divider.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(container.x + (container.width - divider.width) * ratio, y, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => paneRatio(page)).toBeCloseTo(ratio, 2);
}

test('divider position persists across reloads and resizing, including an even split reset', async ({ page }) => {
    await openEditor(page);
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.5, 2);
    for (const ratio of [0.3, 0.7]) {
        await dragDivider(page, ratio);
        await page.reload();
        await expect.poll(() => paneRatio(page)).toBeCloseTo(ratio, 2);
    }
    await page.setViewportSize({ width: 800, height: 700 });
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.7, 2);
    await page.reload();
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.7, 2);
    await page.locator('#split-divider').dblclick();
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.5, 2);
    await page.setViewportSize({ width: 1100, height: 700 });
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.5, 2);
    await page.reload();
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.5, 2);
});

test('invalid saved positions use the default split', async ({ page }) => {
    await openEditor(page);
    for (const value of ['invalid JSON', '"0.7"', 'null', '0', '1', '-0.1', '1.1']) {
        await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: SPLIT_RATIO_KEY, value });
        await page.reload();
        await expect.poll(() => paneRatio(page)).toBeCloseTo(0.5, 2);
    }
});

test('restored positions keep both panes usable in a smaller window', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 700 });
    await openEditor(page);
    await dragDivider(page, 0.9);
    await page.setViewportSize({ width: 390, height: 700 });
    await page.reload();
    await expect.poll(() => page.locator('#preview').evaluate((pane) => pane.getBoundingClientRect().width)).toBeGreaterThanOrEqual(100);
    await page.setViewportSize({ width: 1400, height: 700 });
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.9, 2);
});

test('divider still works when its storage cannot be read or written', async ({ page }) => {
    await page.addInitScript((key) => {
        for (const method of ['getItem', 'setItem']) {
            const original = Storage.prototype[method];
            Storage.prototype[method] = function (name, ...args) {
                if (name === key) throw new DOMException('Storage unavailable', 'SecurityError');
                return original.call(this, name, ...args);
            };
        }
    }, SPLIT_RATIO_KEY);
    await openEditor(page);
    await dragDivider(page, 0.3);
    await page.locator('#split-divider').dblclick();
    await expect.poll(() => paneRatio(page)).toBeCloseTo(0.5, 2);
});
