<?php
/**
 * FrameImage — Production Security & API Configuration
 * Enterprise-grade settings for authentication, rate limiting, and asset storage.
 */

declare(strict_types=1);

// Prevent direct execution outside API
if (!defined('FRAMEIMAGE_API')) {
    define('FRAMEIMAGE_API', true);
}

// ── Security & Credentials ─────────────────────
// Admin username
define('ADMIN_USERNAME', 'tech.admin.');

// Secure server salt for password and token HMAC
define('AUTH_SALT', 'Angikar_FrameImage_SecureSalt_2026!#*');

// Password hash for 'Tech.Angikar@2019' using HMAC-SHA256 with AUTH_SALT
// Hash: f2b4b141a0b5dbd2f2b1d40ddf5b5b08754352f7e254bec9cd994522b6e15165
define('ADMIN_PASSWORD_HASH', 'f2b4b141a0b5dbd2f2b1d40ddf5b5b08754352f7e254bec9cd994522b6e15165');

// Session token lifespan (4 hours in seconds)
define('SESSION_LIFESPAN', 14400);

// ── Rate Limiting ──────────────────────────────
// Maximum failed login attempts allowed before lockout
define('RATE_LIMIT_LOGIN_MAX_ATTEMPTS', 5);

// Lockout duration in seconds (15 minutes)
define('RATE_LIMIT_LOGIN_LOCKOUT', 900);

// Maximum frame uploads allowed per hour
define('RATE_LIMIT_UPLOAD_MAX_HOURLY', 30);

// ── Storage Paths ──────────────────────────────
define('PATH_ASSETS_FRAMES', realpath(__DIR__ . '/../assets/frames') ?: (__DIR__ . '/../assets/frames'));
define('PATH_FRAMES_JSON', realpath(__DIR__ . '/../frames.json') ?: (__DIR__ . '/../frames.json'));
define('PATH_STORAGE', __DIR__ . '/.storage');

// Max upload file size in bytes (15 MB)
define('MAX_UPLOAD_SIZE', 15 * 1024 * 1024);

// Ensure storage directory exists and is protected
if (!is_dir(PATH_STORAGE)) {
    @mkdir(PATH_STORAGE, 0750, true);
}

/**
 * Get real client IP address considering reverse proxies / Cloudflare
 */
function getClientIp(): string {
    $headers = [
        'HTTP_CF_CONNECTING_IP',
        'HTTP_X_REAL_IP',
        'HTTP_X_FORWARDED_FOR',
        'REMOTE_ADDR'
    ];
    foreach ($headers as $header) {
        if (!empty($_SERVER[$header])) {
            $ipList = explode(',', (string)$_SERVER[$header]);
            $ip = trim($ipList[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
    }
    return '127.0.0.1';
}

/**
 * Send a clean JSON response and terminate
 */
function sendJsonResponse(array $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}
