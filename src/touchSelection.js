import { Position, Selection } from 'monaco-editor';

const LONG_PRESS_MS = 500;
// Finger movement allowed before a press counts as a scroll instead.
const MOVE_TOLERANCE = 10;
// Dragging within this distance of the top or bottom edge scrolls the editor.
const EDGE_SIZE = 32;
// Monaco turns the end of every touch into one of these, which would collapse the selection or reopen the menu.
const MONACO_GESTURES = ['-monaco-gesturetap', '-monaco-gesturecontextmenu'];

// Monaco has no touch selection: long press selects the word under the finger, dragging extends the
// selection, and lifting the finger opens the editor's context menu (Cut, Copy, Paste, Select All).
export function setupTouchSelection(editor) {
    const editorElement = editor.getDomNode();
    let press = null;
    let scrollFrame = 0;
    let ignoreMenusUntil = 0;

    const positionAt = (x, y) => {
        // Clamp to the text so dragging past an edge selects up to that edge.
        const rect = editorElement.getBoundingClientRect();
        const layout = editor.getLayoutInfo();
        const left = rect.left + layout.contentLeft;
        const bottom = rect.top + layout.height - layout.horizontalScrollbarHeight - 1;
        const target = editor.getTargetAtClientPoint(
            Math.min(Math.max(x, left), left + layout.contentWidth - 1),
            Math.min(Math.max(y, rect.top), bottom));
        return target?.position ?? null;
    };

    const selectTo = (x, y) => {
        const position = positionAt(x, y);
        if (!position) return;
        // Keep the long-pressed word selected whichever way the finger moves.
        if (Position.isBefore(position, press.start)) {
            editor.setSelection(Selection.fromPositions(press.end, position));
        } else if (Position.isBefore(press.end, position)) {
            editor.setSelection(Selection.fromPositions(press.start, position));
        } else {
            editor.setSelection(Selection.fromPositions(press.start, press.end));
        }
    };

    const startSelecting = () => {
        clearTimeout(press.timer);
        const position = positionAt(press.x, press.y);
        if (!position) {
            press = null;
            return;
        }
        const word = editor.getModel().getWordAtPosition(position);
        press.start = word ? new Position(position.lineNumber, word.startColumn) : position;
        press.end = word ? new Position(position.lineNumber, word.endColumn) : position;
        press.selecting = true;
        editor.setSelection(Selection.fromPositions(press.start, press.end));
    };

    const autoScroll = () => {
        scrollFrame = 0;
        if (!press?.selecting) return;
        const rect = editorElement.getBoundingClientRect();
        const overTop = press.lastY - (rect.top + EDGE_SIZE);
        const overBottom = press.lastY - (rect.bottom - EDGE_SIZE);
        const offset = overTop < 0 ? overTop : Math.max(overBottom, 0);
        if (!offset) return;
        // Scroll faster the further the finger is into the edge.
        editor.setScrollTop(editor.getScrollTop() + Math.max(-EDGE_SIZE, Math.min(EDGE_SIZE, offset)) / 2);
        selectTo(press.lastX, press.lastY);
        scrollFrame = requestAnimationFrame(autoScroll);
    };

    const endPress = () => {
        clearTimeout(press?.timer);
        cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
        press = null;
    };

    const findTouch = (touches) => press && Array.from(touches).find((touch) => touch.identifier === press.id);

    window.addEventListener('touchstart', (event) => {
        endPress();
        const linesContent = event.target.closest?.('.lines-content');
        if (event.touches.length !== 1 || !linesContent || !editorElement.contains(linesContent)) return;
        const touch = event.touches[0];
        press = {
            id: touch.identifier,
            x: touch.clientX,
            y: touch.clientY,
            lastX: touch.clientX,
            lastY: touch.clientY,
            selecting: false,
            timer: setTimeout(startSelecting, LONG_PRESS_MS)
        };
    }, { capture: true, passive: true });

    window.addEventListener('touchmove', (event) => {
        const touch = findTouch(event.changedTouches);
        if (!touch) return;
        if (!press.selecting) {
            if (Math.hypot(touch.clientX - press.x, touch.clientY - press.y) > MOVE_TOLERANCE) endPress();
            return;
        }
        // Stop Monaco (listening on document) and the browser from scrolling instead.
        event.preventDefault();
        event.stopPropagation();
        press.lastX = touch.clientX;
        press.lastY = touch.clientY;
        selectTo(touch.clientX, touch.clientY);
        if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
    }, { capture: true, passive: false });

    const onTouchEnd = (event) => {
        const touch = findTouch(event.changedTouches);
        if (!touch) return;
        const selecting = press.selecting;
        endPress();
        if (!selecting || event.type === 'touchcancel') return;
        event.preventDefault();
        ignoreMenusUntil = performance.now() + 500;
        // Focus first so the menu's Cut, Copy and Paste act on the editor.
        editor.focus();
        editor.trigger('touch-selection', 'editor.action.showContextMenu', null);
    };
    window.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
    window.addEventListener('touchcancel', onTouchEnd, { capture: true });

    // The browser's own long-press menu event starts the selection instead of opening Monaco's menu early.
    editorElement.addEventListener('contextmenu', (event) => {
        if (!press && performance.now() > ignoreMenusUntil) return;
        event.preventDefault();
        event.stopPropagation();
        if (press && !press.selecting) startSelecting();
    }, true);
    for (const type of MONACO_GESTURES) {
        editorElement.addEventListener(type, (event) => {
            if (press || performance.now() < ignoreMenusUntil) event.stopPropagation();
        }, true);
    }
}
