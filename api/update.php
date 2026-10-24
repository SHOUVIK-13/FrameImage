<?php
/**
 * FrameImage — Production Frame Update / Rename Endpoint
 * Authenticated modification of frame metadata (name, palette, etc.) in frames.json.
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
    sendJsonResponse(['success' => false, 'error' => 'Unauthorized admin token.'], 401);
}

$rawInput = file_get_contents('php://input');
$data = json_decode($rawInput, true);
if (!is_array($data)) {
    $data = $_POST;
}

$frameId = trim((string)($data['id'] ?? ''));
$newName = trim((string)($data['name'] ?? ''));

if ($frameId === '' || $newName === '') {
    sendJsonResponse(['success' => false, 'error' => 'Frame ID and new name are required.'], 400);
}

// Clean name
$newName = strip_tags($newName);

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

    // Check duplicate name on other frames
    $nameLower = strtolower($newName);
    foreach ($frames as $f) {
        if (($f['id'] ?? '') !== $frameId && strtolower(trim((string)($f['name'] ?? ''))) === $nameLower) {
            sendJsonResponse([
                'success' => false,
                'error' => "A frame named \"{$f['name']}\" already exists. Please choose a unique name."
            ], 409);
        }
    }

    $foundIndex = -1;
    foreach ($frames as $i => $f) {
        if (($f['id'] ?? '') === $frameId) {
            $foundIndex = $i;
            break;
        }
    }

    if ($foundIndex === -1) {
        sendJsonResponse(['success' => false, 'error' => 'Frame not found.'], 404);
    }

    // Update name
    $frames[$foundIndex]['name'] = $newName;

    // Optional palette update if provided
    if (!empty($data['palette']) && is_array($data['palette'])) {
        $frames[$foundIndex]['palette'] = $data['palette'];
    }

    // Atomic write
    @copy($framesFile, $framesFile . '.bak');
    $tempFile = $framesFile . '.tmp.' . bin2hex(random_bytes(6));
    file_put_contents($tempFile, json_encode($frames, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    rename($tempFile, $framesFile);

    $updatedFrame = $frames[$foundIndex];

} finally {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
    @unlink($lockFile);
}

sendJsonResponse([
    'success' => true,
    'message' => 'Frame updated successfully.',
    'frame' => $updatedFrame
]);
