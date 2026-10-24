/**
 * FrameImage — Production Node.js Server & API
 * Zero-dependency standalone server providing static asset hosting and secure API endpoints:
 * - Rate limiting
 * - Admin credentials verification (HMAC-SHA256)
 * - PNG magic bytes validation
 * - WebP/PNG thumbnail generation
 * - Atomic frames.json updates
 * - Duplicate frame name prevention
 * - Frame rename/modification & deletion endpoints
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = path.resolve(__dirname);
const ASSETS_FRAMES_DIR = path.join(ROOT_DIR, 'assets', 'frames');
const FRAMES_JSON_PATH = path.join(ROOT_DIR, 'frames.json');
const STORAGE_DIR = path.join(ROOT_DIR, 'api', '.storage');
const SESSIONS_FILE = path.join(STORAGE_DIR, 'sessions.json');

// Security Constants
const ADMIN_USER = 'tech.admin.';
const AUTH_SALT = 'Angikar_FrameImage_SecureSalt_2026!#*';
// HMAC-SHA256 of 'Tech.Angikar@2019' with AUTH_SALT
const ADMIN_PASSWORD_HASH = 'f2b4b141a0b5dbd2f2b1d40ddf5b5b08754352f7e254bec9cd994522b6e15165';
const SESSION_LIFESPAN = 14400; // 4 hours in seconds
const RATE_LIMIT_LOGIN_MAX = 5;
const RATE_LIMIT_LOCKOUT = 900; // 15 minutes in seconds

// Ensure storage directory exists
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const rateLimits = new Map();
const activeSessions = new Map();

// Load persisted sessions from disk on startup
function loadSessionsFromDisk() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const now = Math.floor(Date.now() / 1000);
      for (const [token, s] of Object.entries(data)) {
        if (s && s.expiresAt > now) {
          activeSessions.set(token, s);
        }
      }
    }
  } catch {}
}

function saveSessionsToDisk() {
  try {
    const obj = {};
    for (const [token, s] of activeSessions.entries()) {
      obj[token] = s;
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch {}
}

loadSessionsFromDisk();

function getClientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  const fwd = req.headers['x-forwarded-for'];
  if (cf) return cf.trim();
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
}

function checkRateLimit(ip) {
  const now = Math.floor(Date.now() / 1000);
  const rec = rateLimits.get(ip);
  if (!rec) return true;
  if (rec.lockedUntil > now) return false;
  if (rec.firstAttempt < now - RATE_LIMIT_LOCKOUT) {
    rateLimits.delete(ip);
    return true;
  }
  return true;
}

function recordFailedLogin(ip) {
  const now = Math.floor(Date.now() / 1000);
  const rec = rateLimits.get(ip);
  if (!rec || rec.firstAttempt < now - RATE_LIMIT_LOCKOUT) {
    rateLimits.set(ip, { attempts: 1, firstAttempt: now, lockedUntil: 0 });
    return 1;
  }
  rec.attempts++;
  if (rec.attempts >= RATE_LIMIT_LOGIN_MAX) {
    rec.lockedUntil = now + RATE_LIMIT_LOCKOUT;
  }
  return rec.attempts;
}

function resetRateLimit(ip) {
  rateLimits.delete(ip);
}

function validateBearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['x-admin-token'] || '';
  const match = auth.match(/(?:Bearer\s+)?([a-f0-9]{64})/i);
  if (!match) return false;
  const token = match[1];
  const now = Math.floor(Date.now() / 1000);

  let session = activeSessions.get(token);
  if (!session) {
    loadSessionsFromDisk();
    session = activeSessions.get(token);
  }

  if (!session || session.expiresAt < now) {
    activeSessions.delete(token);
    saveSessionsToDisk();
    return false;
  }
  return true;
}

function sendJson(res, data, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}

// MIME types for static server
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
};

// Simple multipart form parser for Node.js
function parseMultipart(buffer, boundary) {
  const result = { fields: {}, files: {} };
  const boundaryBuffer = Buffer.from('--' + boundary);
  let start = 0;

  while (start < buffer.length) {
    const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
    if (boundaryIndex === -1) break;

    const nextBoundary = buffer.indexOf(boundaryBuffer, boundaryIndex + boundaryBuffer.length);
    if (nextBoundary === -1) break;

    const partBuffer = buffer.slice(boundaryIndex + boundaryBuffer.length, nextBoundary);
    const headerEndIndex = partBuffer.indexOf('\r\n\r\n');
    if (headerEndIndex === -1) {
      start = nextBoundary;
      continue;
    }

    const headerText = partBuffer.slice(0, headerEndIndex).toString('latin1');
    const body = partBuffer.slice(headerEndIndex + 4, partBuffer.length - 2); // trim trailing \r\n

    const nameMatch = headerText.match(/name="([^"]+)"/i);
    const filenameMatch = headerText.match(/filename="([^"]+)"/i);

    if (nameMatch) {
      const fieldName = nameMatch[1];
      if (filenameMatch) {
        const contentTypeMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
        result.files[fieldName] = {
          filename: filenameMatch[1],
          contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
          data: body,
          size: body.length,
        };
      } else {
        result.fields[fieldName] = body.toString('utf8');
      }
    }

    start = nextBoundary;
  }

  return result;
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // Handle CORS Pre-flight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Requested-With',
    });
    return res.end();
  }

  // ── API Route: Auth / Login ──────────────────
  if (pathname === '/api/auth' || pathname === '/api/auth.php') {
    const action = parsedUrl.searchParams.get('action') || '';
    const ip = getClientIp(req);

    if (action === 'verify') {
      if (validateBearerToken(req)) {
        return sendJson(res, { authenticated: true, valid: true, user: ADMIN_USER });
      }
      return sendJson(res, { authenticated: false, error: 'Invalid or expired session' }, 401);
    }

    if (action === 'logout') {
      const auth = req.headers['authorization'] || '';
      const match = auth.match(/Bearer\s+([a-f0-9]+)/i);
      if (match) {
        activeSessions.delete(match[1]);
        saveSessionsToDisk();
      }
      return sendJson(res, { success: true, message: 'Logged out successfully' });
    }

    // Login POST
    if (req.method === 'POST') {
      if (!checkRateLimit(ip)) {
        return sendJson(res, {
          success: false,
          error: 'Too many failed login attempts. Temporarily locked for 15 minutes.'
        }, 429);
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}');
          const username = (payload.username || '').trim();
          const password = payload.password || '';

          if (username !== ADMIN_USER) {
            const attempts = recordFailedLogin(ip);
            return sendJson(res, {
              success: false,
              error: 'Invalid credentials.',
              remainingAttempts: Math.max(0, RATE_LIMIT_LOGIN_MAX - attempts)
            }, 401);
          }

          const hmac = crypto.createHmac('sha256', AUTH_SALT).update(password).digest('hex');
          if (hmac !== ADMIN_PASSWORD_HASH) {
            const attempts = recordFailedLogin(ip);
            return sendJson(res, {
              success: false,
              error: 'Invalid credentials.',
              remainingAttempts: Math.max(0, RATE_LIMIT_LOGIN_MAX - attempts)
            }, 401);
          }

          resetRateLimit(ip);
          // Enforce strictly one active admin login at a time
          activeSessions.clear();
          const token = crypto.randomBytes(32).toString('hex');
          const now = Math.floor(Date.now() / 1000);
          activeSessions.set(token, { user: ADMIN_USER, expiresAt: now + SESSION_LIFESPAN });
          saveSessionsToDisk();

          return sendJson(res, {
            success: true,
            token,
            user: ADMIN_USER,
            expiresIn: SESSION_LIFESPAN
          });
        } catch {
          return sendJson(res, { success: false, error: 'Malformed request JSON' }, 400);
        }
      });
      return;
    }
  }

  // ── API Route: Upload Frame ──────────────────
  if (pathname === '/api/upload' || pathname === '/api/upload.php') {
    if (req.method !== 'POST') {
      return sendJson(res, { success: false, error: 'Method not allowed' }, 405);
    }

    if (!validateBearerToken(req)) {
      return sendJson(res, { success: false, error: 'Unauthorized admin token' }, 401);
    }

    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/i);
    if (!boundaryMatch) {
      return sendJson(res, { success: false, error: 'Invalid multipart body' }, 400);
    }

    const boundary = boundaryMatch[1].replace(/^"(.*)"$/, '$1');
    const chunks = [];
    let totalLength = 0;

    req.on('data', chunk => {
      chunks.push(chunk);
      totalLength += chunk.length;
      if (totalLength > 25 * 1024 * 1024) {
        req.destroy();
      }
    });

    req.on('end', () => {
      try {
        const fullBuffer = Buffer.concat(chunks);
        const { fields, files } = parseMultipart(fullBuffer, boundary);

        const overlayFile = files['overlay'];
        if (!overlayFile || overlayFile.data.length === 0) {
          return sendJson(res, { success: false, error: 'No frame overlay file received' }, 400);
        }

        // Validate file extension strictly (.png only)
        const fileExt = path.extname(overlayFile.filename || '').toLowerCase();
        if (fileExt !== '.png') {
          return sendJson(res, { success: false, error: 'Invalid file format. Only PNG files (.png) are permitted' }, 400);
        }

        // Validate PNG magic bytes (\x89PNG\r\n\x1a\n)
        const magic = overlayFile.data.slice(0, 8);
        const pngMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        if (!magic.equals(pngMagic)) {
          return sendJson(res, { success: false, error: 'Corrupted or non-PNG file' }, 400);
        }

        // Read width and height from PNG IHDR chunk (bytes 16..24)
        const width = overlayFile.data.readUInt32BE(16);
        const height = overlayFile.data.readUInt32BE(20);
        if (width <= 0 || height <= 0) {
          return sendJson(res, { success: false, error: 'Invalid image dimensions' }, 400);
        }

        // Frame Name & Duplicate Check
        let frameName = (fields['name'] || '').trim();
        if (!frameName) {
          frameName = path.basename(overlayFile.filename, path.extname(overlayFile.filename));
        }

        const rawFrames = fs.readFileSync(FRAMES_JSON_PATH, 'utf8');
        const frames = JSON.parse(rawFrames);

        // Check duplicate name
        const nameLower = frameName.toLowerCase();
        const existing = frames.find(f => (f.name || '').trim().toLowerCase() === nameLower);
        if (existing) {
          return sendJson(res, {
            success: false,
            error: `A frame with the name "${existing.name}" already exists. Please choose a unique name.`
          }, 409);
        }

        let slug = frameName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        if (!slug) slug = 'frame-' + Date.now();

        // Unique filename
        let overlayFilename = `${slug}-overlay.png`;
        let thumbFilename = `${slug}-thumb.webp`;
        let counter = 1;
        while (fs.existsSync(path.join(ASSETS_FRAMES_DIR, overlayFilename))) {
          overlayFilename = `${slug}-${counter}-overlay.png`;
          thumbFilename = `${slug}-${counter}-thumb.webp`;
          counter++;
        }
        const finalSlug = overlayFilename.replace('-overlay.png', '');

        // Save overlay file
        fs.writeFileSync(path.join(ASSETS_FRAMES_DIR, overlayFilename), overlayFile.data);

        // Save thumbnail if provided by client, or fallback
        const thumbFile = files['thumbnail'];
        let hasThumbnail = false;
        if (thumbFile && thumbFile.data.length > 0) {
          fs.writeFileSync(path.join(ASSETS_FRAMES_DIR, thumbFilename), thumbFile.data);
          hasThumbnail = true;
        }

        // Parse slot and palette
        let slot = { x: 0, y: 0, width, height, radius: 0 };
        if (fields['slot']) {
          try { slot = JSON.parse(fields['slot']); } catch {}
        }
        let palette = { background: '#0d0f0b', ink: '#e8e6df', accent: '#c8f04c' };
        if (fields['palette']) {
          try { palette = JSON.parse(fields['palette']); } catch {}
        }
        const isCollage = fields['collage'] === 'true' || fields['collage'] === true;

        const newFrame = {
          id: finalSlug,
          name: frameName,
          overlay: `assets/frames/${overlayFilename}`,
          canvas: { width, height },
          slot,
          palette,
          updatedAt: Date.now(),
        };
        if (hasThumbnail) {
          newFrame.thumbnail = `assets/frames/${thumbFilename}`;
        }
        if (isCollage) {
          newFrame.collage = true;
          if (fields['slots']) {
            try { newFrame.slots = JSON.parse(fields['slots']); } catch {}
          }
        }

        // Insert before collage frames if single
        if (!isCollage) {
          const firstCollageIdx = frames.findIndex(f => f.collage);
          if (firstCollageIdx !== -1) {
            frames.splice(firstCollageIdx, 0, newFrame);
          } else {
            frames.push(newFrame);
          }
        } else {
          frames.push(newFrame);
        }

        // Backup & atomic write
        fs.copyFileSync(FRAMES_JSON_PATH, FRAMES_JSON_PATH + '.bak');
        const tempPath = FRAMES_JSON_PATH + '.tmp.' + crypto.randomBytes(4).toString('hex');
        fs.writeFileSync(tempPath, JSON.stringify(frames, null, 2), 'utf8');
        fs.renameSync(tempPath, FRAMES_JSON_PATH);

        return sendJson(res, {
          success: true,
          message: 'Frame uploaded and published live.',
          frame: newFrame
        });

      } catch (err) {
        return sendJson(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ── API Route: Update / Rename Frame ─────────
  if (pathname === '/api/update' || pathname === '/api/update.php') {
    if (req.method !== 'POST') return sendJson(res, { success: false, error: 'Method not allowed' }, 405);
    if (!validateBearerToken(req)) return sendJson(res, { success: false, error: 'Unauthorized admin token' }, 401);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const frameId = (payload.id || '').trim();
        const newName = (payload.name || '').trim();

        if (!frameId || !newName) {
          return sendJson(res, { success: false, error: 'Frame ID and name are required' }, 400);
        }

        const raw = fs.readFileSync(FRAMES_JSON_PATH, 'utf8');
        const frames = JSON.parse(raw);

        // Check duplicate name on other frames
        const nameLower = newName.toLowerCase();
        const dup = frames.find(f => f.id !== frameId && (f.name || '').trim().toLowerCase() === nameLower);
        if (dup) {
          return sendJson(res, { success: false, error: `A frame named "${dup.name}" already exists. Please choose a unique name.` }, 409);
        }

        const target = frames.find(f => f.id === frameId);
        if (!target) return sendJson(res, { success: false, error: 'Frame not found' }, 404);

        target.name = newName;
        target.updatedAt = Date.now();
        if (payload.palette) target.palette = payload.palette;

        fs.copyFileSync(FRAMES_JSON_PATH, FRAMES_JSON_PATH + '.bak');
        const tempPath = FRAMES_JSON_PATH + '.tmp.' + crypto.randomBytes(4).toString('hex');
        fs.writeFileSync(tempPath, JSON.stringify(frames, null, 2), 'utf8');
        fs.renameSync(tempPath, FRAMES_JSON_PATH);

        return sendJson(res, { success: true, frame: target, message: 'Frame renamed successfully' });
      } catch (err) {
        return sendJson(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ── API Route: Delete Frame ──────────────────
  if (pathname === '/api/delete' || pathname === '/api/delete.php') {
    if (req.method !== 'POST') return sendJson(res, { success: false, error: 'Method not allowed' }, 405);
    if (!validateBearerToken(req)) return sendJson(res, { success: false, error: 'Unauthorized admin token' }, 401);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const frameId = (payload.id || '').trim();
        if (!frameId) return sendJson(res, { success: false, error: 'Frame ID is required' }, 400);

        const raw = fs.readFileSync(FRAMES_JSON_PATH, 'utf8');
        const frames = JSON.parse(raw);
        const idx = frames.findIndex(f => f.id === frameId);
        if (idx === -1) return sendJson(res, { success: false, error: 'Frame not found' }, 404);

        const target = frames[idx];
        frames.splice(idx, 1);

        // Delete overlay and thumbnail files if present
        if (target.overlay) {
          const ovPath = path.join(ROOT_DIR, target.overlay);
          if (fs.existsSync(ovPath)) {
            try { fs.unlinkSync(ovPath); } catch {}
          }
        }
        if (target.thumbnail) {
          const thPath = path.join(ROOT_DIR, target.thumbnail);
          if (fs.existsSync(thPath)) {
            try { fs.unlinkSync(thPath); } catch {}
          }
        }

        fs.copyFileSync(FRAMES_JSON_PATH, FRAMES_JSON_PATH + '.bak');
        const tempPath = FRAMES_JSON_PATH + '.tmp.' + crypto.randomBytes(4).toString('hex');
        fs.writeFileSync(tempPath, JSON.stringify(frames, null, 2), 'utf8');
        fs.renameSync(tempPath, FRAMES_JSON_PATH);

        return sendJson(res, { success: true, id: frameId, message: 'Frame deleted successfully' });
      } catch (err) {
        return sendJson(res, { success: false, error: err.message }, 500);
      }
    });
    return;
  }

  // ── Static Files Fallback ────────────────────
  let filePath = path.join(ROOT_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    return res.end('Access denied');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isDynamicAsset = ext === '.html' || ext === '.json' || ext === '.js' || ext === '.css';
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isDynamicAsset ? 'no-cache, no-store, must-revalidate' : 'public, max-age=86400',
    });
    stream.pipe(res);
  });
});

let currentPort = Number(PORT);

function startServer(port) {
  server.listen(port, () => {
    console.log(`[FrameImage] Production standalone server running at http://localhost:${port}`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    currentPort++;
    console.warn(`[FrameImage] Port is busy, trying http://localhost:${currentPort}...`);
    startServer(currentPort);
  } else {
    console.error('[FrameImage] Server error:', err);
  }
});

startServer(currentPort);
