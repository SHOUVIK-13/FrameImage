# FrameImage 🖼️

**FrameImage** is a 100% browser-based, privacy-first photo framing web application. Users can pick pre-built frame designs, upload one or many photos, get smart auto-cropped & framed results, and download them individually or as a ZIP archive.

No server uploads, no backend, no account required — all image composition runs locally in the user's browser using the HTML5 Canvas API.

---

## ✨ Features

- 🔒 **100% Private & Client-Side**: All image processing happens locally in your browser. No photos are ever uploaded to a server.
- 🎨 **Pre-built Frames**: Includes a variety of frame overlays (Sunset, Gallery, Postcard, Environment Day, Sharodiyar Angikar 26, etc.).
- 📐 **Smart & Centered Auto-Cropping**: Automatically detects faces (using the native `FaceDetector` API when available) or applies intelligent contrast/edge-scoring crops to ensure subjects are framed properly.
- 📁 **Batch Processing & ZIP Export**: Upload multiple photos at once, preview generated results, and download all framed images in a single ZIP file (powered by JSZip).
- 🎛️ **Output Customization**: Configurable JPEG quality compression slider and manual centered-fit fallback toggle.
- ⚡ **Zero Dependencies / Framework-Free**: Built with vanilla HTML5, modern CSS3 (custom properties, glassmorphism, responsive design), and plain JavaScript.

---

## 🛠️ Tech Stack

- **Markup & Structure**: Semantic HTML5 (ARIA roles, accessible dialogs, JSON-LD Schema)
- **Styling**: Vanilla CSS3 (Custom design system tokens, responsive layout, glassmorphic header, dark theme)
- **Scripting**: Modern Vanilla JavaScript (ES6+, `'use strict'`, Object URL lifecycle management)
- **Image Processing**: HTML5 Canvas 2D Context API + FaceDetector API
- **Archive Generation**: [JSZip](https://stuk.github.io/jszip/)

---

## 📁 Project Structure

```
FrameImage/
├── index.html          # Main HTML entrypoint (SEO, Open Graph, accessibility)
├── styles.css          # Core design system and component styles
├── app.js              # Application logic (state, cropping, canvas composition, download)
├── frames.json         # Frame definitions (id, canvas dimensions, slot coords, palette)
├── assets/
│   └── frames/         # PNG transparent frame overlays
├── robots.txt          # Web crawler configuration
├── sitemap.xml         # XML sitemap
└── AGENTS.md           # Project architecture & development documentation
```

---

## 🚀 Getting Started

Since FrameImage fetches `frames.json` dynamically via the `fetch()` API, it should be served via a local web server (to avoid browser CORS restrictions on `file://` origins).

### Option 1: Python (Built-in)
```bash
python3 -m http.server 8080
```
Then open [http://localhost:8080](http://localhost:8080) in your browser.

### Option 2: Node.js (`serve` or `http-server`)
```bash
npx serve .
```

---

## 📄 License

MIT License. Free to use and customize!
