export const SHARE_BASE_URL = 'https://theogibbons.github.io/markdown-live-preview/';
export const MAX_SHARE_URL_LENGTH = 8000;
const MAX_TEXT_BYTES = 1024 * 1024;

export async function createShareUrl(text) {
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > MAX_TEXT_BYTES) throw new Error('This document is too large to share as a link.');
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < compressed.length; offset += 8192) {
        binary += String.fromCharCode(...compressed.subarray(offset, offset + 8192));
    }
    const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const url = `${SHARE_BASE_URL}?share=v1.${encoded}`;
    if (url.length > MAX_SHARE_URL_LENGTH) {
        throw new Error(`This document creates a ${url.length.toLocaleString()}-character link, exceeding our ${MAX_SHARE_URL_LENGTH.toLocaleString()}-character limit. Shorten the document or share it as a file.`);
    }
    return url;
}

export async function readSharedText(search) {
    const value = new URLSearchParams(search).get('share');
    if (value === null) return null;
    if (SHARE_BASE_URL.length + search.length > MAX_SHARE_URL_LENGTH || !/^v1\.[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error('Invalid or oversized share link.');
    }
    const bytes = Uint8Array.from(atob(value.slice(3).replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    const chunks = [];
    let size = 0;
    // Bound decompression so a crafted link cannot expand without limit.
    while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > MAX_TEXT_BYTES) {
            await reader.cancel();
            throw new Error('Shared document is too large.');
        }
        chunks.push(chunk);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(await new Blob(chunks).arrayBuffer());
}

export function setupShareButton(editor) {
    const button = document.querySelector('#share-button');
    const dialog = document.querySelector('#share-dialog');
    const link = document.querySelector('#share-link');
    const status = document.querySelector('#share-status');
    document.querySelector('#share-close').addEventListener('click', () => dialog.close());
    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            link.value = await createShareUrl(editor.getValue());
            status.textContent = `${link.value.length.toLocaleString()} / ${MAX_SHARE_URL_LENGTH.toLocaleString()} characters. Anyone with this link can read the document. Some sharing services may have lower limits.`;
            dialog.showModal();
            link.focus();
            link.select();
            try {
                await navigator.clipboard.writeText(link.value);
                status.textContent = `Link copied. ${status.textContent}`;
            } catch {
                status.textContent = `Copy the link below. ${status.textContent}`;
            }
        } catch (error) {
            window.alert(error.message || 'Unable to create a share link in this browser.');
        } finally {
            button.disabled = false;
        }
    });
}
