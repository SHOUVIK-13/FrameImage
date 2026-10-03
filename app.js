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
  // Collage editor state
  collage: {
    activeSlotIndex: 0,
    // Per-slot: { fileIndex, image, offsetX, offsetY, zoom }
    slots: [],
    text: {
      content: '',
      xPercent: 0.5,
      yPercent: 0.88,
      fontSize: 46,
      fontFamily: "'Outfit', sans-serif",
      fontEffect: 'none',
      color: '#ffffff',
      bold: true,
      shadow: true,
      boxMode: 'border', // 'border' | 'fill' | 'none'
      borderColor: '#c8f04c',
      borderWidth: 4,
      borderStyle: 'curved', // 'sharp' | 'curved' | 'wavy' | 'neon-animated'
      fillColor: '#111111',
      paddingX: 20,
      paddingY: 10,
    },
  },
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
  updateGenerateButtonText();

  // Frame type tabs
  $('#tab-single')?.addEventListener('click', () => {
    switchFrameTab('single');
    if (state.selectedFrame?.collage) {
      const firstSingle = state.frames.find((f) => !f.collage);
      if (firstSingle) selectFrame(firstSingle);
    }
  });

  $('#tab-collage')?.addEventListener('click', () => {
    switchFrameTab('collage');
    if (!state.selectedFrame?.collage) {
      const firstCollage = state.frames.find((f) => f.collage);
      if (firstCollage) selectFrame(firstCollage);
    }
  });

  // Footer year
  if ($('#year')) $('#year').textContent = new Date().getFullYear();

  // Photos input
  $('#photos')?.addEventListener('change', onPhotosSelected);

  // Quality slider
  $('#quality')?.addEventListener('input', (event) => {
    state.quality = Number(event.target.value) / 100;
    if ($('#quality-value')) $('#quality-value').textContent = `${event.target.value}%`;
    markOutputsStale();
  });

  // Manual-fit toggle
  $('#manual-fit')?.addEventListener('change', markOutputsStale);

  // Generate button
  $('#generate')?.addEventListener('click', generateAll);

  // Download buttons
  $('#download-one')?.addEventListener('click', () => {
    const validOutputs = state.outputs.filter(Boolean);
    const output = validOutputs[state.selectedOutputIndex];
    if (output) downloadBlob(output.blob, output.name);
  });
  $('#download-zip')?.addEventListener('click', downloadZip);

  // Featured image click to zoom preview
  $('#featured-image')?.addEventListener('click', () => {
    const validOutputs = state.outputs.filter(Boolean);
    const output = validOutputs[state.selectedOutputIndex];
    if (output) openImageDialog(output.url, output.name, output);
  });

  // Frame dialog
  $('#show-all-frames')?.addEventListener('click', () => $('#frame-dialog')?.showModal());
  $('#close-frame-dialog')?.addEventListener('click', () => $('#frame-dialog')?.close());

  // Photos queue dialog
  $('#close-photos-dialog')?.addEventListener('click', () => $('#photos-dialog')?.close());
  $('#save-photos-dialog')?.addEventListener('click', () => $('#photos-dialog')?.close());

  // Collage editor dialog
  $('#close-collage-editor')?.addEventListener('click', () => {
    $('#collage-editor')?.close();
    drawLivePreview();
  });
  $('#collage-editor')?.addEventListener('close', () => {
    drawLivePreview();
  });
  $('#collage-generate')?.addEventListener('click', generateCollage);

  // Single Frame Custom Text trigger button
  $('#single-custom-text-btn')?.addEventListener('click', () => {
    if (!state.files.length) {
      const summary = $('#file-summary');
      if (summary) {
        summary.textContent = 'Please choose or drag photos first!';
        summary.style.color = 'var(--rose)';
        setTimeout(() => {
          summary.style.color = '';
          updateFileSummary();
        }, 3000);
      }
      $('#photos')?.click();
      return;
    }
    openCollageEditor('text');
  });

  // Image preview dialog
  $('#close-image-dialog')?.addEventListener('click', () => $('#image-dialog')?.close());
  $('#download-dialog-image')?.addEventListener('click', downloadDialogImage);

  // Collage text controls
  setupCollageTextControls();

  // Close dialogs on backdrop click
  for (const dialog of document.querySelectorAll('dialog')) {
    dialog.addEventListener('click', (event) => {
      // The dialog element itself is the backdrop area; its content is inside
      if (event.target === dialog) dialog.close();
    });
  }

  // Drag-and-drop on the dropzone
  setupDropzone();

  // Enforce single frame tab initially
  switchFrameTab('single');
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
  // Reset so the same file can be picked again later
  event.target.value = '';
}

/**
 * Merges `newFiles` into the accumulated queue instead of replacing it.
 * Duplicate detection is done by name + size + lastModified.
 * @param {File[]} newFiles
 */
function applyFiles(newFiles) {
  // Filter out exact duplicates already in the queue
  const existing = new Set(
    state.files.map((f) => `${f.name}|${f.size}|${f.lastModified}`)
  );
  const unique = newFiles.filter(
    (f) => !existing.has(`${f.name}|${f.size}|${f.lastModified}`)
  );

  // Create preview URLs only for newly added files
  const newUrls = unique.map((f) => URL.createObjectURL(f));

  state.files = [...state.files, ...unique];
  state.photoUrls = [...state.photoUrls, ...newUrls];

  updatePhotosUI();
}

/**
 * Removes the file at `index` from the queue and revokes its Object URL.
 * @param {number} index
 */
function removeFileAtIndex(index) {
  URL.revokeObjectURL(state.photoUrls[index]);
  state.files = state.files.filter((_, i) => i !== index);
  state.photoUrls = state.photoUrls.filter((_, i) => i !== index);
  updatePhotosUI();
  markOutputsStale();
}

/** Sync UI elements that depend on the current photo queue. */
function updatePhotosUI() {
  $('#file-summary').textContent = state.files.length
    ? `${state.files.length} photo${state.files.length > 1 ? 's' : ''} selected`
    : 'No photos selected yet.';

  renderSelectedPhotos();
  resetResults();
  updateGenerateButtonText();
  renderLivePreview();
}

/* ── Render: Selected photos strip ─────────── */
const STRIP_LIMIT = 5;

/** Renders up to STRIP_LIMIT thumbnails + a "+N more" chip if needed. */
function renderSelectedPhotos() {
  const holder = $('#selected-photos');
  holder.replaceChildren();

  const visible = state.photoUrls.slice(0, STRIP_LIMIT);
  visible.forEach((url, index) =>
    holder.appendChild(photoChip(url, state.files[index].name, index))
  );

  const overflow = state.files.length - STRIP_LIMIT;
  if (overflow > 0) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'count-chip';
    more.setAttribute('aria-label', `Show all ${state.files.length} selected photos`);
    more.textContent = `+${overflow}`;
    more.addEventListener('click', openPhotosDialog);
    holder.appendChild(more);
  }
}

/**
 * Builds a thumbnail chip with a remove (×) button.
 * @param {string} url   - Object URL for the preview image
 * @param {string} name  - Original filename
 * @param {number} index - Position in state.files
 * @param {string} [chipClass='photo-chip-wrap'] - Wrapper class
 */
function photoChip(url, name, index, chipClass = 'photo-chip-wrap') {
  const wrap = document.createElement('div');
  wrap.className = chipClass;
  wrap.setAttribute('title', escapeHtml(name));

  // Thumbnail — click to preview
  const img = document.createElement('button');
  img.type = 'button';
  img.className = 'photo-chip';
  img.innerHTML = `<img src="${url}" alt="Selected photo: ${escapeHtml(name)}" loading="lazy" />`;
  img.addEventListener('click', () => openImageDialog(url, name, null));

  // Remove button
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'photo-chip-remove';
  removeBtn.setAttribute('aria-label', `Remove ${escapeHtml(name)}`);
  removeBtn.innerHTML = '&times;';
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeFileAtIndex(index);
  });

  wrap.appendChild(img);
  wrap.appendChild(removeBtn);
  return wrap;
}

/* ── Photos Queue Dialog ───────────────────── */

/** Opens the photo queue manager dialog and renders all photos. */
function openPhotosDialog() {
  renderPhotosDialogGrid();
  $('#photos-dialog').showModal();
}

/**
 * Renders (or re-renders) the grid inside the photos dialog.
 * Called when the dialog opens and after any in-dialog removal.
 */
function renderPhotosDialogGrid() {
  const grid = $('#photos-dialog-grid');
  grid.replaceChildren();

  state.photoUrls.forEach((url, index) => {
    const chip = document.createElement('div');
    chip.className = 'photos-dialog-chip';

    const imgEl = document.createElement('img');
    imgEl.src = url;
    imgEl.alt = `Selected photo: ${escapeHtml(state.files[index].name)}`;
    imgEl.loading = 'lazy';
    imgEl.addEventListener('click', () => openImageDialog(url, state.files[index].name, null));

    const nameTag = document.createElement('span');
    nameTag.className = 'photos-dialog-chip-name';
    nameTag.textContent = state.files[index].name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'photo-chip-remove';
    removeBtn.setAttribute('aria-label', `Remove ${escapeHtml(state.files[index].name)}`);
    removeBtn.innerHTML = '&times;';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFileAtIndex(index);
      // Re-render dialog grid after removal
      if (state.files.length > 0) {
        renderPhotosDialogGrid();
      } else {
        $('#photos-dialog').close();
      }
    });

    chip.appendChild(imgEl);
    chip.appendChild(nameTag);
    chip.appendChild(removeBtn);
    grid.appendChild(chip);
  });

  // Update count label
  const count = state.files.length;
  $('#photos-dialog-count').textContent =
    `${count} photo${count !== 1 ? 's' : ''} in queue`;
}

/* ── Frame Tabs & Rendering ──────────────────── */
function switchFrameTab(type) {
  const isSingle = type === 'single';
  const tabSingle = $('#tab-single');
  const tabCollage = $('#tab-collage');
  const pickerSingle = $('#picker-single');
  const pickerCollage = $('#picker-collage');

  if (tabSingle) {
    tabSingle.classList.toggle('active', isSingle);
    tabSingle.setAttribute('aria-selected', String(isSingle));
  }
  if (tabCollage) {
    tabCollage.classList.toggle('active', !isSingle);
    tabCollage.setAttribute('aria-selected', String(!isSingle));
  }
  if (pickerSingle) {
    pickerSingle.hidden = !isSingle;
    pickerSingle.style.display = isSingle ? 'grid' : 'none';
  }
  if (pickerCollage) {
    pickerCollage.hidden = isSingle;
    pickerCollage.style.display = isSingle ? 'none' : 'grid';
  }
}

function getFrameSwatchHtml(frame) {
  if (frame.overlay) {
    return `<img class="frame-swatch" src="${frame.overlay}" alt="${escapeHtml(frame.name)}" loading="lazy" />`;
  }
  // Render mini SVG layout preview for overlay-less collage frames
  const w = frame.canvas?.width || 1200;
  const h = frame.canvas?.height || 900;
  const rects = (frame.slots || []).map((s) => {
    const rx = Math.min(6, s.radius || 4);
    const sx = (s.x / w) * 100;
    const sy = (s.y / h) * 100;
    const sw = (s.width / w) * 100;
    const sh = (s.height / h) * 100;
    return `<rect x="${sx.toFixed(1)}%" y="${sy.toFixed(1)}%" width="${sw.toFixed(1)}%" height="${sh.toFixed(1)}%" rx="${rx}" fill="rgba(200,240,76,0.18)" stroke="#c8f04c" stroke-width="1.5" />`;
  }).join('');
  return `<svg class="frame-swatch svg-swatch" viewBox="0 0 100 100" preserveAspectRatio="none">${rects}</svg>`;
}

function renderFramePicker() {
  const singleFrames = state.frames.filter((f) => !f.collage);
  const collageFrames = state.frames.filter((f) => f.collage);

  const singlePicker = $('#picker-single');
  const collagePicker = $('#picker-collage');

  if (singlePicker) {
    singlePicker.replaceChildren(...singleFrames.map((frame) => frameButton(frame)));
  }
  if (collagePicker) {
    collagePicker.replaceChildren(...collageFrames.map((frame) => frameButton(frame)));
  }
}

function renderAllFrames() {
  const grid = $('#all-frames-grid');
  if (!grid) return;
  grid.replaceChildren();

  const singleFrames = state.frames.filter((f) => !f.collage);
  const collageFrames = state.frames.filter((f) => f.collage);

  const singleSection = document.createElement('div');
  singleSection.className = 'all-frames-section';
  singleSection.innerHTML = `<h4 class="all-frames-section-title">Single Photo Frames</h4>`;
  const singleGrid = document.createElement('div');
  singleGrid.className = 'all-frames-subgrid';
  singleGrid.replaceChildren(...singleFrames.map((f) => frameButton(f, true)));
  singleSection.appendChild(singleGrid);

  const collageSection = document.createElement('div');
  collageSection.className = 'all-frames-section';
  collageSection.innerHTML = `<h4 class="all-frames-section-title">Collage Frames (Multi-photo)</h4>`;
  const collageGrid = document.createElement('div');
  collageGrid.className = 'all-frames-subgrid';
  collageGrid.replaceChildren(...collageFrames.map((f) => frameButton(f, true)));
  collageSection.appendChild(collageGrid);

  grid.append(singleSection, collageSection);
}

/**
 * Render the prominent "currently selected frame" card above the picker.
 * Shown every time the selection changes.
 */
function renderActiveFrame() {
  const frame = state.selectedFrame;
  if (!frame) return;
  const card = $('#active-frame-card');
  if (!card) return;

  const thumbHtml = frame.overlay
    ? `<img class="active-frame-thumb" src="${frame.overlay}" alt="Selected frame: ${escapeHtml(frame.name)}" loading="lazy" />`
    : `<div class="active-frame-thumb active-frame-thumb-svg">${getFrameSwatchHtml(frame)}</div>`;

  const badgeText = frame.collage
    ? `&#10003; Collage Frame (${frame.slots?.length || 2} Photos)`
    : '&#10003; Single Frame';

  card.innerHTML = `
    <div class="active-frame-inner">
      ${thumbHtml}
      <div class="active-frame-info">
        <span class="active-frame-badge">${badgeText}</span>
        <strong class="active-frame-name">${escapeHtml(frame.name)}</strong>
        <span class="active-frame-dims">${frame.canvas.width} &times; ${frame.canvas.height}px</span>
      </div>
    </div>
  `;
}

function frameButton(frame, large = false) {
  const button = document.createElement('button');
  const isSelected = frame.id === state.selectedFrame?.id;
  button.className = `frame-choice${large ? ' large' : ''}${isSelected ? ' selected' : ''}`;
  button.type = 'button';
  button.setAttribute('aria-pressed', String(isSelected));

  const swatchHtml = getFrameSwatchHtml(frame);
  const badgeHtml = frame.collage ? `<span class="frame-tag-badge">${frame.slots?.length || 2} Slots</span>` : '';

  button.innerHTML = `
    ${swatchHtml}
    <span>${escapeHtml(frame.name)}</span>
    ${badgeHtml}
    ${isSelected ? '<em>Selected</em>' : ''}
  `;
  button.addEventListener('click', () => selectFrame(frame));
  return button;
}

function updateGenerateButtonText() {
  const btn = $('#generate');
  if (!btn) return;
  const isCollage = state.selectedFrame?.collage;

  if (isCollage) {
    btn.disabled = !state.files.length;
    btn.textContent = state.files.length
      ? `Arrange & generate collage (${state.selectedFrame.slots?.length || 2} photos) \u2192`
      : 'Select photos to arrange collage';
  } else {
    btn.disabled = !state.files.length;
    btn.textContent = state.files.length
      ? (state.hasPendingChanges ? `Regenerate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}` : `Generate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}`)
      : 'Generate all photos';
  }
}

/* ── Frame Selection ────────────────────────── */
async function selectFrame(frame) {
  state.selectedFrame = frame;
  if (frame.collage) {
    switchFrameTab('collage');
  } else {
    switchFrameTab('single');
  }
  renderFramePicker();
  renderAllFrames();
  renderActiveFrame();
  updateGenerateButtonText();
  $('#frame-dialog').close();

  if (!state.files.length || !state.generated) return;

  state.hasPendingChanges = true;
  renderResults();
  toggleBusy(
    false,
    `New frame selected — regenerate all ${state.files.length} to update every result`
  );
  renderLivePreview();
}

/* ── Mark Stale ─────────────────────────────── */
function markOutputsStale() {
  if (!state.files.length || !state.generated) return;
  state.hasPendingChanges = true;
  renderResults();
  $('#processing-status').textContent = 'Settings changed — regenerate to update results';
  updateGenerateButtonText();
}

/* ── Generate All ───────────────────────────── */
async function generateAll() {
  if (!state.files.length) return;

  // Collage frames open the editor instead
  if (state.selectedFrame?.collage) {
    openCollageEditor();
    return;
  }

  toggleBusy(true, `Preparing 1 of ${state.files.length}`);
  clearOutputUrls();
  state.outputs = new Array(state.files.length).fill(null);

  for (let index = 0; index < state.files.length; index += 1) {
    toggleBusy(true, `Processing ${index + 1} of ${state.files.length}`);
    const output = await compose(state.files[index]);
    replaceOutput(index, output);
    renderResults();
    await new Promise(requestAnimationFrame);
  }

  state.generated = true;
  state.hasPendingChanges = false;
  state.selectedOutputIndex = 0;
  const actions = $('#result-actions');
  if (actions) {
    actions.hidden = false;
    actions.style.display = 'flex';
  }
  const genBtn = $('#generate');
  if (genBtn) {
    genBtn.textContent = `Regenerate all ${state.files.length} photo${state.files.length > 1 ? 's' : ''}`;
  }
  toggleBusy(false, `${state.outputs.length} image${state.outputs.length > 1 ? 's' : ''} ready`);
}

/* ── Unified Preview Rendering ───────────────── */
let livePreviewTimer = null;

async function renderLivePreview() {
  const emptyBox = $('#preview-empty');
  const stage = $('#preview-stage');
  const canvas = $('#live-preview-canvas');
  const featImg = $('#featured-image');
  const filmstrip = $('#results-filmstrip-wrap');
  const actions = $('#result-actions');

  // If results already generated, keep results view
  if (state.generated && state.outputs.filter(Boolean).length) {
    if (emptyBox) { emptyBox.hidden = true; emptyBox.style.display = 'none'; }
    if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
    return;
  }

  if (!state.files.length) {
    if (emptyBox) { emptyBox.hidden = false; emptyBox.style.display = 'grid'; }
    if (stage) { stage.hidden = true; stage.style.display = 'none'; }
    const status = $('#processing-status');
    if (status) status.textContent = 'Ready';
    return;
  }

  // Files selected — show live preview stage
  if (emptyBox) { emptyBox.hidden = true; emptyBox.style.display = 'none'; }
  if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
  if (canvas) { canvas.style.display = 'block'; }
  if (featImg) { featImg.style.display = 'none'; }
  if (filmstrip) { filmstrip.hidden = true; filmstrip.style.display = 'none'; }
  if (actions) { actions.hidden = true; actions.style.display = 'none'; }

  const frame = state.selectedFrame;
  if (!frame || !canvas) return;

  const status = $('#processing-status');
  if (status) status.textContent = `${state.files.length} photo${state.files.length > 1 ? 's' : ''} ready`;

  // Debounce live rendering for butter-smooth UI
  clearTimeout(livePreviewTimer);
  livePreviewTimer = setTimeout(async () => {
    try {
      const ctx = canvas.getContext('2d');
      const w = frame.canvas.width;
      const h = frame.canvas.height;
      canvas.width = w;
      canvas.height = h;

      // Background
      ctx.fillStyle = frame.palette.background;
      ctx.fillRect(0, 0, w, h);

      if (frame.collage) {
        // Collage live layout preview
        for (let i = 0; i < frame.slots.length; i++) {
          const slot = frame.slots[i];
          const file = state.files[i % state.files.length];
          if (file) {
            const img = await loadImage(file);
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(slot.x, slot.y, slot.width, slot.height, slot.radius || 0);
            ctx.clip();

            const targetRatio = slot.width / slot.height;
            const imgRatio = img.width / img.height;
            let drawW, drawH;
            if (imgRatio > targetRatio) {
              drawH = slot.height;
              drawW = drawH * imgRatio;
            } else {
              drawW = slot.width;
              drawH = drawW / imgRatio;
            }
            const dx = slot.x - (drawW - slot.width) * 0.5;
            const dy = slot.y - (drawH - slot.height) * 0.5;
            ctx.drawImage(img, dx, dy, drawW, drawH);
            ctx.restore();
          }
        }
      } else {
        // Single frame live preview
        const file = state.files[0];
        if (file) {
          const img = await loadImage(file);
          const slot = frame.slot;
          const targetRatio = slot.width / slot.height;
          const faces = await detectFaces(img);
          const crop = $('#manual-fit')?.checked
            ? centeredCrop(img.width, img.height, targetRatio)
            : smartCrop(img, targetRatio, faces);

          ctx.save();
          if (slot.rotation) {
            const cx = slot.x + slot.width / 2;
            const cy = slot.y + slot.height / 2;
            ctx.translate(cx, cy);
            ctx.rotate((slot.rotation * Math.PI) / 180);
            ctx.beginPath();
            if (slot.radius > 0) {
              ctx.roundRect(-slot.width / 2, -slot.height / 2, slot.width, slot.height, slot.radius);
            } else {
              ctx.rect(-slot.width / 2, -slot.height / 2, slot.width, slot.height);
            }
            ctx.clip();
            ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, -slot.width / 2, -slot.height / 2, slot.width, slot.height);
          } else {
            ctx.beginPath();
            if (slot.radius > 0) {
              ctx.roundRect(slot.x, slot.y, slot.width, slot.height, slot.radius);
            } else {
              ctx.rect(slot.x, slot.y, slot.width, slot.height);
            }
            ctx.clip();
            ctx.drawImage(img, crop.x, crop.y, crop.width, crop.height, slot.x, slot.y, slot.width, slot.height);
          }
          ctx.restore();
        }
      }

      // Draw overlay
      if (frame.overlay) {
        const overlay = await loadAsset(frame.overlay);
        ctx.drawImage(overlay, 0, 0, w, h);
      }

      // Draw custom text overlay (live preview)
      await drawCustomTextOnCanvas(ctx, w, h, false);
    } catch (err) {
      console.warn('Live preview render warning:', err);
    }
  }, 40);
}

/* ── Results Lifecycle ──────────────────────── */
function resetResults() {
  clearOutputUrls();
  state.outputs = [];
  state.generated = false;
  state.hasPendingChanges = false;
  state.selectedOutputIndex = 0;
  const featImg = $('#featured-image');
  if (featImg) {
    featImg.style.display = 'none';
    featImg.src = '';
  }
  $('#results-gallery')?.replaceChildren();
  const filmstrip = $('#results-filmstrip-wrap');
  if (filmstrip) { filmstrip.hidden = true; filmstrip.style.display = 'none'; }
  const actions = $('#result-actions');
  if (actions) { actions.hidden = true; actions.style.display = 'none'; }
  renderLivePreview();
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
  const genBtn = $('#generate');
  if (genBtn) genBtn.disabled = busy || !state.files.length;
  const status = $('#processing-status');
  if (status) status.textContent = message;
}

/* ── Render: Results Showcase & Gallery ──────── */
function renderResults() {
  const emptyBox = $('#preview-empty');
  const stage = $('#preview-stage');
  const canvas = $('#live-preview-canvas');
  const featImg = $('#featured-image');
  const filmstrip = $('#results-filmstrip-wrap');
  const gallery = $('#results-gallery');
  const actions = $('#result-actions');
  const zipBtn = $('#download-zip');

  const validOutputs = state.outputs.filter(Boolean);
  if (!validOutputs.length) {
    if (state.files.length) {
      renderLivePreview();
    } else {
      if (emptyBox) { emptyBox.hidden = false; emptyBox.style.display = 'grid'; }
      if (stage) { stage.hidden = true; stage.style.display = 'none'; }
    }
    return;
  }

  // We have generated outputs
  if (emptyBox) { emptyBox.hidden = true; emptyBox.style.display = 'none'; }
  if (stage) { stage.hidden = false; stage.style.display = 'flex'; }
  if (canvas) { canvas.style.display = 'none'; }
  if (featImg) { featImg.style.display = 'block'; }
  if (actions) { actions.hidden = false; actions.style.display = 'flex'; }

  const currentIdx = Math.max(0, Math.min(state.selectedOutputIndex, validOutputs.length - 1));
  state.selectedOutputIndex = currentIdx;
  const currentOutput = validOutputs[currentIdx];

  if (featImg && currentOutput) {
    featImg.src = currentOutput.url;
    featImg.alt = currentOutput.name;
  }

  // Thumbnail filmstrip if multiple outputs
  if (gallery) {
    gallery.replaceChildren();
    if (validOutputs.length > 1) {
      if (filmstrip) { filmstrip.hidden = false; filmstrip.style.display = 'flex'; }
      validOutputs.forEach((output, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        const isSelected = index === currentIdx;
        button.className = `result-card${isSelected ? ' active-featured' : ''}${state.hasPendingChanges ? ' stale' : ''}`;
        button.innerHTML = `
          <img src="${output.url}" alt="Result ${index + 1}" loading="lazy" />
          <span>${escapeHtml(shortName(state.files[index]?.name || output.name))}</span>
        `;
        button.addEventListener('click', () => {
          state.selectedOutputIndex = index;
          renderResults();
        });
        gallery.appendChild(button);
      });
    } else {
      if (filmstrip) { filmstrip.hidden = true; filmstrip.style.display = 'none'; }
    }
  }

  if (zipBtn) {
    zipBtn.hidden = validOutputs.length <= 1;
    zipBtn.style.display = validOutputs.length > 1 ? 'block' : 'none';
  }
}


/* ── Collage Editor ─────────────────────────── */

/**
 * Opens the collage editor dialog for the selected frame.
 * Works seamlessly for both collage frames and single photo frames.
 * Initialises per-slot state and renders the full editor UI.
 */
function openCollageEditor(startSubtab = 'photos') {
  const frame = state.selectedFrame;
  if (!frame) return;

  const isCollage = Boolean(frame.collage);
  const slotsDef = isCollage ? frame.slots : [{ ...(frame.slot || {}), label: 'Main Photo' }];

  // Initialise slot state (preserve existing assignments across re-opens)
  const existing = state.collage.slots;
  state.collage.slots = slotsDef.map((_, i) => existing[i] ?? {
    fileIndex: -1,
    image: null,
    offsetX: 0.5,
    offsetY: 0.5,
    zoom: 1,
  });
  state.collage.activeSlotIndex = 0;

  // Auto-populate slots from selected files if available and empty
  if (state.files.length) {
    slotsDef.forEach((slot, i) => {
      const fIdx = isCollage ? (state.collage.slots[i].fileIndex >= 0 ? state.collage.slots[i].fileIndex : i) : 0;
      if (fIdx < state.files.length) {
        state.collage.slots[i].fileIndex = fIdx;
        loadImage(state.files[fIdx]).then((img) => {
          state.collage.slots[i].image = img;
          drawCollagePreview();
        });
      }
    });
  }

  // Update dialog header
  if ($('#collage-editor-eyebrow')) $('#collage-editor-eyebrow').textContent = frame.name.toUpperCase();
  if ($('#collage-editor-title')) $('#collage-editor-title').textContent = isCollage ? 'Arrange your photos' : 'Customize Text & Border';

  // Update subtab label
  const subtabPhotos = $('#collage-subtab-photos');
  if (subtabPhotos) {
    subtabPhotos.textContent = isCollage ? 'Photos & Fit' : 'Photo Placement';
  }

  // Initialise text overlay if needed
  if (!state.collage.text) {
    state.collage.text = {
      content: '',
      xPercent: 0.5,
      yPercent: 0.88,
      fontSize: 46,
      fontFamily: "'Outfit', sans-serif",
      fontEffect: 'none',
      color: '#ffffff',
      bold: true,
      shadow: true,
      boxMode: 'border',
      borderColor: '#c8f04c',
      borderWidth: 4,
      borderStyle: 'curved',
      fillColor: '#111111',
      paddingX: 20,
      paddingY: 10,
    };
  }

  switchCollageSubtab(startSubtab);
  syncCollageTextUI();
  setupCollageTextDrag();

  renderCollageEditor();
  $('#collage-editor')?.showModal();

  // Draw after dialog is visible so canvas has layout dimensions
  requestAnimationFrame(() => {
    drawCollagePreview();
    positionSlotOverlays();
    updateTextOverlayPosition();
  });
}

/** Full re-render of collage editor right panel + photo strip. */
function renderCollageEditor() {
  renderCollageSlotsList();
  renderCollagePhotoStrip();
}

/** Render the slot list (right panel). */
function renderCollageSlotsList() {
  const frame = state.selectedFrame;
  const list = $('#collage-slots-list');
  if (!list || !frame) return;
  list.replaceChildren();

  const slotsDef = frame.collage ? frame.slots : [{ ...(frame.slot || {}), label: 'Main Photo' }];

  slotsDef.forEach((slotDef, i) => {
    const slotState = state.collage.slots[i];
    const isActive = i === state.collage.activeSlotIndex;
    const hasPic = slotState.fileIndex >= 0;

    const item = document.createElement('div');
    item.className = `collage-slot-item${isActive ? ' active' : ''}`;

    // Header row
    const header = document.createElement('div');
    header.className = 'collage-slot-item-header';
    header.addEventListener('click', () => setActiveCollageSlot(i));

    // Thumbnail
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'collage-slot-thumb';
    if (hasPic) {
      const img = document.createElement('img');
      img.src = state.photoUrls[slotState.fileIndex];
      img.alt = state.files[slotState.fileIndex].name;
      thumbWrap.appendChild(img);
    } else {
      thumbWrap.textContent = '⊡';
    }

    const meta = document.createElement('div');
    meta.className = 'collage-slot-meta';
    meta.innerHTML = `
      <div class="collage-slot-name">${escapeHtml(slotDef.label)}</div>
      <div class="collage-slot-photo-name">${hasPic ? escapeHtml(shortName(state.files[slotState.fileIndex].name)) : 'Empty — tap to select'}</div>
    `;

    header.append(thumbWrap, meta);

    // Pan / zoom controls (hidden unless active)
    const controls = document.createElement('div');
    controls.className = 'collage-slot-controls';

    if (hasPic) {
      // Zoom
      const zoomLabel = document.createElement('div');
      zoomLabel.className = 'collage-panzoom-label';
      zoomLabel.textContent = 'Zoom';

      const zoomRow = document.createElement('div');
      zoomRow.className = 'collage-panzoom-row';
      const zoomInput = document.createElement('input');
      zoomInput.type = 'range';
      zoomInput.min = '1'; zoomInput.max = '4'; zoomInput.step = '0.05';
      zoomInput.value = String(slotState.zoom);
      zoomInput.setAttribute('aria-label', 'Zoom');
      const zoomVal = document.createElement('span');
      zoomVal.textContent = `${slotState.zoom.toFixed(2)}×`;
      zoomInput.addEventListener('input', () => {
        state.collage.slots[i].zoom = Number(zoomInput.value);
        zoomVal.textContent = `${Number(zoomInput.value).toFixed(2)}×`;
        drawCollagePreview();
      });
      zoomRow.append(zoomInput, zoomVal);

      // Horizontal pan
      const panXLabel = document.createElement('div');
      panXLabel.className = 'collage-panzoom-label';
      panXLabel.textContent = 'Horizontal position';

      const panXRow = document.createElement('div');
      panXRow.className = 'collage-panzoom-row';
      const panXInput = document.createElement('input');
      panXInput.type = 'range';
      panXInput.min = '0'; panXInput.max = '1'; panXInput.step = '0.01';
      panXInput.value = String(slotState.offsetX);
      panXInput.setAttribute('aria-label', 'Horizontal position');
      const panXVal = document.createElement('span');
      panXVal.textContent = `${Math.round(slotState.offsetX * 100)}%`;
      panXInput.addEventListener('input', () => {
        state.collage.slots[i].offsetX = Number(panXInput.value);
        panXVal.textContent = `${Math.round(Number(panXInput.value) * 100)}%`;
        drawCollagePreview();
      });
      panXRow.append(panXInput, panXVal);

      // Vertical pan
      const panYLabel = document.createElement('div');
      panYLabel.className = 'collage-panzoom-label';
      panYLabel.textContent = 'Vertical position';

      const panYRow = document.createElement('div');
      panYRow.className = 'collage-panzoom-row';
      const panYInput = document.createElement('input');
      panYInput.type = 'range';
      panYInput.min = '0'; panYInput.max = '1'; panYInput.step = '0.01';
      panYInput.value = String(slotState.offsetY);
      panYInput.setAttribute('aria-label', 'Vertical position');
      const panYVal = document.createElement('span');
      panYVal.textContent = `${Math.round(slotState.offsetY * 100)}%`;
      panYInput.addEventListener('input', () => {
        state.collage.slots[i].offsetY = Number(panYInput.value);
        panYVal.textContent = `${Math.round(Number(panYInput.value) * 100)}%`;
        drawCollagePreview();
      });
      panYRow.append(panYInput, panYVal);

      // Clear button
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'collage-clear-slot';
      clearBtn.textContent = '✕ Remove photo from this slot';
      clearBtn.addEventListener('click', () => {
        state.collage.slots[i] = { fileIndex: -1, image: null, offsetX: 0.5, offsetY: 0.5, zoom: 1 };
        renderCollageEditor();
        drawCollagePreview();
        positionSlotOverlays();
      });

      controls.append(zoomLabel, zoomRow, panXLabel, panXRow, panYLabel, panYRow, clearBtn);
    } else {
      const hint = document.createElement('p');
      hint.style.cssText = 'font-size:0.72rem;color:var(--ink-dim);margin:0';
      hint.textContent = 'Click a photo below to assign it here.';
      controls.appendChild(hint);
    }

    item.append(header, controls);
    list.appendChild(item);
  });
}

/** Render draggable photo thumbnails in the collage panel queue. */
function renderCollagePhotoStrip() {
  const strip = $('#collage-photo-strip');
  strip.replaceChildren();

  const usedIndices = new Set(state.collage.slots.map(s => s.fileIndex).filter(i => i >= 0));

  state.photoUrls.forEach((url, fileIndex) => {
    const img = document.createElement('img');
    img.src = url;
    img.alt = state.files[fileIndex].name;
    img.className = `collage-queue-thumb${usedIndices.has(fileIndex) ? ' used' : ''}`;
    img.draggable = true;
    img.title = state.files[fileIndex].name;

    // Click-to-assign: assigns to active slot
    img.addEventListener('click', () => assignPhotoToSlot(state.collage.activeSlotIndex, fileIndex));

    // Drag to slot overlay
    img.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(fileIndex));
      img.classList.add('dragging');
    });
    img.addEventListener('dragend', () => img.classList.remove('dragging'));

    strip.appendChild(img);
  });
}

/**
 * Assigns a photo (by fileIndex) to a slot, loading the image for canvas draw.
 * @param {number} slotIndex
 * @param {number} fileIndex
 */
async function assignPhotoToSlot(slotIndex, fileIndex) {
  const frame = state.selectedFrame;
  if (!frame?.collage || slotIndex < 0 || slotIndex >= frame.slots.length) return;

  const image = await loadImage(state.files[fileIndex]);
  state.collage.slots[slotIndex] = {
    fileIndex,
    image,
    offsetX: 0.5,
    offsetY: 0.5,
    zoom: 1,
  };

  renderCollageEditor();
  setActiveCollageSlot(slotIndex);
  drawCollagePreview();
  positionSlotOverlays();
}

/** Set the active (focused) slot index and re-render the panel list. */
function setActiveCollageSlot(index) {
  state.collage.activeSlotIndex = index;
  renderCollageSlotsList();
  // Highlight the overlay too
  document.querySelectorAll('.collage-slot-overlay').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
}

/**
 * Draws the live collage preview onto #collage-canvas.
 * Scales the virtual canvas (frame.canvas.width × height) to fit the element.
 */
async function drawCollagePreview() {
  const frame = state.selectedFrame;
  const canvasEl = $('#collage-canvas');
  if (!frame || !canvasEl) return;

  const { width, height } = frame.canvas;
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');

  // Background
  ctx.fillStyle = frame.palette.background;
  ctx.fillRect(0, 0, width, height);

  const slotsDef = frame.collage ? frame.slots : [frame.slot];

  // Draw each slot
  for (let i = 0; i < slotsDef.length; i++) {
    const slotDef = slotsDef[i];
    const slotState = state.collage.slots[i];

    ctx.save();

    if (slotDef.rotation) {
      const cx = slotDef.x + slotDef.width / 2;
      const cy = slotDef.y + slotDef.height / 2;
      ctx.translate(cx, cy);
      ctx.rotate((slotDef.rotation * Math.PI) / 180);
      ctx.beginPath();
      if (slotDef.radius > 0) {
        ctx.roundRect(-slotDef.width / 2, -slotDef.height / 2, slotDef.width, slotDef.height, slotDef.radius);
      } else {
        ctx.rect(-slotDef.width / 2, -slot.height / 2, slotDef.width, slotDef.height);
      }
      ctx.clip();

      if (slotState?.image) {
        const img = slotState.image;
        const zoom = slotState.zoom || 1;
        const targetRatio = slotDef.width / slotDef.height;
        const imgRatio = img.width / img.height;
        let drawW, drawH;
        if (imgRatio > targetRatio) {
          drawH = slotDef.height * zoom;
          drawW = drawH * imgRatio;
        } else {
          drawW = slotDef.width * zoom;
          drawH = drawW / imgRatio;
        }
        const maxOffX = drawW - slotDef.width;
        const maxOffY = drawH - slotDef.height;
        const dx = -slotDef.width / 2 - maxOffX * (slotState.offsetX ?? 0.5);
        const dy = -slotDef.height / 2 - maxOffY * (slotState.offsetY ?? 0.5);
        ctx.drawImage(img, dx, dy, drawW, drawH);
      }
    } else {
      const r = slotDef.radius || 0;
      ctx.beginPath();
      if (r > 0) {
        ctx.roundRect(slotDef.x, slotDef.y, slotDef.width, slotDef.height, r);
      } else {
        ctx.rect(slotDef.x, slotDef.y, slotDef.width, slotDef.height);
      }
      ctx.clip();

      if (slotState?.image) {
        const img = slotState.image;
        const zoom = slotState.zoom || 1;
        const targetRatio = slotDef.width / slotDef.height;
        const imgRatio = img.width / img.height;

        let drawW, drawH;
        if (imgRatio > targetRatio) {
          drawH = slotDef.height * zoom;
          drawW = drawH * imgRatio;
        } else {
          drawW = slotDef.width * zoom;
          drawH = drawW / imgRatio;
        }

        const maxOffX = drawW - slotDef.width;
        const maxOffY = drawH - slotDef.height;
        const dx = slotDef.x - maxOffX * (slotState.offsetX ?? 0.5);
        const dy = slotDef.y - maxOffY * (slotState.offsetY ?? 0.5);

        ctx.drawImage(img, dx, dy, drawW, drawH);
      } else {
        // Empty slot placeholder
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,240,76,0.45)';
        ctx.lineWidth = 3;
        ctx.setLineDash([12, 8]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = 'rgba(200,240,76,0.7)';
        ctx.font = `bold ${Math.round(slotDef.height * 0.06)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(slotDef.label || 'Photo', slotDef.x + slotDef.width / 2, slotDef.y + slotDef.height / 2);
      }
    }

    ctx.restore();
  }

  // Draw overlay if exists (on top of all slots)
  if (frame.overlay) {
    try {
      const img = await loadAsset(frame.overlay);
      ctx.drawImage(img, 0, 0, width, height);
    } catch (err) {
      console.warn('Failed to draw frame overlay in preview:', err);
    }
  }

  // Draw custom text overlay (preview)
  await drawCustomTextOnCanvas(ctx, width, height, false);

  updateTextOverlayPosition();
}

/**
 * Positions the transparent HTML overlay divs (for drag-drop / click) on top
 * of the canvas slots. Must be called after the canvas has been drawn and
 * has its layout size (not logical pixel size).
 */
function positionSlotOverlays() {
  const frame = state.selectedFrame;
  const canvasEl = $('#collage-canvas');
  const overlayContainer = $('#collage-slot-overlays');
  if (!frame || !canvasEl || !overlayContainer) return;

  overlayContainer.replaceChildren();

  const rect = canvasEl.getBoundingClientRect();
  const parentRect = overlayContainer.getBoundingClientRect();
  const scaleX = rect.width / frame.canvas.width;
  const scaleY = rect.height / frame.canvas.height;
  const offsetLeft = rect.left - parentRect.left;
  const offsetTop = rect.top - parentRect.top;

  const slotsDef = frame.collage ? frame.slots : [frame.slot];

  slotsDef.forEach((slotDef, i) => {
    const slotState = state.collage.slots[i];
    const isActive = i === state.collage.activeSlotIndex;
    const hasPic = slotState?.fileIndex >= 0;

    const el = document.createElement('div');
    el.className = [
      'collage-slot-overlay',
      hasPic ? 'filled' : '',
      isActive ? 'active' : '',
    ].filter(Boolean).join(' ');

    el.style.left = `${offsetLeft + slotDef.x * scaleX}px`;
    el.style.top = `${offsetTop + slotDef.y * scaleY}px`;
    el.style.width = `${slotDef.width * scaleX}px`;
    el.style.height = `${slotDef.height * scaleY}px`;
    el.style.borderRadius = `${slotDef.radius || 0}px`;

    // Slot label
    const labelEl = document.createElement('span');
    labelEl.className = 'collage-slot-label';
    labelEl.textContent = slotDef.label || 'Main Photo';
    el.appendChild(labelEl);

    // Empty icon
    if (!hasPic) {
      const icon = document.createElement('span');
      icon.className = 'collage-slot-empty-icon';
      icon.textContent = '＋';
      el.appendChild(icon);
    }

    // Click → set active slot
    el.addEventListener('click', () => setActiveCollageSlot(i));

    // Drag-over: highlight
    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      const fileIndex = Number(e.dataTransfer.getData('text/plain'));
      if (!isNaN(fileIndex) && fileIndex >= 0) assignPhotoToSlot(i, fileIndex);
    });

    overlayContainer.appendChild(el);
  });

  updateTextOverlayPosition();
}

/** Generates the final collage image and adds it to results. */
async function generateCollage() {
  const frame = state.selectedFrame;
  if (!frame) return;

  if (!frame.collage) {
    $('#collage-editor')?.close();
    drawLivePreview();
    state.hasPendingChanges = true;
    generateAll();
    return;
  }

  // Check all slots are filled
  const empty = state.collage.slots.filter(s => s.fileIndex < 0);
  if (empty.length) {
    // Allow partial generation — just warn
    const proceed = confirm(`${empty.length} slot(s) are still empty. Generate anyway?`);
    if (!proceed) return;
  }

  $('#collage-editor').close();
  toggleBusy(true, 'Composing collage…');

  try {
    const output = await composeCollage();
    clearOutputUrls();
    state.outputs = [output];
    state.files = state.files; // keep queue
    state.generated = true;
    state.hasPendingChanges = false;
    state.selectedOutputIndex = 0;
    $('#result-actions').hidden = false;
    renderResults();
    toggleBusy(false, '1 collage image ready');
  } catch (err) {
    console.error('Collage compose failed:', err);
    toggleBusy(false, 'Collage generation failed');
  }
}

/**
 * Renders the final full-resolution collage onto a canvas and returns
 * a { blob, url, name } output object.
 */
async function composeCollage() {
  const frame = state.selectedFrame;
  const { width, height } = frame.canvas;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = frame.palette.background;
  ctx.fillRect(0, 0, width, height);

  for (const [i, slotDef] of frame.slots.entries()) {
    const slotState = state.collage.slots[i];
    if (!slotState?.image) continue;

    ctx.save();
    const r = slotDef.radius || 0;
    ctx.beginPath();
    ctx.roundRect(slotDef.x, slotDef.y, slotDef.width, slotDef.height, r);
    ctx.clip();

    const img  = slotState.image;
    const zoom = slotState.zoom;
    const targetRatio = slotDef.width / slotDef.height;
    const imgRatio    = img.width / img.height;

    let drawW, drawH;
    if (imgRatio > targetRatio) {
      drawH = slotDef.height * zoom;
      drawW = drawH * imgRatio;
    } else {
      drawW = slotDef.width * zoom;
      drawH = drawW / imgRatio;
    }

    const maxOffX = drawW - slotDef.width;
    const maxOffY = drawH - slotDef.height;
    const dx = slotDef.x - maxOffX * slotState.offsetX;
    const dy = slotDef.y - maxOffY * slotState.offsetY;

    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.restore();
  }

  // Overlay (if frame has one)
  if (frame.overlay) {
    const overlay = await loadAsset(frame.overlay);
    ctx.drawImage(overlay, 0, 0, width, height);
  }

  // Custom text overlay (full-res export)
  await drawCustomTextOnCanvas(ctx, width, height, true);

  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', state.quality)
  );

  const name = `collage-${frame.id}-${Date.now()}.jpg`;
  return { blob, url: URL.createObjectURL(blob), name };
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
  if (frame.slot.rotation) {
    const cx = frame.slot.x + frame.slot.width / 2;
    const cy = frame.slot.y + frame.slot.height / 2;
    ctx.translate(cx, cy);
    ctx.rotate((frame.slot.rotation * Math.PI) / 180);
    ctx.beginPath();
    if (frame.slot.radius > 0) {
      ctx.roundRect(-frame.slot.width / 2, -frame.slot.height / 2, frame.slot.width, frame.slot.height, frame.slot.radius);
    } else {
      ctx.rect(-frame.slot.width / 2, -frame.slot.height / 2, frame.slot.width, frame.slot.height);
    }
    ctx.clip();
    ctx.drawImage(
      image,
      crop.x, crop.y, crop.width, crop.height,
      -frame.slot.width / 2, -frame.slot.height / 2, frame.slot.width, frame.slot.height
    );
  } else {
    ctx.beginPath();
    if (frame.slot.radius > 0) {
      ctx.roundRect(frame.slot.x, frame.slot.y, frame.slot.width, frame.slot.height, frame.slot.radius);
    } else {
      ctx.rect(frame.slot.x, frame.slot.y, frame.slot.width, frame.slot.height);
    }
    ctx.clip();
    ctx.drawImage(
      image,
      crop.x, crop.y, crop.width, crop.height,
      frame.slot.x, frame.slot.y, frame.slot.width, frame.slot.height
    );
  }
  ctx.restore();

  // Draw frame overlay on top
  const overlay = await loadAsset(frame.overlay);
  ctx.drawImage(overlay, 0, 0, width, height);

  // Draw custom text overlay (full-res export)
  await drawCustomTextOnCanvas(ctx, width, height, true);

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

/* ── Collage Text Overlay Helpers ───────────── */

/**
 * Draws a decorative wavy border path along a rectangle on a 2D canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} waveLen
 * @param {number} waveAmp
 */
function drawCanvasWavyRect(ctx, x, y, w, h, waveLen = 14, waveAmp = 3.5) {
  ctx.beginPath();
  // Top edge
  ctx.moveTo(x, y);
  const stepsX = Math.max(2, Math.round(w / waveLen));
  const stepW = w / stepsX;
  for (let i = 0; i < stepsX; i++) {
    const cx = x + (i + 0.5) * stepW;
    const cy = y + (i % 2 === 0 ? -waveAmp : waveAmp);
    ctx.quadraticCurveTo(cx, cy, x + (i + 1) * stepW, y);
  }
  // Right edge
  const stepsY = Math.max(2, Math.round(h / waveLen));
  const stepH = h / stepsY;
  for (let i = 0; i < stepsY; i++) {
    const cx = x + w + (i % 2 === 0 ? waveAmp : -waveAmp);
    const cy = y + (i + 0.5) * stepH;
    ctx.quadraticCurveTo(cx, cy, x + w, y + (i + 1) * stepH);
  }
  // Bottom edge (right to left)
  for (let i = stepsX; i > 0; i--) {
    const cx = x + (i - 0.5) * stepW;
    const cy = y + h + (i % 2 === 0 ? waveAmp : -waveAmp);
    ctx.quadraticCurveTo(cx, cy, x + (i - 1) * stepW, y + h);
  }
  // Left edge (bottom to top)
  for (let i = stepsY; i > 0; i--) {
    const cx = x + (i % 2 === 0 ? -waveAmp : waveAmp);
    const cy = y + (i - 0.5) * stepH;
    ctx.quadraticCurveTo(cx, cy, x, y + (i - 1) * stepH);
  }
  ctx.closePath();
}

/**
 * Draws the custom text overlay (with border or solid fill plate) on the canvas.
 * Used for both live preview and high-resolution export.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {boolean} [isExport=false]
 */
async function drawCustomTextOnCanvas(ctx, canvasWidth, canvasHeight, isExport = false) {
  const t = state.collage?.text;
  if (!t || !t.content || !t.content.trim()) return;

  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch (err) {
    // Continue even if font check throws
  }

  const frameWidth = state.selectedFrame?.canvas?.width || canvasWidth;
  const scale = canvasWidth / frameWidth;

  const fontSize = Math.max(12, Math.round(t.fontSize * scale));
  const padX = Math.max(8, Math.round((t.paddingX || 20) * scale));
  const padY = Math.max(4, Math.round((t.paddingY || 10) * scale));
  const strokeW = Math.max(1, Math.round((t.borderWidth || 4) * scale));

  const cx = t.xPercent * canvasWidth;
  const cy = t.yPercent * canvasHeight;

  ctx.save();
  ctx.font = `${t.bold ? 'bold ' : ''}${fontSize}px ${t.fontFamily}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  const metrics = ctx.measureText(t.content);
  const textW = metrics.width;
  const textH = fontSize * 1.1;

  const boxW = textW + padX * 2;
  const boxH = textH + padY * 2;
  const boxX = cx - boxW / 2;
  const boxY = cy - boxH / 2;

  // Render Box Plate (Solid Fill vs Border vs None)
  if (t.boxMode === 'fill') {
    ctx.save();
    ctx.fillStyle = t.fillColor || '#111111';
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, Math.min(boxH / 2, 14 * scale));
    ctx.fill();
    ctx.restore();
  } else if (t.boxMode === 'border') {
    ctx.save();
    ctx.strokeStyle = t.borderColor || '#c8f04c';
    ctx.lineWidth = strokeW;

    if (t.borderStyle === 'sharp') {
      ctx.beginPath();
      ctx.rect(boxX, boxY, boxW, boxH);
      ctx.stroke();
    } else if (t.borderStyle === 'curved') {
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, boxH / 2);
      ctx.stroke();
    } else if (t.borderStyle === 'wavy') {
      drawCanvasWavyRect(ctx, boxX, boxY, boxW, boxH, Math.max(8, 14 * scale), Math.max(2, 3.5 * scale));
      ctx.stroke();
    } else if (t.borderStyle === 'neon-animated') {
      // Outer neon aura
      ctx.shadowColor = t.borderColor || '#c8f04c';
      ctx.shadowBlur = 18 * scale;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, Math.min(boxH / 2, 16 * scale));
      ctx.stroke();

      // Inner crisp white core highlight
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(1, strokeW * 0.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw Text
  ctx.save();
  if (t.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = Math.round(6 * scale);
    ctx.shadowOffsetX = Math.round(2 * scale);
    ctx.shadowOffsetY = Math.round(2 * scale);
  }

  if (t.fontEffect === 'neon-pulse') {
    ctx.shadowColor = t.color || '#c8f04c';
    ctx.shadowBlur = Math.round(14 * scale);
  }

  ctx.fillStyle = t.color || '#ffffff';
  ctx.fillText(t.content, cx, cy);
  ctx.restore();

  ctx.restore();
}

/** Syncs state.collage.text state to all HTML form inputs & buttons. */
function syncCollageTextUI() {
  const t = state.collage.text;
  if (!t) return;

  const input = $('#collage-text-input');
  const fontSelect = $('#collage-font-select');
  const effectSelect = $('#collage-text-effect');
  const sizeInput = $('#collage-font-size');
  const sizeVal = $('#collage-font-size-val');
  const boldBtn = $('#collage-bold-toggle');
  const shadowBtn = $('#collage-shadow-toggle');
  const colorPicker = $('#collage-color-picker');

  if (input) input.value = t.content || '';
  if (fontSelect) fontSelect.value = t.fontFamily || "'Outfit', sans-serif";
  if (effectSelect) effectSelect.value = t.fontEffect || 'none';
  if (sizeInput) sizeInput.value = String(t.fontSize || 46);
  if (sizeVal) sizeVal.textContent = `${t.fontSize || 46}px`;
  if (boldBtn) boldBtn.classList.toggle('active', Boolean(t.bold));
  if (shadowBtn) shadowBtn.classList.toggle('active', Boolean(t.shadow));
  if (colorPicker) colorPicker.value = t.color || '#ffffff';

  // Text color presets
  document.querySelectorAll('.text-color-presets .color-preset').forEach((b) => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === (t.color || '').toLowerCase());
  });

  // Box style mode buttons (border | fill | none)
  document.querySelectorAll('.style-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === t.boxMode);
  });

  // Smart Fill vs Border fields disabling
  const groupBorder = $('#group-border-settings');
  const groupFill = $('#group-fill-settings');
  const borderWidthInput = $('#collage-border-width');
  const borderWidthVal = $('#collage-border-width-val');
  const borderColorPicker = $('#collage-border-color-picker');
  const fillColorPicker = $('#collage-fill-color-picker');

  if (t.boxMode === 'fill') {
    // When Fill is active: disable border-exclusive controls
    if (groupBorder) groupBorder.classList.add('disabled-field-group');
    if (borderWidthInput) borderWidthInput.disabled = true;
    if (borderColorPicker) borderColorPicker.disabled = true;
    document.querySelectorAll('.border-color-presets .border-preset').forEach((b) => (b.disabled = true));
    document.querySelectorAll('.variation-chip').forEach((b) => (b.disabled = true));

    // Enable fill controls
    if (groupFill) groupFill.classList.remove('disabled-field-group');
    if (fillColorPicker) {
      fillColorPicker.disabled = false;
      fillColorPicker.value = t.fillColor || '#111111';
    }
    document.querySelectorAll('.fill-color-presets .fill-preset').forEach((b) => {
      b.disabled = false;
      b.classList.toggle('active', b.dataset.color.toLowerCase() === (t.fillColor || '').toLowerCase());
    });
  } else if (t.boxMode === 'border') {
    // When Border is active: enable border controls, disable fill
    if (groupBorder) groupBorder.classList.remove('disabled-field-group');
    if (borderWidthInput) {
      borderWidthInput.disabled = false;
      borderWidthInput.value = String(t.borderWidth || 4);
    }
    if (borderWidthVal) borderWidthVal.textContent = `${t.borderWidth || 4}px`;
    if (borderColorPicker) {
      borderColorPicker.disabled = false;
      borderColorPicker.value = t.borderColor || '#c8f04c';
    }
    document.querySelectorAll('.border-color-presets .border-preset').forEach((b) => {
      b.disabled = false;
      b.classList.toggle('active', b.dataset.color.toLowerCase() === (t.borderColor || '').toLowerCase());
    });
    document.querySelectorAll('.variation-chip').forEach((b) => {
      b.disabled = false;
      b.classList.toggle('active', b.dataset.style === (t.borderStyle || 'curved'));
    });

    // Disable fill controls
    if (groupFill) groupFill.classList.add('disabled-field-group');
    if (fillColorPicker) fillColorPicker.disabled = true;
    document.querySelectorAll('.fill-color-presets .fill-preset').forEach((b) => (b.disabled = true));
  } else {
    // None: disable both groups
    if (groupBorder) groupBorder.classList.add('disabled-field-group');
    if (borderWidthInput) borderWidthInput.disabled = true;
    if (borderColorPicker) borderColorPicker.disabled = true;
    document.querySelectorAll('.border-color-presets .border-preset').forEach((b) => (b.disabled = true));
    document.querySelectorAll('.variation-chip').forEach((b) => (b.disabled = true));

    if (groupFill) groupFill.classList.add('disabled-field-group');
    if (fillColorPicker) fillColorPicker.disabled = true;
    document.querySelectorAll('.fill-color-presets .fill-preset').forEach((b) => (b.disabled = true));
  }

  updateTextOverlayPosition();
}

/** Switches subtabs inside the collage/text dialog. */
function switchCollageSubtab(tab) {
  const isPhotos = tab === 'photos';
  const tabPhotos = $('#collage-subtab-photos');
  const tabText = $('#collage-subtab-text');
  const panePhotos = $('#collage-pane-photos');
  const paneText = $('#collage-pane-text');
  const previewWrap = $('#collage-preview-wrap');

  if (tabPhotos) tabPhotos.classList.toggle('active', isPhotos);
  if (tabText) tabText.classList.toggle('active', !isPhotos);

  if (panePhotos) {
    panePhotos.hidden = !isPhotos;
    panePhotos.style.display = isPhotos ? 'flex' : 'none';
  }
  if (paneText) {
    paneText.hidden = isPhotos;
    paneText.style.display = isPhotos ? 'none' : 'flex';
  }

  if (previewWrap) {
    previewWrap.classList.toggle('mode-text', !isPhotos);
  }

  updateTextOverlayPosition();
  if (!isPhotos) {
    $('#collage-text-input')?.focus();
  }
}

/** Updates the position and styles of the interactive drag/resize box. */
function updateTextOverlayPosition() {
  const dragBox = $('#collage-text-drag-box');
  const dragContent = $('#collage-text-drag-content');
  const canvasEl = $('#collage-canvas');
  const t = state.collage?.text;

  if (!dragBox || !canvasEl || !t) return;

  const content = (t.content || '').trim();
  const isTextTabActive = $('#collage-subtab-text')?.classList.contains('active');

  // If there's no text and text tab is NOT active, hide the drag box
  if (!content && !isTextTabActive) {
    dragBox.style.display = 'none';
    return;
  }

  dragBox.style.display = 'flex';

  const rect = canvasEl.getBoundingClientRect();
  const parent = dragBox.parentElement;
  if (!parent || !rect.width || !rect.height) return;
  const parentRect = parent.getBoundingClientRect();

  const scale = rect.width / (state.selectedFrame?.canvas?.width || 1200);
  const scaledSize = Math.max(14, Math.round(t.fontSize * scale));

  // Sync mode classes
  dragBox.className = 'collage-text-drag-box';
  dragBox.classList.add(`box-mode-${t.boxMode}`);
  if (t.boxMode === 'border') {
    dragBox.classList.add(`border-${t.borderStyle}`);
  }
  if (t.fontEffect && t.fontEffect !== 'none') {
    dragBox.classList.add(`text-effect-${t.fontEffect}`);
  }

  // Inline styling for borders & backgrounds
  if (t.boxMode === 'border') {
    dragBox.style.borderColor = t.borderColor;
    dragBox.style.borderWidth = `${Math.max(2, Math.round((t.borderWidth || 4) * scale))}px`;
    dragBox.style.borderStyle = t.borderStyle === 'wavy' ? 'dashed' : 'solid';
    dragBox.style.backgroundColor = 'transparent';
    if (t.borderStyle === 'neon-animated') {
      dragBox.style.color = t.borderColor;
    }
  } else if (t.boxMode === 'fill') {
    dragBox.style.backgroundColor = t.fillColor;
    dragBox.style.borderColor = 'transparent';
    dragBox.style.borderWidth = '0px';
  } else {
    dragBox.style.backgroundColor = 'transparent';
    dragBox.style.borderColor = 'transparent';
    dragBox.style.borderWidth = '0px';
  }

  // Text content styling
  dragBox.style.fontFamily = t.fontFamily;
  dragBox.style.fontWeight = t.bold ? 'bold' : 'normal';
  dragBox.style.fontSize = `${scaledSize}px`;
  dragBox.style.padding = `${Math.max(4, Math.round((t.paddingY || 10) * scale))}px ${Math.max(8, Math.round((t.paddingX || 20) * scale))}px`;

  if (dragContent) {
    dragContent.textContent = content || (isTextTabActive ? 'Click & type custom text' : '');
    dragContent.style.color = t.color;
    dragContent.style.opacity = content ? '1' : '0.65';
    dragContent.style.fontStyle = content ? 'normal' : 'italic';
    dragContent.style.textShadow = t.shadow ? '0 2px 8px rgba(0, 0, 0, 0.85)' : 'none';
  }

  const left = (rect.left - parentRect.left) + t.xPercent * rect.width;
  const top = (rect.top - parentRect.top) + t.yPercent * rect.height;

  dragBox.style.left = `${left}px`;
  dragBox.style.top = `${top}px`;
}

let isDraggingText = false;
let isResizingText = false;
let startPointerX = 0;
let startPointerY = 0;
let startXPercent = 0.5;
let startYPercent = 0.88;
let startFontSize = 46;
let startBoxRadius = 50;

/** Sets up drag movement and dynamic corner resizing on the text box. */
function setupCollageTextDrag() {
  const dragBox = $('#collage-text-drag-box');
  const resizeHandle = $('#collage-text-resize-handle');
  const canvasEl = $('#collage-canvas');
  const previewWrap = $('#collage-preview-wrap');
  if (!dragBox || !canvasEl) return;

  // Clicking on dragBox when in photos tab switches to text tab
  dragBox.onclick = (e) => {
    if (e.target.closest('#collage-text-resize-handle')) return;
    if ($('#collage-subtab-text') && !$('#collage-subtab-text').classList.contains('active')) {
      switchCollageSubtab('text');
    }
  };

  // --- Dynamic Corner Resizing Handler ---
  if (resizeHandle) {
    const onResizeDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isResizingText = true;
      resizeHandle.classList.add('resizing');
      dragBox.classList.add('resizing');

      startPointerX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      startPointerY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      startFontSize = state.collage.text.fontSize || 46;

      const rect = dragBox.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      startBoxRadius = Math.max(12, Math.hypot(startPointerX - centerX, startPointerY - centerY));

      const onResizeMove = (ev) => {
        if (!isResizingText) return;
        const curX = ev.clientX ?? ev.touches?.[0]?.clientX;
        const curY = ev.clientY ?? ev.touches?.[0]?.clientY;
        if (curX === undefined || curY === undefined) return;

        const currentRadius = Math.hypot(curX - centerX, curY - centerY);
        const ratio = currentRadius / startBoxRadius;

        const newSize = Math.round(Math.max(18, Math.min(110, startFontSize * ratio)));
        state.collage.text.fontSize = newSize;

        const sizeInput = $('#collage-font-size');
        const sizeVal = $('#collage-font-size-val');
        if (sizeInput) sizeInput.value = String(newSize);
        if (sizeVal) sizeVal.textContent = `${newSize}px`;

        updateTextOverlayPosition();
        drawCollagePreview();
      };

      const onResizeUp = () => {
        if (!isResizingText) return;
        isResizingText = false;
        resizeHandle.classList.remove('resizing');
        dragBox.classList.remove('resizing');
        window.removeEventListener('pointermove', onResizeMove);
        window.removeEventListener('pointerup', onResizeUp);
        window.removeEventListener('touchmove', onResizeMove);
        window.removeEventListener('touchend', onResizeUp);
      };

      window.addEventListener('pointermove', onResizeMove);
      window.addEventListener('pointerup', onResizeUp);
      window.addEventListener('touchmove', onResizeMove, { passive: false });
      window.addEventListener('touchend', onResizeUp);
    };

    resizeHandle.onpointerdown = onResizeDown;
    resizeHandle.ontouchstart = onResizeDown;
  }

  // --- Drag Movement Handler ---
  const onPointerDown = (e) => {
    if (e.target.closest('#collage-text-resize-handle')) return;
    e.preventDefault();
    e.stopPropagation();
    isDraggingText = true;
    dragBox.classList.add('dragging');
    startPointerX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    startPointerY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    startXPercent = state.collage.text.xPercent;
    startYPercent = state.collage.text.yPercent;

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);
  };

  const onPointerMove = (e) => {
    if (!isDraggingText) return;
    const clientX = e.clientX ?? e.touches?.[0]?.clientX;
    const clientY = e.clientY ?? e.touches?.[0]?.clientY;
    if (clientX === undefined || clientY === undefined) return;

    const rect = canvasEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const deltaX = clientX - startPointerX;
    const deltaY = clientY - startPointerY;

    state.collage.text.xPercent = Math.max(0.04, Math.min(0.96, startXPercent + deltaX / rect.width));
    state.collage.text.yPercent = Math.max(0.04, Math.min(0.96, startYPercent + deltaY / rect.height));

    updateTextOverlayPosition();
    drawCollagePreview();
  };

  const onTouchMove = (e) => {
    e.preventDefault();
    onPointerMove(e);
  };

  const onPointerUp = () => {
    if (!isDraggingText) return;
    isDraggingText = false;
    dragBox.classList.remove('dragging');
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('touchend', onPointerUp);
  };

  dragBox.onpointerdown = onPointerDown;
  dragBox.ontouchstart = onPointerDown;

  // Allow clicking anywhere on preview wrap in Custom Text tab to move text
  if (previewWrap) {
    previewWrap.onclick = (e) => {
      const isTextTabActive = $('#collage-subtab-text')?.classList.contains('active');
      if (!isTextTabActive) return;
      if (e.target.closest('#collage-text-drag-box')) return;
      if (e.target.closest('.collage-slot-overlay')) return;

      const rect = canvasEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      if (clickX >= 0 && clickX <= rect.width && clickY >= 0 && clickY <= rect.height) {
        state.collage.text.xPercent = Math.max(0.05, Math.min(0.95, clickX / rect.width));
        state.collage.text.yPercent = Math.max(0.05, Math.min(0.95, clickY / rect.height));
        updateTextOverlayPosition();
        drawCollagePreview();
      }
    };
  }
}

/** Wires event listeners for all Custom Text controls. */
function setupCollageTextControls() {
  $('#collage-subtab-photos')?.addEventListener('click', () => switchCollageSubtab('photos'));
  $('#collage-subtab-text')?.addEventListener('click', () => switchCollageSubtab('text'));

  // Text input
  $('#collage-text-input')?.addEventListener('input', (e) => {
    if (!state.collage.text) return;
    state.collage.text.content = e.target.value;
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Font family
  $('#collage-font-select')?.addEventListener('change', (e) => {
    if (!state.collage.text) return;
    state.collage.text.fontFamily = e.target.value;
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Font motion / animated style effect
  $('#collage-text-effect')?.addEventListener('change', (e) => {
    if (!state.collage.text) return;
    state.collage.text.fontEffect = e.target.value;
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Font size slider
  $('#collage-font-size')?.addEventListener('input', (e) => {
    if (!state.collage.text) return;
    state.collage.text.fontSize = Number(e.target.value);
    const sizeVal = $('#collage-font-size-val');
    if (sizeVal) sizeVal.textContent = `${e.target.value}px`;
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Text color presets
  document.querySelectorAll('.text-color-presets .color-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.collage.text) return;
      document.querySelectorAll('.text-color-presets .color-preset').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.collage.text.color = btn.dataset.color;
      const picker = $('#collage-color-picker');
      if (picker) picker.value = btn.dataset.color;
      updateTextOverlayPosition();
      drawCollagePreview();
    });
  });

  // Text custom color picker
  $('#collage-color-picker')?.addEventListener('input', (e) => {
    if (!state.collage.text) return;
    state.collage.text.color = e.target.value;
    document.querySelectorAll('.text-color-presets .color-preset').forEach((b) => b.classList.remove('active'));
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Style Mode buttons (Border vs Fill vs None)
  document.querySelectorAll('.style-mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.collage.text) return;
      state.collage.text.boxMode = btn.dataset.mode;
      syncCollageTextUI();
      drawCollagePreview();
    });
  });

  // Border Color Presets
  document.querySelectorAll('.border-color-presets .border-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.collage.text || state.collage.text.boxMode !== 'border') return;
      document.querySelectorAll('.border-color-presets .border-preset').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.collage.text.borderColor = btn.dataset.color;
      const picker = $('#collage-border-color-picker');
      if (picker) picker.value = btn.dataset.color;
      updateTextOverlayPosition();
      drawCollagePreview();
    });
  });

  // Border Color Picker
  $('#collage-border-color-picker')?.addEventListener('input', (e) => {
    if (!state.collage.text || state.collage.text.boxMode !== 'border') return;
    state.collage.text.borderColor = e.target.value;
    document.querySelectorAll('.border-color-presets .border-preset').forEach((b) => b.classList.remove('active'));
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Border Width Slider
  $('#collage-border-width')?.addEventListener('input', (e) => {
    if (!state.collage.text || state.collage.text.boxMode !== 'border') return;
    const val = Number(e.target.value);
    state.collage.text.borderWidth = val;
    const label = $('#collage-border-width-val');
    if (label) label.textContent = `${val}px`;
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Border Variations (Sharp, Curved, Wavy, Neon-Animated)
  document.querySelectorAll('.variation-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.collage.text || state.collage.text.boxMode !== 'border') return;
      document.querySelectorAll('.variation-chip').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.collage.text.borderStyle = btn.dataset.style;
      updateTextOverlayPosition();
      drawCollagePreview();
    });
  });

  // Fill Color Presets
  document.querySelectorAll('.fill-color-presets .fill-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!state.collage.text || state.collage.text.boxMode !== 'fill') return;
      document.querySelectorAll('.fill-color-presets .fill-preset').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.collage.text.fillColor = btn.dataset.color;
      const picker = $('#collage-fill-color-picker');
      if (picker) picker.value = btn.dataset.color;
      updateTextOverlayPosition();
      drawCollagePreview();
    });
  });

  // Fill Color Picker
  $('#collage-fill-color-picker')?.addEventListener('input', (e) => {
    if (!state.collage.text || state.collage.text.boxMode !== 'fill') return;
    state.collage.text.fillColor = e.target.value;
    document.querySelectorAll('.fill-color-presets .fill-preset').forEach((b) => b.classList.remove('active'));
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Bold toggle
  $('#collage-bold-toggle')?.addEventListener('click', (e) => {
    if (!state.collage.text) return;
    state.collage.text.bold = !state.collage.text.bold;
    e.currentTarget.classList.toggle('active', state.collage.text.bold);
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Shadow toggle
  $('#collage-shadow-toggle')?.addEventListener('click', (e) => {
    if (!state.collage.text) return;
    state.collage.text.shadow = !state.collage.text.shadow;
    e.currentTarget.classList.toggle('active', state.collage.text.shadow);
    updateTextOverlayPosition();
    drawCollagePreview();
  });

  // Clear text button
  $('#collage-clear-text')?.addEventListener('click', () => {
    if (!state.collage.text) return;
    state.collage.text.content = '';
    const input = $('#collage-text-input');
    if (input) {
      input.value = '';
      input.focus();
    }
    updateTextOverlayPosition();
    drawCollagePreview();
  });
}

/* ── Bootstrap ──────────────────────────────── */
init().catch((error) => {
  console.error('FrameImage init failed:', error);
  const status = $('#processing-status');
  if (status) status.textContent = 'Could not load frame designs — please refresh.';
});
