# Markdown Live Preview

[Open Markdown Live Preview](https://theogibbons.github.io/markdown-live-preview/)

A fork of [Markdown Live Preview](https://github.com/tanabe/markdown-live-preview), with local autosaves and installable offline support.

## Autosaves

Markdown rendering and diagram generation happen in your browser. There is no analytics or draft upload, and all application scripts, fonts, styles, and images are served locally.

The current draft is restored when you reopen the editor. Every 10 seconds, changed content also creates a separate snapshot in browser local storage, named like `Autosave (2026-10-13 3:50:44 PM)` using your local time. Open **Autosaves** in the top menu to select a snapshot. Hover over an entry, or focus it with the keyboard, to preview its text before loading it. Unchanged content does not create extra snapshots.

Autosaves stay in this browser until its site data is cleared. If browser storage is full or unavailable, the menu reports an error and preserves the existing history.

URLs you enter in Markdown can still make network requests: for example, an image URL loads when it is previewed. Hover previews of autosaves show plain source text without loading images.

## Offline use and installation

Open the site once while connected and wait for **Ready offline** in the footer. The editor, local images, both themes, all diagram types, autosaves, file opening, copying, and PDF export then work without internet access. Images hosted at URLs you enter require their own network connection.

Use **Install** when the browser offers it, or the browser's install/add-to-home-screen menu. Available updates show an **Update** button in the footer; the app waits for you to choose when to reload.

## Setup

```
npm ci
```

## Build

```
npm run build
npm run preview
```

## Local Development

```
npm run dev
```

## GitHub Pages

In the repository's [Pages settings](https://github.com/TheoGibbons/markdown-live-preview/settings/pages), select **GitHub Actions** as the build source. Push to `main` or run the **Deploy to GitHub Pages** workflow manually. It tests the app, builds with the correct Pages path, and deploys `dist`. Pull requests run the tests without deploying.

To build for this repository's Pages URL locally:

```
npm run build:pages
npm run preview:pages
```

## Browser tests

Use Node.js 24. Install Chromium once, then run the privacy, offline, installation, and autosave tests:

```
npx playwright install chromium
npm test
```

## License
See [LICENSE](LICENSE).
