<?php
/**
 * FrameImage — Production Secure Frame Upload Endpoint
 * Strict magic-byte validation, WebP thumbnail synthesis, and atomic frames.json updating.
 */

declare(strict_types=1);

define('FRAMEIMAGE_API', true);
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/auth.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    sendJsonResponse(['success' => false, 'error' => 'Method not allowed. Use POST.'], 405);
}

// ── 1. Authentication Verification ─────────────
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$token = '';
if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
    $token = trim($matches[1]);
}

if (!SessionManager::validateToken($token)) {
    sendJsonResponse([
        'success' => false,
        'error' => 'Unauthorized. Please log in with valid admin credentials.'
    ], 401);
}

// ── 2. Validate Uploaded File ──────────────────
if (!isset($_FILES['overlay']) || !is_array($_FILES['overlay'])) {
    sendJsonResponse(['success' => false, 'error' => 'No frame overlay file uploaded.'], 400);
}

$file = $_FILES['overlay'];
if ($file['error'] !== UPLOAD_ERR_OK) {
    $errorMsg = match ($file['error']) {
        UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'File exceeds maximum upload size (15MB).',
        UPLOAD_ERR_PARTIAL => 'File was only partially uploaded.',
        UPLOAD_ERR_NO_FILE => 'No file was uploaded.',
        default => 'Server upload error code: ' . $file['error']
    };
    sendJsonResponse(['success' => false, 'error' => $errorMsg], 400);
}

if ($file['size'] > MAX_UPLOAD_SIZE) {
    sendJsonResponse(['success' => false, 'error' => 'File size exceeds maximum allowed 15MB.'], 400);
}

// Strict MIME type verification via finfo
$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = $finfo->file($file['tmp_name']);
if ($mimeType !== 'image/png') {
    sendJsonResponse(['success' => false, 'error' => 'Invalid file format. Only transparent PNG images are supported.'], 400);
}

// Magic bytes verification (\x89PNG\r\n\x1a\n)
$handle = fopen($file['tmp_name'], 'rb');
$headerBytes = fread($handle, 8);
fclose($handle);
$pngMagicBytes = "\x89PNG\r\n\x1a\n";
if ($headerBytes !== $pngMagicBytes) {
    sendJsonResponse(['success' => false, 'error' => 'File signature verification failed: corrupted PNG.'], 400);
}

// Image geometry verification
$imageInfo = @getimagesize($file['tmp_name']);
if (!$imageInfo || $imageInfo[0] <= 0 || $imageInfo[1] <= 0) {
    sendJsonResponse(['success' => false, 'error' => 'Unable to read valid image dimensions.'], 400);
}

$width = (int)$imageInfo[0];
$height = (int)$imageInfo[1];

// ── 3. Parse Metadata ──────────────────────────
$frameName = trim((string)($_POST['name'] ?? ''));
if ($frameName === '') {
    $frameName = pathinfo((string)$file['name'], PATHINFO_FILENAME);
}
// Clean frame name
$frameName = strip_tags($frameName);

// Clean slug
$slug = preg_replace('/[^a-z0-9]+/', '-', strtolower($frameName));
$slug = trim((string)$slug, '-');
if ($slug === '') {
    $slug = 'frame-' . time();
}

$isCollage = filter_var($_POST['collage'] ?? false, FILTER_VALIDATE_BOOLEAN);

// Parse slot or slots
$slotJson = $_POST['slot'] ?? null;
$slot = null;
if ($slotJson) {
    $decodedSlot = json_decode((string)$slotJson, true);
    if (is_array($decodedSlot)) {
        $slot = $decodedSlot;
    }
}
if (!$slot) {
    $slot = [
        'x' => 0,
        'y' => 0,
        'width' => $width,
        'height' => $height,
        'radius' => 0
    ];
}

// Parse palette
$paletteJson = $_POST['palette'] ?? null;
$palette = null;
if ($paletteJson) {
    $decodedPalette = json_decode((string)$paletteJson, true);
    if (is_array($decodedPalette)) {
        $palette = $decodedPalette;
    }
}
if (!$palette) {
    $palette = [
        'background' => '#0d0f0b',
        'ink' => '#e8e6df',
        'accent' => '#c8f04c'
    ];
}

// ── 4. Destination File Paths ──────────────────
$targetDir = PATH_ASSETS_FRAMES;
if (!is_dir($targetDir)) {
    @mkdir($targetDir, 0755, true);
}

// Ensure unique slug
$overlayFilename = $slug . '-overlay.png';
$thumbFilename = $slug . '-thumb.webp';
$counter = 1;
while (file_exists($targetDir . '/' . $overlayFilename)) {
    $overlayFilename = $slug . '-' . $counter . '-overlay.png';
    $thumbFilename = $slug . '-' . $counter . '-thumb.webp';
    $counter++;
}
$finalSlug = str_replace('-overlay.png', '', $overlayFilename);

$targetOverlayPath = $targetDir . '/' . $overlayFilename;
$targetThumbPath = $targetDir . '/' . $thumbFilename;

// Move uploaded file with 100% authenticity preservation
if (!move_uploaded_file($file['tmp_name'], $targetOverlayPath)) {
    sendJsonResponse(['success' => false, 'error' => 'Failed to save overlay to server filesystem.'], 500);
}
@chmod($targetOverlayPath, 0644);

// ── 5. Generate Low-RAM 150px WebP Thumbnail ───
$hasThumbnail = false;
// Check if client uploaded a pre-generated thumbnail
if (isset($_FILES['thumbnail']) && $_FILES['thumbnail']['error'] === UPLOAD_ERR_OK) {
    if (move_uploaded_file($_FILES['thumbnail']['tmp_name'], $targetThumbPath)) {
        @chmod($targetThumbPath, 0644);
        $hasThumbnail = true;
    }
}

// Server-side synthesis fallback via GD if thumbnail is not yet created
if (!$hasThumbnail && extension_loaded('gd')) {
    $srcImg = @imagecreatefrompng($targetOverlayPath);
    if ($srcImg) {
        imagealphablending($srcImg, false);
        imagesavealpha($srcImg, true);

        // Calculate aspect ratio scale to max 150px
        $maxDim = 150;
        $scale = min($maxDim / $width, $maxDim / $height, 1.0);
        $thumbW = max(1, (int)round($width * $scale));
        $thumbH = max(1, (int)round($height * $scale));

        $thumbImg = imagecreatetruecolor($thumbW, $thumbH);
        imagealphablending($thumbImg, false);
        imagesavealpha($thumbImg, true);

        // Fill transparent background
        $transparent = imagecolorallocatealpha($thumbImg, 0, 0, 0, 127);
        imagefilledrectangle($thumbImg, 0, 0, $thumbW, $thumbH, $transparent);

        imagecopyresampled($thumbImg, $srcImg, 0, 0, 0, 0, $thumbW, $thumbH, $width, $height);

        if (function_exists('imagewebp')) {
            imagewebp($thumbImg, $targetThumbPath, 80);
            @chmod($targetThumbPath, 0644);
            $hasThumbnail = true;
        }
        imagedestroy($thumbImg);
        imagedestroy($srcImg);
    }
}

// ── 6. Atomically Update frames.json ───────────
$framesFile = PATH_FRAMES_JSON;
$lockFile = $framesFile . '.lock';
$lockFp = fopen($lockFile, 'c+');

if (!$lockFp || !flock($lockFp, LOCK_EX)) {
    sendJsonResponse(['success' => false, 'error' => 'Server is busy updating frames. Please retry.'], 503);
}

try {
    $jsonContent = file_get_contents($framesFile);
    $frames = json_decode((string)$jsonContent, true);
    if (!is_array($frames)) {
        $frames = [];
    }

    // Build new frame definition
    $newFrame = [
        'id' => $finalSlug,
        'name' => $frameName,
        'overlay' => 'assets/frames/' . $overlayFilename,
        'canvas' => [
            'width' => $width,
            'height' => $height
        ],
        'slot' => $slot,
        'palette' => $palette
    ];

    if ($hasThumbnail) {
        $newFrame['thumbnail'] = 'assets/frames/' . $thumbFilename;
    }

    if ($isCollage) {
        $newFrame['collage'] = true;
        if (isset($_POST['slots'])) {
            $slotsDecoded = json_decode((string)$_POST['slots'], true);
            if (is_array($slotsDecoded)) {
                $newFrame['slots'] = $slotsDecoded;
            }
        }
    }

    // Create automatic backup before writing
    @copy($framesFile, $framesFile . '.bak');

    // Insert before collage frames if it is a single frame
    if (!$isCollage) {
        $firstCollageIndex = -1;
        foreach ($frames as $idx => $f) {
            if (!empty($f['collage'])) {
                $firstCollageIndex = $idx;
                break;
            }
        }
        if ($firstCollageIndex !== -1) {
            array_splice($frames, $firstCollageIndex, 0, [$newFrame]);
        } else {
            $frames[] = $newFrame;
        }
    } else {
        $frames[] = $newFrame;
    }

    // Write atomically via temporary file
    $tempFile = $framesFile . '.tmp.' . bin2hex(random_bytes(6));
    $encoded = json_encode($frames, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($tempFile, $encoded) === false) {
        throw new RuntimeException('Failed to write temporary frames file');
    }
    if (!rename($tempFile, $framesFile)) {
        throw new RuntimeException('Failed to replace frames.json');
    }

} finally {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    @unlink($lockFile);
}

sendJsonResponse([
    'success' => true,
    'message' => 'Frame successfully uploaded and published live.',
    'frame' => $newFrame
]);
