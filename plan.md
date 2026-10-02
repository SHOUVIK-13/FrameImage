# FrameImage — Product & Technical Plan

## 1. Product goal

FrameImage lets a user select a pre-built frame, upload one or many photos, automatically place each photo well inside the frame, preview the result, and download the finished image(s).

The Phase 1 goal is to prove this core workflow reliably:

```text
Choose frame → upload photo(s) → automatic framing → preview → download / ZIP
```

## 2. Phase 1: frontend-only, free-first MVP

Phase 1 will run on the existing WordPress hosting as static site files. It must not require a separate backend, API, database, object storage, paid service, user account, or server-side image processing.

### Included

- Plain HTML, CSS, and modern vanilla JavaScript
- Clean, responsive, mobile-friendly interface
- 5–10 pre-built frame templates and frame/category pages
- Single-image upload, automatic framing, preview, and JPG/PNG download
- Bulk processing with progress feedback and ZIP download
- Frame definitions stored as versioned JSON files; frame artwork stored as static PNG/WebP assets
- Browser-side image rendering with Canvas / OffscreenCanvas where available
- Web Workers and small processing batches to keep the page responsive and release memory between batches
- JSZip for bulk-output packaging

### Explicitly excluded

- Backend services (Node, Python, FastAPI, etc.)
- Database, S3/object storage, cloud image processing, and external image APIs
- Paid API or AI API
- Login, payment, public user accounts, admin panel, or user-created frames
- Server upload or storage of users’ photos

All uploaded photos remain on the user’s device and are processed in their browser.

## 3. Phase 1 framing engine: AI-free, subject-aware

The engine will be deterministic and browser-only. It will provide a practical smart-cropping approximation, not semantic AI vision.

### Analysis pipeline

```text
Photo → orientation / aspect ratio → face detection → visual-interest analysis
      → candidate crops → crop scoring → frame-slot placement → output
```

### Behaviour

- Detect portrait, landscape, square, and source aspect ratio.
- Detect faces with a browser-compatible local library; no image data is sent to a service.
- For multiple faces, create a combined protected region so group photos are not cropped through faces.
- When faces are absent, estimate visual interest using lightweight heuristics such as edge density, contrast, saliency, brightness distribution, connected regions, and center-of-interest.
- Generate several valid crop candidates and select the best one using a transparent scoring model:
  - face/group visibility and safe margin
  - likely-subject / saliency coverage
  - composition and centering
  - preservation of important edges
  - efficient use of the destination slot
- Use frame-specific rules for portrait, landscape, square, and group-photo cases.
- Let each slot declare constraints such as `fit: smart-cover`, protected faces/subject, minimum face size, and safe margin.
- Provide a manual reposition/fit fallback if automatic framing is not satisfactory.

### Limitation to state clearly

Without AI vision, the system can protect faces and make strong visual-composition estimates, but cannot always understand which non-face object is the intended primary subject. Phase 1 therefore targets dependable face/group protection and good rule-based cropping—not perfect semantic understanding.

## 4. Frame configuration model

Each frame should have a static asset plus a JSON configuration, for example:

```json
{
  "id": "sample-frame",
  "canvas": { "width": 1080, "height": 1350 },
  "slots": [
    {
      "id": "main-photo",
      "x": 100,
      "y": 200,
      "width": 880,
      "height": 950,
      "fit": "smart-cover",
      "protectFaces": true,
      "protectSubject": true,
      "safeMargin": 0.08
    }
  ],
  "layers": ["photo", "frame-overlay"]
}
```

This keeps frames predictable, reusable, and ready for later AI-assisted changes.

## 5. Performance targets

Processing speed depends on device and photo resolution. Initial engineering targets for ordinary 5–10 MB / 12–24 MP images are:

| Batch | Target estimate |
|---|---:|
| 1 image | under 0.1–0.5 sec |
| 10 images | 1–3 sec |
| 50 images | 5–15 sec |
| 100 images | 10–30 sec |
| 500 images | 1–3 min |

These are targets to benchmark on real desktop and mobile devices, not guarantees. The implementation should process in configurable batches (for example 5–10 files), use workers for heavy work, cap decoded working dimensions where quality permits, and release image/canvas memory after each result.

## 6. Phase 1 SEO compatibility

The public landing page and frame/category pages must remain crawlable even though the image processor is browser-side.

- Semantic HTML; logical H1/H2/H3 hierarchy
- Unique `<title>` and meta description per public page
- Descriptive, stable page URLs and descriptive frame/category copy
- Image `alt` text; Open Graph/social metadata
- Mobile-friendly layout and fast static assets
- `robots.txt` and `sitemap.xml`
- Relevant structured data where appropriate
- No unnecessary JavaScript dependency for important public SEO content

Static HTML is sufficient for Phase 1 SEO; Next.js or a backend is not required.

## 7. Development roadmap

1. **Foundation:** static project structure, design system, responsive landing page, and first frame assets.
2. **Frame engine proof:** one frame + one image; perfect crop, placement, overlay, preview, and export.
3. **Configuration layer:** validate the JSON schema and support portrait/landscape/group-specific rules.
4. **Smart crop:** add face detection, group bounding boxes, visual-interest heuristics, candidate scoring, and manual fallback.
5. **Single-image experience:** frame selection, upload, preview, adjustment, and download.
6. **Bulk engine:** queue, progress, batch processing in workers, memory handling, ZIP generation, and real-device benchmarks.
7. **SEO and launch readiness:** public frame/category pages, metadata, sitemap/robots, accessibility checks, and performance optimization.
8. **Expand frame library:** add tested templates after the core engine is stable.

## 8. Phase 2: AI and backend expansion

Only after Phase 1 is stable, add backend infrastructure where it provides real value.

### Likely Phase 2 stack

- Python + FastAPI for AI-facing APIs and validation
- PostgreSQL for frame/project metadata
- Object storage for managed frame assets and optional user projects
- Authentication and an admin frame-management workflow as needed
- AI-assisted frame modification and stronger subject/composition understanding

### AI design principle

AI should not directly make arbitrary edits. It should return constrained, schema-validated frame operations such as `MOVE`, `RESIZE`, `ROTATE`, `CHANGE_FIT`, `ADD_SLOT`, `REMOVE_SLOT`, and `REORDER_LAYER`. The backend validates them before the frontend renders a preview.

Example future flow:

```text
User instruction → AI → validated frame JSON patch → preview → user confirmation
```

This retains predictable rendering while enabling instructions such as “make the photo area wider and move it slightly up.”

## 9. Success criteria

Phase 1 is successful when a visitor can use the WordPress-hosted static site to apply a frame to one or many local photos, receive good automatic face/group-safe framing, stay responsive during bulk work, and download individual images or a ZIP—without any backend, paid service, or photo upload to a server.
