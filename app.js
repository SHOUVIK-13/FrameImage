/**
 * FrameImage — App Logic
 *
 * Bugs fixed in this version:
 *  1. loadImage() now revokes the temporary blob URL after the image loads
 *     (previously leaked every Object URL created during image loading).
 *  2. downloadBlob() now appends the link to the document body and removes
 *     it afterward, fixing the Firefox click() issue on detached elements.
 *  3. detectFaces() logs the caught error for observability rather than
 *     swallowing it completely.
 *  4. replaceOutput() is now used correctly inside generateAll().
 *  5. markOutputsStale() guard cleaned up.
 *  6. Drag-and-drop support added to the dropzone.
 *  7. Dialog backdrop click now closes the dialog.
 */

'use strict';

/* ── Splash Screen ──────────────────────────── */
(function initSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;

  // Start exit animation at ~1.5s, it runs for 0.55s → total ~2.05s
  const exitDelay = 1500;
  const exitDuration = 550;

  setTimeout(() => {
    splash.classList.add('splash-done');
    setTimeout(() => {
      splash.remove();
    }, exitDuration);
  }, exitDelay);
})();



/* ── State ──────────────────────────────────── */
const state = {
  frames: [],
  selectedFrame: null,
  files: [],
  outputs: [],
  quality: 0.92,
  generated: false,
  photoUrls: [],
  selectedOutputIndex: 0,
  hasPendingChanges: false,
};

/* Asset cache: path → Promise<HTMLImageElement> */
const assetCache = new Map();

/** Shorthand querySelector */
const $ = (selector) => document.querySelector(selector);

/* ── Init ───────────────────────────────────── */
async function init() {
  // Load frame definitions
  const response = await fetch('frames.json');
  if (!response.ok) throw new Error(`Failed to load frames.json (${response.status})`);
  state.frames = await response.json();
  if (!state.frames.length) throw new Error('frames.json is empty');
  state.selectedFrame = state.frames[0];

  renderFramePicker();
  renderAllFrames();
  renderActiveFrame();

  // Footer year
  $('#year').textContent = new Date().getFullYear();

  // Photos input
  $('#photos').addEventListener('change', onPhotosSelected);

  // Quality slider
  $('#quality').addEventListener('input', (event) => {
    state.quality = Number(event.target.value) / 100;
    $('#quality-value').textContent = `${event.target.value}%`;
    markOutputsStale();
  });

  // Manual-fit toggle
  $('#manual-fit').addEventListener('change', markOutputsStale);

  // Generate button
  $('#generate').addEventListener('click', generateAll);

  // Download buttons
  $('#download-one').addEventListener('click', () => {
    const output = state.outputs[state.selectedOutputIndex];
    if (output) downloadBlob(output.blob, output.name);
  });
  $('#download-zip').addEventListener('click', downloadZip);

  // Frame dialog
  $('#show-all-frames').addEventListener('click', () => $('#frame-dialog').showModal());
  $('#close-frame-dialog').addEventListener('click', () => $('#frame-dialog').close());

  // Image preview dialog
  $('#close-image-dialog').addEventListener('click', () => $('#image-dialog').close());
  $('#download-dialog-image').addEventListener('click', downloadDialogImage);

  // Close dialogs on backdrop click
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      // The dialog element itself is the backdrop area; its content is inside
      if (event.target === dialog) dialog.close();
    });
  }

  // Drag-and-drop on the dropzone
  setupDropzone();
}

/* ── Dropzone drag-and-drop ─────────────────── */
function setupDropzone() {
  const dropzone = $('#dropzone-label');
  const input = $('#photos');

  const prevent = (event) => { event.preventDefault(); event.stopPropagation(); };

  dropzone.addEventListener('dragover', (event) => {
    prevent(event);
    dropzone.classList.add('drag-over');
  });

  dropzone.addEventListener('dragleave', (event) => {
    prevent(event);
    dropzone.classList.remove('drag-over');
  });

  dropzone.addEventListener('drop', (event) => {
    prevent(event);
    dropzone.classList.remove('drag-over');
    const files = [...(event.dataTransfer?.files ?? [])].filter((f) =>
      ['image/jpeg', 'image/png', 'image/webp'].includes(f.type)
    );
    if (!files.length) return;
    // Sync dropped files into the state (can't assign to input.files directly)
    applyFiles(files);
  });
}

/* ── Photo Selection ────────────────────────── */
function onPhotosSelected(event) {
  applyFiles([...event.target.files]);
}

function applyFiles(files) {
  // Revoke previous preview URLs
  state.photoUrls.forEach((url) => URL.revokeObjectURL(url));

  state.files = files;
  state.photoUrls = files.map((file) => URL.createObjectURL(file));

  $('#file-summary').textContent = state.files.length
    ? `${state.files.length} photo${state.files.length > 1 ? 's' : ''} selected`
    : 'No photos selected yet.';

  renderSelectedPhotos();
  resetResults();

  const btn = $('#generate');
  btn.disabled = !state.files.length;
  btn.textContent = state.files.length
    ? `Generate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}`
    : 'Generate all photos';
}

/* ── Render: Selected photos strip ─────────── */
function renderSelectedPhotos() {
  const holder = $('#selected-photos');
  holder.replaceChildren();
  state.photoUrls.slice(0, 5).forEach((url, index) =>
    holder.appendChild(photoChip(url, state.files[index].name))
  );
  if (state.files.length > 5) {
    const more = document.createElement('span');
    more.className = 'count-chip';
    more.textContent = `+${state.files.length - 5}`;
    holder.appendChild(more);
  }
}

function photoChip(url, name) {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'photo-chip';
  item.innerHTML = `<img src="${url}" alt="Selected photo: ${escapeHtml(name)}" loading="lazy" />`;
  item.addEventListener('click', () => openImageDialog(url, name, null));
  return item;
}

/* ── Render: Frame pickers ──────────────────── */
function renderFramePicker() {
  // Show ALL frames in the quick picker (horizontal scroll strip)
  $('#frame-picker').replaceChildren(
    ...state.frames.map((frame) => frameButton(frame))
  );
}

function renderAllFrames() {
  $('#all-frames-grid').replaceChildren(
    ...state.frames.map((frame) => frameButton(frame, true))
  );
}

/**
 * Render the prominent "currently selected frame" card above the picker.
 * Shown every time the selection changes.
 */
function renderActiveFrame() {
  const frame = state.selectedFrame;
  if (!frame) return;
  const card = $('#active-frame-card');
  card.innerHTML = `
    <div class="active-frame-inner">
      <img
        class="active-frame-thumb"
        src="${frame.overlay}"
        alt="Selected frame: ${escapeHtml(frame.name)}"
        loading="lazy"
      />
      <div class="active-frame-info">
        <span class="active-frame-badge">&#10003; Active frame</span>
        <strong class="active-frame-name">${escapeHtml(frame.name)}</strong>
        <span class="active-frame-dims">${frame.canvas.width} &times; ${frame.canvas.height}px</span>
      </div>
    </div>
  `;
}

function frameButton(frame, large = false) {
  const button = document.createElement('button');
  const isSelected = frame.id === state.selectedFrame.id;
  button.className = `frame-choice${large ? ' large' : ''}${isSelected ? ' selected' : ''}`;
  button.type = 'button';
  button.setAttribute('aria-pressed', String(isSelected));
  button.innerHTML = `
    <img class="frame-swatch" src="${frame.overlay}" alt="" loading="lazy" />
    <span>${escapeHtml(frame.name)}</span>
    ${isSelected ? '<em>Selected</em>' : ''}
  `;
  button.addEventListener('click', () => selectFrame(frame));
  return button;
}

/* ── Frame Selection ────────────────────────── */
async function selectFrame(frame) {
  state.selectedFrame = frame;
  renderFramePicker();
  renderAllFrames();
  renderActiveFrame();
  $('#frame-dialog').close();

  if (!state.files.length || !state.generated) return;

  state.hasPendingChanges = true;
  renderResults();
  toggleBusy(
    false,
    `New frame selected — regenerate all ${state.files.length} to update every result`
  );
  $('#generate').textContent = `Regenerate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}`;
}

/* ── Mark Stale ─────────────────────────────── */
function markOutputsStale() {
  if (!state.files.length || !state.generated) return;
  state.hasPendingChanges = true;
  renderResults();
  $('#processing-status').textContent = 'Settings changed — regenerate to update results';
  $('#generate').textContent = `Regenerate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}`;
}

/* ── Generate All ───────────────────────────── */
async function generateAll() {
  if (!state.files.length) return;

  toggleBusy(true, `Preparing 1 of ${state.files.length}`);
  clearOutputUrls();
  state.outputs = new Array(state.files.length).fill(null);

  for (let index = 0; index < state.files.length; index += 1) {
    toggleBusy(true, `Processing ${index + 1} of ${state.files.length}`);
    const output = await compose(state.files[index]);
    // FIX: use replaceOutput to properly revoke old URLs on re-generation
    replaceOutput(index, output);
    renderResults();
    // Yield to browser between frames for responsiveness
    await new Promise(requestAnimationFrame);
  }

  state.generated = true;
  state.hasPendingChanges = false;
  state.selectedOutputIndex = 0;
  $('#result-actions').hidden = false;
  $('#generate').textContent = `Regenerate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}`;
  toggleBusy(false, `${state.outputs.length} image${state.outputs.length > 1 ? 's' : ''} ready`);
}

/* ── Results Lifecycle ──────────────────────── */
function resetResults() {
  clearOutputUrls();
  state.outputs = [];
  state.generated = false;
  state.hasPendingChanges = false;
  state.selectedOutputIndex = 0;
  $('#results-gallery').replaceChildren();
  $('#result-actions').hidden = true;
  $('#preview-empty').hidden = false;
  $('#processing-status').textContent = 'Ready';
}

function clearOutputUrls() {
  state.outputs.forEach((output) => {
    if (output?.url) URL.revokeObjectURL(output.url);
  });
}

/** Replace a single output entry, revoking the old URL first. */
function replaceOutput(index, output) {
  if (state.outputs[index]?.url) URL.revokeObjectURL(state.outputs[index].url);
  state.outputs[index] = output;
}

function toggleBusy(busy, message) {
  $('#generate').disabled = busy || !state.files.length;
  $('#processing-status').textContent = message;
}

/* ── Render: Results Gallery ────────────────── */
function renderResults() {
  const gallery = $('#results-gallery');
  gallery.replaceChildren();

  const validOutputs = state.outputs.filter(Boolean);
  if (!validOutputs.length) return;

  $('#preview-empty').hidden = true;

  state.outputs.forEach((output, index) => {
    if (!output) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `result-card${state.hasPendingChanges ? ' stale' : ''}`;
    button.innerHTML = `
      <img src="${output.url}" alt="Generated result ${index + 1}" loading="lazy" />
      <span>${escapeHtml(shortName(state.files[index]?.name || output.name))}</span>
      ${state.hasPendingChanges ? '<em>Previous frame</em>' : ''}
    `;
    button.addEventListener('click', () => {
      state.selectedOutputIndex = index;
      openImageDialog(output.url, output.name, output);
    });
    gallery.appendChild(button);
  });
}

/* ── Compose: Frame + Photo → Blob ──────────── */
async function compose(file) {
  const image = await loadImage(file);
  const frame = state.selectedFrame;
  const { width, height } = frame.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Background fill
  ctx.fillStyle = frame.palette.background;
  ctx.fillRect(0, 0, width, height);

  // Detect faces then smart-crop (or centered fallback)
  const faces = await detectFaces(image);
  const targetRatio = frame.slot.width / frame.slot.height;
  const crop = $('#manual-fit').checked
    ? centeredCrop(image.width, image.height, targetRatio)
    : smartCrop(image, targetRatio, faces);

  // Draw photo clipped to slot
  ctx.save();
  ctx.beginPath();
  ctx.rect(frame.slot.x, frame.slot.y, frame.slot.width, frame.slot.height);
  ctx.clip();
  ctx.drawImage(
    image,
    crop.x, crop.y, crop.width, crop.height,
    frame.slot.x, frame.slot.y, frame.slot.width, frame.slot.height
  );
  ctx.restore();

  // Draw frame overlay on top
  const overlay = await loadAsset(frame.overlay);
  ctx.drawImage(overlay, 0, 0, width, height);

  // Export to blob
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', state.quality)
  );

  const name = `${file.name.replace(/\.[^.]+$/, '')}-${frame.id}.jpg`;
  return { blob, url: URL.createObjectURL(blob), name };
}

/* ── Cropping Helpers ───────────────────────── */
function centeredCrop(imageWidth, imageHeight, targetRatio) {
  let cropWidth = imageWidth;
  let cropHeight = cropWidth / targetRatio;
  if (cropHeight > imageHeight) {
    cropHeight = imageHeight;
    cropWidth = cropHeight * targetRatio;
  }
  return {
    width: cropWidth,
    height: cropHeight,
    x: (imageWidth - cropWidth) / 2,
    y: (imageHeight - cropHeight) / 2,
  };
}

/**
 * Detect faces using the browser's experimental FaceDetector API.
 * Returns an array of DOMRect-like bounding boxes, or [] if unavailable.
 */
async function detectFaces(image) {
  if (!('FaceDetector' in window)) return [];
  try {
    const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 20 });
    const detected = await detector.detect(image);
    return detected.map(({ boundingBox }) => boundingBox);
  } catch (error) {
    // FaceDetector may throw on some platforms/configurations
    console.warn('FaceDetector failed:', error);
    return [];
  }
}

/**
 * Smart crop: sample image at low resolution for edge/contrast scoring,
 * combine with face-visibility bonus, then pick the best crop candidate.
 */
function smartCrop(image, targetRatio, faces = []) {
  const base = centeredCrop(image.width, image.height, targetRatio);

  // Downsample for cheap analysis
  const sample = document.createElement('canvas');
  sample.width = Math.min(160, image.width);
  sample.height = Math.max(1, Math.round(image.height * (sample.width / image.width)));
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  sampleCtx.drawImage(image, 0, 0, sample.width, sample.height);
  const pixels = sampleCtx.getImageData(0, 0, sample.width, sample.height).data;

  /** Edge/contrast score for a region in sample-space coordinates */
  const interest = (sx, sy, sw, sh) => {
    let score = 0;
    let count = 0;
    for (let y = Math.max(1, sy); y < Math.min(sample.height - 1, sy + sh); y += 3) {
      for (let x = Math.max(1, sx); x < Math.min(sample.width - 1, sx + sw); x += 3) {
        const i     = (y * sample.width + x) * 4;
        const right = (y * sample.width + x + 1) * 4;
        const down  = ((y + 1) * sample.width + x) * 4;
        const lum      = pixels[i]     * 0.2126 + pixels[i + 1]     * 0.7152 + pixels[i + 2]     * 0.0722;
        const lumRight = pixels[right] * 0.2126 + pixels[right + 1] * 0.7152 + pixels[right + 2] * 0.0722;
        const lumDown  = pixels[down]  * 0.2126 + pixels[down + 1]  * 0.7152 + pixels[down + 2]  * 0.0722;
        score += Math.abs(lum - lumRight) + Math.abs(lum - lumDown);
        count += 1;
      }
    }
    return score / Math.max(1, count);
  };

  const scaleX = sample.width / image.width;
  const scaleY = sample.height / image.height;
  let best = base;
  let bestScore = -Infinity;

  // Evaluate a 5×5 grid of candidate crop origins
  for (const px of [0, 0.25, 0.5, 0.75, 1]) {
    for (const py of [0, 0.25, 0.5, 0.75, 1]) {
      const candidate = {
        ...base,
        x: (image.width  - base.width)  * px,
        y: (image.height - base.height) * py,
      };

      // Face coverage bonus
      const faceCoverage = faces.reduce((total, face) => {
        const left   = Math.max(candidate.x, face.x);
        const top    = Math.max(candidate.y, face.y);
        const right  = Math.min(candidate.x + candidate.width,  face.x + face.width);
        const bottom = Math.min(candidate.y + candidate.height, face.y + face.height);
        const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
        return total + overlap / Math.max(1, face.width * face.height);
      }, 0);

      const score =
        interest(
          candidate.x * scaleX,
          candidate.y * scaleY,
          candidate.width  * scaleX,
          candidate.height * scaleY
        ) +
        faceCoverage * 1000 -
        (Math.abs(px - 0.5) + Math.abs(py - 0.5)) * 3;

      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
  }

  return best;
}

/* ── Asset & Image Loading ──────────────────── */
/**
 * Load a File as an HTMLImageElement.
 * FIX: revokes the temporary object URL after load/error to prevent leaks.
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url); // FIX: revoke immediately after load
      resolve(image);
    };
    image.onerror = (event) => {
      URL.revokeObjectURL(url); // FIX: revoke on error too
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    image.src = url;
  });
}

/** Cache-backed loader for static frame overlay assets. */
function loadAsset(path) {
  if (!assetCache.has(path)) {
    assetCache.set(
      path,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load asset: ${path}`));
        image.src = path;
      })
    );
  }
  return assetCache.get(path);
}

/* ── Utilities ──────────────────────────────── */
function shortName(name) {
  return name.length > 18 ? `${name.slice(0, 15)}\u2026` : name;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value;
  return div.innerHTML;
}

/**
 * Trigger a file download from a Blob.
 * FIX: appends the anchor to the document body before clicking (required in
 * Firefox) and removes it immediately after, then revokes the URL after a
 * short delay to allow the download to start.
 */
function downloadBlob(blob, name) {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ── Image Preview Dialog ───────────────────── */
function openImageDialog(url, name, output) {
  $('#image-dialog-title').textContent = name;
  const preview = $('#image-dialog-preview');
  preview.src = url;
  preview.alt = name;

  const actions = $('#image-dialog-actions');
  actions.hidden = !output;
  if (output) {
    $('#download-dialog-image').dataset.outputIndex = String(state.outputs.indexOf(output));
  }

  $('#image-dialog').showModal();
}

function downloadDialogImage() {
  const index = Number($('#download-dialog-image').dataset.outputIndex);
  const output = state.outputs[index];
  if (output) downloadBlob(output.blob, output.name);
}

/* ── ZIP Download ───────────────────────────── */
async function downloadZip() {
  const validOutputs = state.outputs.filter(Boolean);
  if (!validOutputs.length) return;

  if (!window.JSZip) {
    alert('ZIP support is still loading. Please wait a moment and try again.');
    return;
  }

  toggleBusy(true, 'Packaging ZIP\u2026');
  const zip = new window.JSZip();
  validOutputs.forEach(({ blob, name }) => zip.file(name, blob));

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(zipBlob, `frameimage-${state.selectedFrame.id}.zip`);
  toggleBusy(false, 'ZIP downloaded');
}

/* ── Bootstrap ──────────────────────────────── */
init().catch((error) => {
  console.error('FrameImage init failed:', error);
  const status = $('#processing-status');
  if (status) status.textContent = 'Could not load frame designs — please refresh.';
});
