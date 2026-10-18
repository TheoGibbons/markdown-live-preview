const STORAGE_KEY = 'com.markdownlivepreview_autosaves';
const INTERVAL_MS = 10_000;

function formatName(date) {
    const pad = (value) => String(value).padStart(2, '0');
    const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const hour = date.getHours() % 12 || 12;
    const time = `${hour}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${date.getHours() < 12 ? 'AM' : 'PM'}`;
    return `Autosave (${day} ${time})`;
}

function nameWithExcerpt(name, content) {
    const timestamp = name.match(/^Autosave \([^)]*\)/)?.[0] || name;
    const excerpt = Array.from(content.replace(/\s+/g, ' ').trim());
    return `${timestamp} ${excerpt.slice(0, 200).join('')}${excerpt.length > 200 ? '…' : ''}`;
}

function displayName(autosave) {
    return autosave.customName || nameWithExcerpt(autosave.name, autosave.content);
}

function readAutosaves() {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(saved) || saved.some((item) => !item ||
        typeof item.id !== 'string' || typeof item.name !== 'string' ||
        typeof item.content !== 'string' ||
        (item.customName !== undefined && typeof item.customName !== 'string'))) {
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
    const renameButton = document.querySelector('#autosave-rename');
    let lastSavedContent = editor.getValue();
    let previewTimer;
    let closeTimer;
    let previewId;

    const cancelClose = () => clearTimeout(closeTimer);
    const isPreviewActive = () => preview.matches(':hover') || preview.contains(document.activeElement);

    const hidePreview = () => {
        clearTimeout(previewTimer);
        preview.hidden = true;
        previewId = null;
    };

    const closeMenu = () => {
        cancelClose();
        dropdown.open = false;
        hidePreview();
    };

    const scheduleClose = () => {
        cancelClose();
        // Allow time to cross the gaps between the summary, list and preview.
        closeTimer = setTimeout(() => {
            if (!dropdown.matches(':hover') && !dropdown.contains(document.activeElement) && !isPreviewActive()) {
                closeMenu();
            }
        }, 300);
    };

    const scheduleHidePreview = () => {
        clearTimeout(previewTimer);
        previewTimer = setTimeout(() => {
            if (!isPreviewActive() && !list.contains(document.activeElement)) hidePreview();
        }, 300);
    };

    const showPreview = (button, autosave) => {
        cancelClose();
        clearTimeout(previewTimer);
        // Show source text without rendering URLs, HTML or diagrams in the popup.
        if (previewId !== autosave.id) {
            preview.querySelector('pre').textContent = autosave.content || '(Empty document)';
            preview.scrollTop = 0;
            previewId = autosave.id;
        }
        preview.hidden = false;
        preview.style.maxHeight = 'min(420px, 60vh)';
        const rect = button.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const width = preview.offsetWidth;
        const height = preview.offsetHeight;
        const right = menuRect.right + 12;
        const left = menuRect.left - width - 12;
        if (right + width <= window.innerWidth - 8 || left >= 8) {
            preview.style.left = `${right + width <= window.innerWidth - 8 ? right : left}px`;
            preview.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - height - 8))}px`;
        } else {
            // Stack the panels on narrow screens so the preview cannot cover a save button.
            menu.style.maxHeight = `${Math.min(420, Math.max(48, (window.innerHeight - menuRect.top - 24) / 2))}px`;
            const top = menu.getBoundingClientRect().bottom + 12;
            preview.style.left = `${Math.max(8, Math.min(menuRect.left, window.innerWidth - width - 8))}px`;
            preview.style.top = `${top}px`;
            preview.style.maxHeight = `${Math.max(40, Math.min(420, window.innerHeight - top - 8))}px`;
        }
    };

    const reportError = () => {
        status.textContent = 'Unable to save or read autosaves. Browser storage may be full or unavailable.';
        summary.textContent = 'Autosaves (error)';
    };

    const renderList = (autosaves) => {
        // Keep a selected preview intact when a new autosave updates the list.
        if (!autosaves.some((autosave) => autosave.id === previewId)) hidePreview();
        list.replaceChildren();
        empty.hidden = autosaves.length > 0;
        for (const autosave of [...autosaves].reverse()) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = displayName(autosave);
            button.addEventListener('mouseenter', () => showPreview(button, autosave));
            button.addEventListener('mouseleave', scheduleHidePreview);
            button.addEventListener('focus', () => showPreview(button, autosave));
            button.addEventListener('blur', scheduleHidePreview);
            button.addEventListener('click', () => {
                loadContent(autosave.content);
                // Restoring an existing snapshot should not create a duplicate.
                lastSavedContent = editor.getValue();
                closeMenu();
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
                name: nameWithExcerpt(formatName(date), content),
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

    dropdown.addEventListener('pointerenter', (event) => {
        if (event.pointerType === 'touch') return;
        cancelClose();
        dropdown.open = true;
    });
    dropdown.addEventListener('pointerleave', scheduleClose);
    summary.addEventListener('click', (event) => {
        // Retain native keyboard/touch activation without closing a hovered menu.
        if (event.detail && window.matchMedia('(hover: hover)').matches) {
            event.preventDefault();
            dropdown.open = true;
        }
    });
    renameButton.addEventListener('click', () => {
        try {
            const current = readAutosaves().find((item) => item.id === previewId);
            if (!current) return;
            const name = window.prompt('Rename autosave (leave empty to restore the default name):', displayName(current));
            if (name === null) return;
            // Re-read in case another tab saved while the prompt was open.
            const autosaves = readAutosaves();
            const autosave = autosaves.find((item) => item.id === current.id);
            if (!autosave) return;
            if (name.trim()) {
                autosave.customName = name.trim();
            } else {
                delete autosave.customName;
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify(autosaves));
            status.textContent = '';
            summary.textContent = 'Autosaves';
            renderList(autosaves);
        } catch {
            reportError();
        }
    });
    preview.addEventListener('pointerenter', () => {
        cancelClose();
        clearTimeout(previewTimer);
    });
    preview.addEventListener('pointerleave', () => {
        scheduleClose();
        scheduleHidePreview();
    });
    preview.addEventListener('focusin', () => {
        cancelClose();
        clearTimeout(previewTimer);
    });
    preview.addEventListener('focusout', () => {
        scheduleClose();
        scheduleHidePreview();
    });

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
        if (!dropdown.contains(event.target) && !preview.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && dropdown.open) {
            closeMenu();
            summary.focus();
        }
    });
    menu.addEventListener('scroll', hidePreview);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('storage', (event) => {
        if (event.key === STORAGE_KEY || event.key === null) refreshList();
    });
    refreshList();
}
