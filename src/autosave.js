const STORAGE_KEY = 'com.markdownlivepreview_autosaves';
const INTERVAL_MS = 10_000;

function formatName(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const hour = date.getHours() % 12 || 12;
    const time = `${hour}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
    return `Autosave (${day} ${time})`;
}

function readAutosaves() {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved) || saved.some((item) => !item ||
        typeof item.id !== 'string' || typeof item.name !== 'string' ||
        typeof item.content !== 'string')) {
        throw new Error('Invalid autosave history');
    }
    return saved;
}

export function setupAutosave(editor, loadContent) {
    const dropdown = document.querySelector('#autosave-dropdown');
    const summary = dropdown.querySelector('summary');
    const list = document.querySelector('#autosave-list');
    const empty = document.querySelector('#autosave-empty');
    const status = document.querySelector('#autosave-status');
    const menu = document.querySelector('#autosave-menu');
    const preview = document.querySelector('#autosave-preview');
    let lastSavedContent = editor.getValue();

    const hidePreview = () => {
        preview.hidden = true;
    };

    const showPreview = (button, content) => {
        // Show source text without rendering URLs, HTML or diagrams in the popup.
        preview.querySelector('pre').textContent = content || '(Empty document)';
        preview.hidden = false;
        const rect = button.getBoundingClientRect();
        const width = preview.offsetWidth;
        const height = preview.offsetHeight;
        const right = rect.right + 12;
        const left = right + width <= window.innerWidth - 8 ? right : rect.left - width - 12;
        preview.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
        preview.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
    };

    const reportError = () => {
        status.textContent = 'Unable to save or read autosaves. Browser storage may be full or unavailable.';
        summary.textContent = 'Autosaves (error)';
    };

    const renderList = (autosaves) => {
        hidePreview();
        list.replaceChildren();
        empty.hidden = autosaves.length > 0;
        for (const autosave of [...autosaves].reverse()) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = autosave.name;
            button.addEventListener('mouseenter', () => showPreview(button, autosave.content));
            button.addEventListener('mouseleave', hidePreview);
            button.addEventListener('focus', () => showPreview(button, autosave.content));
            button.addEventListener('blur', hidePreview);
            button.addEventListener('click', () => {
                loadContent(autosave.content);
                // Restoring an existing snapshot should not create a duplicate.
                lastSavedContent = editor.getValue();
                dropdown.open = false;
                hidePreview();
            });
            item.appendChild(button);
            list.appendChild(item);
        }
    };

    const refreshList = () => {
        try {
            renderList(readAutosaves());
            status.textContent = '';
            summary.textContent = 'Autosaves';
        } catch {
            reportError();
        }
    };

    setInterval(() => {
        const content = editor.getValue();
        if (content === lastSavedContent) return;
        try {
            const autosaves = readAutosaves();
            const date = new Date();
            autosaves.push({
                id: crypto.randomUUID(),
                name: formatName(date),
                savedAt: date.toISOString(),
                content
            });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(autosaves));
            lastSavedContent = content;
            status.textContent = '';
            summary.textContent = 'Autosaves';
            renderList(autosaves);
        } catch {
            // Keep the previous history and retry changed content on the next tick.
            reportError();
        }
    }, INTERVAL_MS);

    dropdown.addEventListener('toggle', () => {
        if (!dropdown.open) {
            hidePreview();
            return;
        }
        const rect = summary.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${rect.bottom + 8}px`;
        menu.style.maxHeight = `${Math.max(48, Math.min(420, window.innerHeight - rect.bottom - 16))}px`;
    });
    document.addEventListener('click', (event) => {
        if (!dropdown.contains(event.target)) dropdown.open = false;
    });
    dropdown.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            dropdown.open = false;
            summary.focus();
        }
    });
    menu.addEventListener('scroll', hidePreview);
    window.addEventListener('resize', () => {
        dropdown.open = false;
        hidePreview();
    });
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY || event.key === null) refreshList();
    });
    refreshList();
}
