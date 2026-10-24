<?php
/**
 * FrameImage — Production Frame Deletion Endpoint
 * Authenticated removal of custom frames from disk and frames.json.
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
    sendJsonResponse(['success' => false, 'error' => 'Method not allowed.'], 405);
}

// ── Authentication Check ───────────────────────
$authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
$token = '';
if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
    $token = trim($matches[1]);
}

if (!SessionManager::validateToken($token)) {
    sendJsonResponse(['success' => false, 'error' => 'Unauthorized.'], 401);
}

$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
if (!is_array($data)) {
    $data = $_POST;
}

$frameId = trim((string)($data['id'] ?? ''));
if ($frameId === '') {
    sendJsonResponse(['success' => false, 'error' => 'Frame ID is required.'], 400);
}

$framesFile = PATH_FRAMES_JSON;
$lockFile = $framesFile . '.lock';
$lockFp = fopen($lockFile, 'c+');

if (!$lockFp || !flock($lockFp, LOCK_EX)) {
    sendJsonResponse(['success' => false, 'error' => 'Server is busy. Please retry.'], 503);
}

try {
    $json = file_get_contents($framesFile);
    $frames = json_decode((string)$json, true);
    if (!is_array($frames)) {
        sendJsonResponse(['success' => false, 'error' => 'Corrupted frames.json'], 500);
    }

    $foundIndex = -1;
    $targetFrame = null;
    foreach ($frames as $i => $f) {
        if (($f['id'] ?? '') === $frameId) {
            $foundIndex = $i;
            $targetFrame = $f;
            break;
        }
    }

    if ($foundIndex === -1) {
        sendJsonResponse(['success' => false, 'error' => 'Frame not found.'], 404);
    }

    // Optional: remove files from disk if custom
    if (!empty($targetFrame['overlay'])) {
        $overlayPath = __DIR__ . '/../' . ltrim($targetFrame['overlay'], '/');
        if (file_exists($overlayPath)) {
            @unlink($overlayPath);
        }
    }
    if (!empty($targetFrame['thumbnail'])) {
        $thumbPath = __DIR__ . '/../' . ltrim($targetFrame['thumbnail'], '/');
        if (file_exists($thumbPath)) {
            @unlink($thumbPath);
        }
    }

    // Remove from array
    array_splice($frames, $foundIndex, 1);

    // Save atomically
    @copy($framesFile, $framesFile . '.bak');
    $tempFile = $framesFile . '.tmp.' . bin2hex(random_bytes(6));
    file_put_contents($tempFile, json_encode($frames, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    rename($tempFile, $framesFile);

} finally {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    @unlink($lockFile);
}

sendJsonResponse(['success' => true, 'id' => $frameId, 'message' => 'Frame deleted successfully.']);
