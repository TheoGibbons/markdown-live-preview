import { test, expect, devices } from '@playwright/test';

const DRAFT = 'alpha beta gamma\ndelta epsilon zeta';

async function editorText(page) {
    return page.evaluate(() => {
        for (const raw of Object.values(localStorage)) {
            try {
                const item = JSON.parse(raw);
                if (item.key === 'last_state') return item.value;
            } catch {
                // Not a Storehouse item.
            }
        }
        return null;
    });
}

async function openDraft(page, content) {
    await page.locator('#open-file-input').setInputFiles({
        name: 'draft.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(content)
    });
    await expect.poll(() => editorText(page)).toBe(content);
}

// Client coordinates of a point in a word shown in the editor: 'start', 'middle' or 'end'.
async function wordPoint(page, word, where = 'middle') {
    // Monaco draws changed text on the next animation frame.
    let point;
    await expect.poll(async () => {
        point = await page.evaluate(({ word, where }) => {
            const walker = document.createTreeWalker(document.querySelector('.monaco-editor .view-lines'), NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const index = walker.currentNode.textContent.indexOf(word);
                if (index < 0) continue;
                const range = document.createRange();
                range.setStart(walker.currentNode, index);
                range.setEnd(walker.currentNode, index + word.length);
                const rect = range.getBoundingClientRect();
                const x = { start: rect.left + 1, middle: rect.left + rect.width / 2, end: rect.right - 1 }[where];
                return { x, y: rect.top + rect.height / 2 };
            }
            return null;
        }, { word, where });
        return point;
    }, { message: `${word} is shown in the editor` }).not.toBeNull();
    return point;
}

// Monaco ignores menu clicks for 100ms after opening to avoid accidental ones, so retry until one lands.
async function chooseMenuItem(page, name, method = 'click') {
    await expect(async () => {
        await page.getByRole('menuitem', { name })[method]({ timeout: 500 });
        await expect(page.getByRole('menu')).toHaveCount(0, { timeout: 500 });
    }).toPass();
}

async function touch(page) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    return {
        start: (point) => send('touchStart', [point]),
        async move(from, to, steps = 8) {
            for (let step = 1; step <= steps; step++) {
                await send('touchMove', [{ x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }]);
            }
        },
        end: () => send('touchEnd', [])
    };
}

test.describe('on a phone', () => {
    const { defaultBrowserType, ...pixel } = devices['Pixel 7'];
    test.use(pixel);

    test.beforeEach(async ({ page }) => {
        await page.goto('./');
        await expect(page.locator('.monaco-editor')).toBeVisible();
        // Give the editor the full width so each line of the draft fits on one row.
        await page.locator('#toggle-preview-pane').tap();
        await openDraft(page, DRAFT);
    });

    test('long press selects a word and opens a menu with Select All', async ({ page }) => {
        const finger = await touch(page);
        await finger.start(await wordPoint(page, 'beta'));
        await page.waitForTimeout(800);
        await finger.end();
        const menu = page.getByRole('menu');
        await expect(menu.getByRole('menuitem')).toContainText(['Cut', 'Copy', 'Paste', 'Select All']);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();
        await page.keyboard.insertText('X');
        await expect.poll(() => editorText(page)).toBe('alpha X gamma\ndelta epsilon zeta');
    });

    for (const [direction, from, to] of [
        ['forwards', ['beta', 'middle'], ['epsilon', 'end']],
        ['backwards', ['epsilon', 'middle'], ['beta', 'start']]
    ]) {
        test(`long press and drag ${direction} selects across lines without scrolling`, async ({ page }) => {
            const finger = await touch(page);
            const start = await wordPoint(page, ...from);
            const end = await wordPoint(page, ...to);
            await finger.start(start);
            await page.waitForTimeout(700);
            await finger.move(start, end);
            await finger.end();
            await expect(page.getByRole('menuitem', { name: 'Select All' })).toBeVisible();
            await page.keyboard.press('Escape');
            await page.keyboard.insertText('X');
            await expect.poll(() => editorText(page)).toBe('alpha X zeta');
        });
    }

    test('Select All in the long-press menu selects the whole draft', async ({ page }) => {
        const finger = await touch(page);
        await finger.start(await wordPoint(page, 'gamma'));
        await page.waitForTimeout(700);
        await finger.end();
        await chooseMenuItem(page, 'Select All', 'tap');
        await page.keyboard.insertText('X');
        await expect.poll(() => editorText(page)).toBe('X');
    });

    test('a quick swipe scrolls instead of selecting', async ({ page }) => {
        await openDraft(page, Array.from({ length: 200 }, (_, line) => `row${line}x`).join('\n'));
        const finger = await touch(page);
        const start = await wordPoint(page, 'row20x');
        await finger.start(start);
        await finger.move(start, { x: start.x, y: start.y - 200 });
        await finger.end();
        await page.waitForTimeout(700);
        await expect(page.getByRole('menu')).toHaveCount(0);
        await expect(page.locator('.monaco-editor .view-lines')).not.toContainText('row0x');
    });
});

test('right-click menu has Select All on desktop too', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('.monaco-editor textarea')).toBeVisible();
    await openDraft(page, DRAFT);
    await page.locator('.monaco-editor .view-lines').click({ button: 'right' });
    await chooseMenuItem(page, 'Select All');
    await page.keyboard.insertText('X');
    await expect.poll(() => editorText(page)).toBe('X');
});
