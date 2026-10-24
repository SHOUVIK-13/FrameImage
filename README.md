# FrameImage 🖼️

**FrameImage** is a 100% browser-based, privacy-first photo framing web application. Users can pick pre-built frame designs, upload one or many photos, get smart auto-cropped & framed results, and download them individually or as a ZIP archive.

No server uploads, no backend, no account required — all image composition runs locally in the user's browser using the HTML5 Canvas API.

---

## ✨ Features

- 🎨 **Dynamic Frame Studio (v2.0)**: Authenticated admin upload engine with brute-force rate limiting, HMAC-SHA256 hashing, PNG magic-bytes validation, and automatic low-RAM WebP thumbnail synthesis.
- ⚡ **Low-Loading Two-Tier Pipeline**: 150px lightweight thumbnails loaded initially (<85KB total), with full 4K/HD overlays loaded strictly on-demand, preventing browser memory bloat.
- 🔒 **100% Private & Client-Side Photo Processing**: All photo framing runs locally on device via HTML5 Canvas. Photos are never sent to any server.
- 📐 **Smart & Centered Auto-Cropping**: Automatically detects faces (using the native `FaceDetector` API when available) or applies intelligent contrast/edge-scoring crops to ensure subjects are framed properly.
- 📁 **Batch Processing & ZIP Export**: Upload multiple photos at once, preview generated results, and download all framed images in a single ZIP file (powered by JSZip).
- 🎛️ **Output Customization**: Configurable JPEG quality compression slider, inline crop/pan editor, and text overlays with draggable borders.
- 🚀 **Dual-Runtime Backend**: Universal PHP backend (`api/`) for cPanel / Apache / Nginx hosting, plus a zero-dependency standalone Node.js server (`server.js`).

---

## 🛠️ Tech Stack

- **Markup & Structure**: Semantic HTML5 (ARIA roles, accessible dialogs, JSON-LD Schema)
- **Styling**: Vanilla CSS3 (Custom design system tokens, responsive layout, glassmorphic header, pop-based loading animation)
- **Scripting**: Modern Vanilla JavaScript (ES6+, `'use strict'`, Object URL lifecycle management)
- **Image Processing**: HTML5 Canvas 2D Context API + FaceDetector API
- **Archive Generation**: [JSZip](https://stuk.github.io/jszip/)
- **Backend / API**: PHP 8+ (or standalone Node.js HTTP server)

---

## 📁 Project Structure

```
FrameImage/
├── index.html          # Main HTML entrypoint (SEO, Open Graph, accessibility)
├── styles.css          # Core design system and component styles
├── app.js              # Application logic (cropping, composition, Admin Studio)
├── server.js           # Production standalone Node.js server (zero dependencies)
├── package.json        # NPM run scripts (npm start, npm run dev)
├── frames.json         # Frame definitions (id, canvas dimensions, slots, palette, thumbnails)
├── api/                # Production PHP API
│   ├── config.php      # Security credentials, salts, and rate limiting limits
│   ├── auth.php        # Authentication, rate limiting, and session verification
│   ├── upload.php      # Strict PNG verification, thumbnail generation, atomic frames.json locking
│   ├── delete.php      # Authenticated frame removal
│   └── .htaccess       # Direct access prevention for internal storage
├── assets/
│   └── frames/         # Frame overlays (*-overlay.png) & WebP thumbnails (*-thumb.webp)
├── robots.txt          # Web crawler rules (with API route exclusion)
├── sitemap.xml         # XML sitemap
└── AGENTS.md           # Project architecture & development documentation
```

---

## 🚀 Running the Project

### Option 1: Standalone Node.js Server (Recommended for local dev or Node VPS)
```bash
npm start
# or: node server.js
```
Then open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 2: Apache / cPanel / PHP Server
Upload the repository files to your web root (`public_html` or domain folder). The PHP endpoints in `api/` will handle authentication and uploads automatically.

### Option 3: Python (Static preview only)
```bash
python3 -m http.server 8080
```

---

## 📄 License

MIT License. Free to use and customize!
