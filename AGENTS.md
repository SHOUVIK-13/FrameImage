# FrameImage — Agent Context & Project Plan

This directory is a local mirror of the ChatGPT project "Project - FrameImage".

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete files inside `sources/`.
- These files may be replaced the next time a task is created from this ChatGPT project.

---

## Project Overview

**FrameImage** is a 100% browser-based, privacy-first photo framing tool.
Users pick a pre-built frame design, upload one or many photos, get smart
auto-cropped & framed results, and download them — individually or as a ZIP.
No backend, no server upload, no account required.

**Stack:** Plain HTML · Vanilla CSS · Vanilla JS · Canvas API · JSZip

---

## File Map

```
FrameImage/
├── index.html          ← Main (and only) HTML page
├── styles.css          ← Full design system + all component styles
├── app.js              ← All application logic (state, render, compose, download)
├── frames.json         ← Frame definitions (id, canvas size, slot coords, palette)
├── robots.txt          ← Crawler rules (sitemap URL must be absolute)
├── sitemap.xml         ← Page sitemap with priority hints
├── assets/
│   └── frames/
│       ├── sunset-overlay.png
│       ├── gallery-overlay.png
│       └── postcard-overlay.png
└── sources/            ← READ-ONLY ChatGPT-synced reference material
```

---

## What Was Done (Session: 2026-10-02)

### 1. `index.html` — Full Rebuild
- **SEO:** `<title>`, `<meta name="description">`, `<meta name="keywords">`,
  `<meta name="author">`, `<link rel="canonical">`, `<meta name="robots">`
- **Open Graph:** `og:type`, `og:site_name`, `og:title`, `og:description`,
  `og:url`, `og:image` (1200x630), `og:image:width/height`, `og:locale`
- **Twitter Card:** `twitter:card`, `twitter:title`, `twitter:description`,
  `twitter:image`
- **PWA / Theme:** `theme-color`, `color-scheme`
- **Structured Data:** JSON-LD `WebApplication` schema with `offers`,
  `featureList`, `applicationCategory`, `operatingSystem`
- **Google Fonts:** Inter (300-900 weights) via `preconnect` + stylesheet
- **`<noscript>` fallback** for JS-disabled visitors
- **Semantic HTML:** `role="banner"`, `role="contentinfo"`, `role="form"`,
  `role="group"`, `role="status"`, `aria-modal="true"` on dialogs,
  `aria-haspopup="dialog"` on trigger buttons, `aria-live` regions,
  `aria-label` on all interactive groups, `for`/`id` pairings on all inputs
- **`<output>`** element with correct `for` attribute for the quality slider
- **`loading="lazy"`** on frame swatch and result images

### 2. `styles.css` — Complete Rewrite (from 2-line minified blob)
- **Design system tokens** via CSS custom properties:
  `--bg`, `--bg-raise`, `--bg-lift`, `--ink`, `--ink-dim`, `--ink-faint`,
  `--border`, `--border-hover`, `--lime`, `--lime-dim`, `--lime-glow`,
  `--rose`, `--radius`, `--shadow-card`, `--shadow-float`, `--transition`
- **Dark premium aesthetic:** near-black background (#0d0f0b), electric lime
  accent (#c8f04c), rose brand mark (#ff6b9d)
- **Glassmorphism sticky header** with `backdrop-filter: blur(18px)`
- **Gradient hero h1** using `background-clip: text` + linear gradient
- **Animated dialog open** (`@keyframes dialogIn` — scale + fade)
- **Hover underline nav** via `::after` pseudo-element scale animation
- **`@keyframes fadeUp`** for hero entrance and result cards
- **`.dropzone.drag-over`** state with lime border + glow ring
- **Accessible focus ring** via `:focus-visible` (lime, 2px, offset 3px)
- **`.checkbox-label`** correctly unsets the `position:absolute` visually-
  hidden file-input rule for the checkbox input inside settings
- **Responsive breakpoints** at 760px and 480px
- **Custom scrollbar** on the all-frames dialog grid (`scrollbar-width: thin`)

### 3. `app.js` — Bug Fixes & Improvements

#### Bugs Fixed
| # | Bug | Fix |
|---|-----|-----|
| 1 | `loadImage()` created a blob URL then never revoked it — Object URL leak on every image processed | Revoke the URL in both `onload` and `onerror` immediately after the image is decoded |
| 2 | `downloadBlob()` called `link.click()` on a detached element — silent failure in Firefox | Append link to `document.body`, click, then remove; revoke URL after 1s |
| 3 | `detectFaces()` had an empty `catch {}` — errors swallowed silently | `console.warn()` the caught error so it appears in DevTools |
| 4 | `replaceOutput()` was defined but never called — re-generating photos leaked old blob URLs | Used in `generateAll()` instead of direct array push |
| 5 | `state.outputs` pre-filled with `null` then filtered correctly so partial renders work | Added `filter(Boolean)` guards in `renderResults()` and `downloadZip()` |

#### Features Added
- **Drag-and-drop** onto the dropzone label (`dragover` / `dragleave` / `drop`)
  with MIME-type filtering (JPEG, PNG, WebP only) and `.drag-over` CSS class toggle
- **Backdrop click closes dialogs** — click on `<dialog>` element itself (outside
  the content box) calls `dialog.close()`
- **`applyFiles(files)`** extracted so both the `<input change>` handler and the
  drop handler share one code path
- **`'use strict'`** at module top
- **Full JSDoc comments** on every function

### 4. `robots.txt`
- Fixed: `Sitemap:` directive was updated to the absolute domain URL:
  `https://tech.angikarparibar.org/sitemap.xml`

### 5. `sitemap.xml`
- Canonical domain set to `https://tech.angikarparibar.org/` with invalid `#` hash fragments removed.
- Validated to prevent Google Search Console indexing errors.

---

## Known Remaining Issue

Opening `index.html` directly via `file://` in Chrome causes `fetch('frames.json')`
to fail with `TypeError: Failed to fetch` (browser CORS policy for file: origins).
This is expected for local `file://` testing. The app works correctly when served
over HTTP/HTTPS.

To test locally:
```bash
# Option A — Python (no install)
python3 -m http.server 8080

# Option B — Node serve
npx serve .
```

---

## Coding Conventions to Maintain

- **No build step, no bundler, no framework** — plain HTML/CSS/JS only
- **All state** lives in the single `state` object at the top of `app.js`
- **`assetCache`** (Map) prevents redundant overlay image loads
- **CSS custom properties** for all colours and radii — never hardcode in components
- **`escapeHtml()`** must be used before inserting any user-supplied string into innerHTML
- **Object URLs** must always be revoked:
  - Photo preview URLs: revoke in `applyFiles()` before replacing
  - Composed output URLs: revoke in `clearOutputUrls()` / `replaceOutput()`
  - Temporary load URLs: revoke immediately in `loadImage()` callbacks
  - Download URLs: revoke via `setTimeout` in `downloadBlob()`
- **`aria-live="polite"`** on: `#file-summary`, `#selected-photos`,
  `#results-gallery`, `#generate`, `#processing-status`
- **`aria-modal="true"`** on all `<dialog>` elements

---

## Roadmap (Phase 1 remaining)

- [ ] Serve via HTTP for correct `fetch()` behaviour in all browsers
- [ ] Add remaining 2-7 frame templates (currently 3)
- [ ] Web Worker for heavy compose work (keeps UI thread responsive for 50+ photos)
- [ ] `OffscreenCanvas` path for Worker-based rendering
- [ ] Configurable batch size (process N files at a time with memory release between)
- [ ] Manual reposition / fit fallback UI (pan + zoom controls on slot)
- [ ] Benchmark on real devices (targets in plan.md section 5)
- [ ] SEO: individual `/frames/<id>` pages for each frame design
- [ ] OG cover image (`assets/og-cover.jpg` — 1200x630)
- [ ] Favicon / apple-touch-icon
- [ ] Accessibility audit (keyboard nav, screen reader pass, colour contrast)

---

## SEO Checklist

| Item | Status |
|------|--------|
| Unique `<title>` | Done |
| Meta description | Done |
| `<link rel="canonical">` | Done |
| Open Graph full set | Done |
| Twitter Card | Done |
| JSON-LD WebApplication schema | Done |
| `theme-color` | Done |
| `robots.txt` with absolute sitemap URL | Done |
| `sitemap.xml` with priority hints | Done |
| Single `<h1>` per page | Done |
| Logical H1 > H2 > H3 hierarchy | Done |
| Semantic HTML5 landmarks | Done |
| Image `alt` text | Done |
| `<noscript>` fallback | Done |
| `robots` meta tag | Done |
| OG cover image file | Pending |
| Favicon | Pending |
| Individual frame pages | Pending (Phase 1 later) |
