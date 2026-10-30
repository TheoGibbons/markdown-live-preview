import Storehouse from 'storehouse-js';
import * as monaco from 'monaco-editor';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';
import { setupPwa } from './pwa.js';
import { setupAutosave } from './autosave.js';
import { setupTouchSelection } from './touchSelection.js';

const init = () => {
    let scrollBarSync = false;

    const localStorageNamespace = 'com.markdownlivepreview';
    const localStorageKey = 'last_state';
    const localStorageScrollBarKey = 'scroll_bar_settings';
    const localStorageThemeKey = 'theme_settings';
    const localStorageSplitRatioKey = 'com.markdownlivepreview_split_ratio';
    const localStorageHiddenPaneKey = 'com.markdownlivepreview_hidden_pane';
    let mermaidRenderTimer = null;
    let mermaidRenderVersion = 0;
    // default template
    const defaultInput = `# Markdown syntax guide

## Headers

# This is a Heading h1
## This is a Heading h2
###### This is a Heading h6

## Emphasis

*This text will be italic*  
_This will also be italic_

**This text will be bold**  
__This will also be bold__

_You **can** combine them_

## Lists

### Unordered

* Item 1
* Item 2
* Item 2a
* Item 2b
    * Item 3a
    * Item 3b

### Ordered

1. Item 1
2. Item 2
3. Item 3
    1. Item 3a
    2. Item 3b

## Images

![This is an alt text.](${import.meta.env.BASE_URL}image/Markdown-mark.svg "This is a sample image.")

## Links

You may be using [Markdown Live Preview](${import.meta.env.BASE_URL}).

## Blockquotes

> Markdown is a lightweight markup language with plain-text-formatting syntax, created in 2004 by John Gruber with Aaron Swartz.
>
>> Markdown is often used to format readme files, for writing messages in online discussion forums, and to create rich text using a plain text editor.

## Tables

| Left columns  | Right columns |
| ------------- |:-------------:|
| left foo      | right foo     |
| left bar      | right bar     |
| left baz      | right baz     |

## Blocks of code

${"`"}${"`"}${"`"}
let message = 'Hello world';
alert(message);
${"`"}${"`"}${"`"}

## Mermaid diagrams
${"`"}${"`"}${"`"}mermaid
graph TD
  A[Start] --> B{Decision}
  B -->|Yes| C[Finish]
  B -->|No| D[Alternate]
${"`"}${"`"}${"`"}

## Inline code

This web site is using ${"`"}markedjs/marked${"`"}.
`;

    self.MonacoEnvironment = {
        getWorker(_, label) {
            return new Proxy({}, { get: () => () => { } });
        }
    }

    let setupEditor = () => {
        let editor = monaco.editor.create(document.querySelector('#editor'), {
            fontSize: 14,
            language: 'markdown',
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            automaticLayout: true,
            scrollbar: {
                vertical: 'visible',
                horizontal: 'visible'
            },
            wordWrap: 'on',
            hover: { enabled: false },
            quickSuggestions: false,
            suggestOnTriggerCharacters: false,
            folding: false
        });

        // Monaco's context menu has Cut, Copy and Paste but no Select All, which touch screens need.
        editor.addAction({
            id: 'select-all',
            label: 'Select All',
            contextMenuGroupId: '9_cutcopypaste',
            contextMenuOrder: 5,
            run: (ed) => {
                ed.setSelection(ed.getModel().getFullModelRange());
                // The menu leaves focus behind; Copy and typing should act on the selection.
                ed.focus();
            }
        });

        editor.onDidChangeModelContent(() => {
            let value = editor.getValue();
            convert(value);
            saveLastContent(value);
        });

        editor.onDidScrollChange((e) => {
            if (!scrollBarSync) {
                return;
            }

            const scrollTop = e.scrollTop;
            const scrollHeight = e.scrollHeight;
            const height = editor.getLayoutInfo().height;

            const maxScrollTop = scrollHeight - height;
            const scrollRatio = scrollTop / maxScrollTop;

            let previewElement = document.querySelector('#preview');
            let targetY = (previewElement.scrollHeight - previewElement.clientHeight) * scrollRatio;
            previewElement.scrollTo(0, targetY);
        });

        return editor;
    };

    let escapeHtml = (value) => {
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    let createMarkedRenderer = () => {
        const renderer = new marked.Renderer();
        const renderCode = renderer.code.bind(renderer);

        renderer.code = (token) => {
            const lang = (token.lang || '').match(/^\S*/)?.[0].toLowerCase();
            if (lang !== 'mermaid') {
                return renderCode(token);
            }

            return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
        };

        return renderer;
    };

    let configureMermaid = (theme) => {
        mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme
        });
    };

    let showMermaidError = (element, error) => {
        const message = error && error.message ? error.message : 'Unable to render Mermaid chart.';
        element.classList.add('mermaid-error');
        element.textContent = `Mermaid render error: ${message}`;
    };

    let getMermaidTheme = () => {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'default';
    };

    let renderMermaidDiagramsNow = async (theme = getMermaidTheme()) => {
        const outputElement = document.querySelector('#output');
        if (!outputElement) {
            return;
        }

        const version = ++mermaidRenderVersion;
        configureMermaid(theme);

        const elements = Array.from(outputElement.querySelectorAll('.mermaid'));
        for (const [index, element] of elements.entries()) {
            if (version !== mermaidRenderVersion) {
                return;
            }

            const source = element.dataset.mermaidSource || element.textContent;
            element.dataset.mermaidSource = source;
            element.classList.remove('mermaid-error');

            try {
                const renderId = `mermaid-${Date.now()}-${version}-${index}`;
                const { svg, bindFunctions } = await mermaid.render(renderId, source);
                if (version !== mermaidRenderVersion) {
                    return;
                }
                element.innerHTML = svg;
                if (typeof bindFunctions === 'function') {
                    bindFunctions(element);
                }
            } catch (error) {
                showMermaidError(element, error);
            }
        }
    };

    let scheduleMermaidRender = () => {
        if (mermaidRenderTimer) {
            clearTimeout(mermaidRenderTimer);
        }

        mermaidRenderTimer = setTimeout(() => {
            mermaidRenderTimer = null;
            renderMermaidDiagramsNow();
        }, 150);
    };

    let renderMermaidDiagrams = (theme) => {
        if (mermaidRenderTimer) {
            clearTimeout(mermaidRenderTimer);
            mermaidRenderTimer = null;
        }

        return renderMermaidDiagramsNow(theme);
    };

    let renderer = createMarkedRenderer();

    // Render markdown text as html
    let convert = (markdown) => {
        let options = {
            headerIds: false,
            mangle: false,
            renderer
        };
        let html = marked.parse(markdown, options);
        let sanitized = DOMPurify.sanitize(html);
        document.querySelector('#output').innerHTML = sanitized;
        scheduleMermaidRender();
    };

    let presetValue = (value) => {
        editor.setValue(value);
        editor.revealPosition({ lineNumber: 1, column: 1 });
        editor.focus();
    };

    // ----- sync scroll position -----

    let initScrollBarSync = (settings) => {
        let button = document.querySelector('#sync-scroll-button');
        scrollBarSync = settings === true || settings === 'true';
        button.setAttribute('aria-pressed', String(scrollBarSync));

        button.addEventListener('click', () => {
            scrollBarSync = !scrollBarSync;
            button.setAttribute('aria-pressed', String(scrollBarSync));
            saveScrollBarSettings(scrollBarSync);
        });
    };

    // ----- preview CSS loader (switch github-markdown css) -----
    const PREVIEW_CSS_LIGHT = `${import.meta.env.BASE_URL}css/github-markdown-light.css?v=e3dc51b8a261`;
    const PREVIEW_CSS_DARK = `${import.meta.env.BASE_URL}css/github-markdown-dark_dimmed.css?v=df221bf84b9d`;

    let setPreviewCss = (useDark) => {
        const link = document.getElementById('gh-markdown-link');
        const desired = useDark ? PREVIEW_CSS_DARK : PREVIEW_CSS_LIGHT;
        if (!link) {
            const newLink = document.createElement('link');
            newLink.id = 'gh-markdown-link';
            newLink.rel = 'stylesheet';
            newLink.href = desired;
            document.head.appendChild(newLink);
            return new Promise((resolve) => {
                newLink.addEventListener('load', resolve, { once: true });
                newLink.addEventListener('error', resolve, { once: true });
            });
        }

        if (link.getAttribute('href') === desired) {
            return Promise.resolve();
        }

        return new Promise((resolve) => {
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', resolve, { once: true });
            link.setAttribute('href', desired);
        });
    };

    // ----- theme toggle (dark/light) -----
    let setTheme = (enabled) => {
        document.documentElement.setAttribute('data-theme', enabled ? 'dark' : 'light');
        // The icon (swapped in CSS), text and label show the theme a click switches to.
        const button = document.querySelector('#theme-button');
        const label = enabled ? 'Switch to light mode' : 'Switch to dark mode';
        button.setAttribute('aria-label', label);
        button.title = label;
        button.querySelector('.label').textContent = enabled ? 'Light mode' : 'Dark mode';
    };

    let initThemeToggle = (settings) => {
        let button = document.querySelector('#theme-button');
        if (!button) return;
        let enabled = settings;
        setTheme(settings);

        // set Monaco editor theme to match page theme
        if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
            monaco.editor.setTheme(settings ? 'vs-dark' : 'vs');
        }
        // set preview css to match theme
        setPreviewCss(settings);

        button.addEventListener('click', () => {
            enabled = !enabled;
            setTheme(enabled);
            saveThemeSettings(enabled);
            setPreviewCss(enabled);
            if (monaco && monaco.editor && typeof monaco.editor.setTheme === 'function') {
                monaco.editor.setTheme(enabled ? 'vs-dark' : 'vs');
            }
            renderMermaidDiagrams();
        });
    };

    let enableScrollBarSync = () => {
        scrollBarSync = true;
    };

    let disableScrollBarSync = () => {
        scrollBarSync = false;
    };

    // ----- clipboard utils -----

    let copyToClipboard = (text, successHandler, errorHandler) => {
        navigator.clipboard.writeText(text).then(
            () => {
                successHandler();
            },

            () => {
                errorHandler();
            }
        );
    };

    let notifyCopied = () => {
        let button = document.querySelector("#copy-button");
        button.classList.add('copied');
        button.title = 'Copied!';
        setTimeout(() => {
            button.classList.remove('copied');
            button.title = 'Copy the Markdown';
        }, 1000)
    };

    // ----- export preview -----

    let restoreMermaidThemeAfterPrint = (theme) => {
        const printMedia = window.matchMedia('print');
        let printSessionStarted = false;

        const cleanup = () => {
            printMedia.removeEventListener('change', handlePrintMediaChange);
        };

        const handlePrintMediaChange = (event) => {
            if (event.matches) {
                printSessionStarted = true;
                return;
            }

            if (!printSessionStarted) {
                return;
            }

            cleanup();
            renderMermaidDiagrams(theme);
        };

        printMedia.addEventListener('change', handlePrintMediaChange);
        return cleanup;
    };

    let exportPreviewToPdf = () => {
        const currentTheme = getMermaidTheme();
        const printTheme = 'default';

        const cleanupPrintThemeListener = currentTheme === 'dark'
            ? restoreMermaidThemeAfterPrint(currentTheme)
            : null;

        renderMermaidDiagrams(printTheme).then(() => {
            window.print();
        }).catch((error) => {
            // eslint-disable-next-line no-console
            console.error('Failed to prepare PDF export', error);
            if (currentTheme === 'dark') {
                cleanupPrintThemeListener();
                renderMermaidDiagrams(currentTheme);
            }
            window.alert('Unable to prepare the print preview. Please try again.');
        });
    };

    // ----- setup -----

    // setup navigation actions
    let setupOpenButton = () => {
        const button = document.querySelector('#open-button');
        const input = document.querySelector('#open-file-input');

        button.addEventListener('click', () => {
            input.click();
        });

        input.addEventListener('change', async () => {
            const file = input.files[0];
            // Allow the same file to be selected again, including after a failed read.
            input.value = '';
            if (!file) return;

            button.disabled = true;
            let content;
            try {
                content = await file.text();
            } catch (error) {
                window.alert('Unable to read this file. Please try again.');
                return;
            } finally {
                button.disabled = false;
            }

            presetValue(content);
            document.querySelector('#preview').scrollTo({ top: 0 });
        });
    };

    let setupClearButton = (saveAutosave) => {
        document.querySelector("#clear-button").addEventListener('click', (event) => {
            event.preventDefault();
            // The autosave replaces a confirmation: the cleared text can be restored from the Autosaves menu.
            if (!saveAutosave()) {
                window.alert('Unable to autosave the current text, so the editor was not cleared.');
                return;
            }
            presetValue('');
        });
    };

    let setupCopyButton = (editor) => {
        document.querySelector("#copy-button").addEventListener('click', (event) => {
            event.preventDefault();
            let value = editor.getValue();
            copyToClipboard(value, () => {
                notifyCopied();
            },
                () => {
                    // nothing to do
                });
        });
    };

    let setupExportButton = () => {
        const exportButton = document.querySelector('#export-button');
        if (!exportButton) {
            return;
        }
        exportButton.addEventListener('click', (event) => {
            event.preventDefault();
            exportPreviewToPdf();
        });
    };

    // ----- local state -----

    let loadLastContent = () => {
        let lastContent = Storehouse.getItem(localStorageNamespace, localStorageKey);
        return lastContent;
    };

    let saveLastContent = (content) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageKey, content, expiredAt);
    };

    let loadScrollBarSettings = () => {
        let lastContent = Storehouse.getItem(localStorageNamespace, localStorageScrollBarKey);
        return lastContent;
    };

    let loadThemeSettings = () => {
        let last = Storehouse.getItem(localStorageNamespace, localStorageThemeKey);
        if (last === null || last === undefined) {
            try {
                // fallback to raw localStorage boot key used by inline script
                const raw = localStorage.getItem('com.markdownlivepreview_theme');
                if (raw === 'dark') return true;
                if (raw === 'light') return false;
            } catch (e) {
                // ignore
            }
        }
        return last;
    };

    let saveScrollBarSettings = (settings) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageScrollBarKey, settings, expiredAt);
    };

    let saveThemeSettings = (settings) => {
        let expiredAt = new Date(2099, 1, 1);
        Storehouse.setItem(localStorageNamespace, localStorageThemeKey, settings, expiredAt);
        try {
            localStorage.setItem('com.markdownlivepreview_theme', settings ? 'dark' : 'light');
        } catch (e) {
            // ignore storage errors
        }
    };

    let setupDivider = () => {
        let lastLeftRatio = 0.5;
        const divider = document.getElementById('split-divider');
        const leftPane = document.getElementById('edit');
        const rightPane = document.getElementById('preview');
        const container = document.getElementById('container');

        let isDragging = false;

        try {
            const savedRatio = JSON.parse(localStorage.getItem(localStorageSplitRatioKey));
            if (Number.isFinite(savedRatio) && savedRatio > 0 && savedRatio < 1) {
                lastLeftRatio = savedRatio;
            }
        } catch (e) {
            // Use the default split if storage is unavailable or invalid.
        }

        const saveSplitRatio = () => {
            try {
                localStorage.setItem(localStorageSplitRatioKey, JSON.stringify(lastLeftRatio));
            } catch (e) {
                // Keep resizing usable when browser storage is unavailable.
            }
        };

        const applySplitRatio = () => {
            // A lone pane fills the container; the saved ratio applies again once both are shown.
            if (leftPane.hidden || rightPane.hidden) {
                leftPane.style.width = rightPane.style.width = '100%';
                return;
            }
            const availableWidth = container.getBoundingClientRect().width - divider.offsetWidth;
            const minWidth = Math.min(100, availableWidth / 2);
            const leftWidth = Math.max(minWidth, Math.min(availableWidth * lastLeftRatio, availableWidth - minWidth));
            leftPane.style.width = leftWidth + 'px';
            rightPane.style.width = (availableWidth - leftWidth) + 'px';
        };

        applySplitRatio();

        divider.addEventListener('mouseenter', () => {
            divider.classList.add('hover');
        });

        divider.addEventListener('mouseleave', () => {
            if (!isDragging) {
                divider.classList.remove('hover');
            }
        });

        divider.addEventListener('mousedown', () => {
            isDragging = true;
            divider.classList.add('active');
            document.body.style.cursor = 'col-resize';
        });

        divider.addEventListener('dblclick', () => {
            lastLeftRatio = 0.5;
            applySplitRatio();
            saveSplitRatio();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            document.body.style.userSelect = 'none';
            const containerRect = container.getBoundingClientRect();
            const totalWidth = containerRect.width;
            const offsetX = e.clientX - containerRect.left;
            const dividerWidth = divider.offsetWidth;

            // Prevent overlap or out-of-bounds
            const minWidth = Math.min(100, (totalWidth - dividerWidth) / 2);
            const maxWidth = totalWidth - minWidth - dividerWidth;
            const leftWidth = Math.max(minWidth, Math.min(offsetX, maxWidth));
            leftPane.style.width = leftWidth + 'px';
            rightPane.style.width = (totalWidth - leftWidth - dividerWidth) + 'px';
            lastLeftRatio = leftWidth / (totalWidth - dividerWidth);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                divider.classList.remove('active');
                divider.classList.remove('hover');
                document.body.style.cursor = 'default';
                document.body.style.userSelect = '';
                saveSplitRatio();
            }
        });

        window.addEventListener('resize', applySplitRatio);
        return applySplitRatio;
    };

    let setupPaneToggle = (applySplitRatio) => {
        const divider = document.getElementById('split-divider');
        const toggles = [
            { pane: document.getElementById('edit'), button: document.getElementById('toggle-edit-pane') },
            { pane: document.getElementById('preview'), button: document.getElementById('toggle-preview-pane') }
        ];

        const showPanes = (hiddenPaneId) => {
            toggles.forEach(({ pane, button }) => {
                pane.hidden = pane.id === hiddenPaneId;
                button.setAttribute('aria-pressed', String(!pane.hidden));
                // Keep at least one pane on screen.
                button.disabled = hiddenPaneId !== null && !pane.hidden;
            });
            divider.hidden = hiddenPaneId !== null;
            applySplitRatio();
        };

        let hiddenPaneId = null;
        try {
            const saved = localStorage.getItem(localStorageHiddenPaneKey);
            if (toggles.some(({ pane }) => pane.id === saved)) {
                hiddenPaneId = saved;
            }
        } catch (e) {
            // Show both panes if storage is unavailable.
        }
        showPanes(hiddenPaneId);

        toggles.forEach(({ pane, button }) => {
            button.addEventListener('click', () => {
                hiddenPaneId = pane.hidden ? null : pane.id;
                showPanes(hiddenPaneId);
                try {
                    if (hiddenPaneId === null) {
                        localStorage.removeItem(localStorageHiddenPaneKey);
                    } else {
                        localStorage.setItem(localStorageHiddenPaneKey, hiddenPaneId);
                    }
                } catch (e) {
                    // Keep the toggles usable when browser storage is unavailable.
                }
            });
        });
    };

    // ----- entry point -----
    let lastContent = loadLastContent();
    let editor = setupEditor();
    if (typeof lastContent === 'string') {
        presetValue(lastContent);
    } else {
        presetValue(defaultInput);
    }
    setupTouchSelection(editor);
    setupOpenButton();
    setupCopyButton(editor);
    setupExportButton();

    let scrollBarSettings = loadScrollBarSettings() || false;
    initScrollBarSync(scrollBarSettings);

    // initialize theme (dark/light)
    let themeSettings = loadThemeSettings();
    // normalize to boolean (Storehouse may return string or boolean)
    if (themeSettings === 'true' || themeSettings === true) {
        themeSettings = true;
    } else {
        themeSettings = false;
    }
    initThemeToggle(themeSettings);

    setupPaneToggle(setupDivider());
    setupClearButton(setupAutosave(editor, presetValue));
};

window.addEventListener("load", () => {
    init();
    setupPwa();
});
