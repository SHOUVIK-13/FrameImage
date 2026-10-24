<?php
/**
 * FrameImage — Authentication & Rate Limiting Engine
 * Handles admin login, HMAC verification, session token issuance, and brute-force mitigation.
 */

declare(strict_types=1);

define('FRAMEIMAGE_API', true);
require_once __DIR__ . '/config.php';

// Allow CORS for local development / same origin
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

/**
 * Manage IP-based rate limiting
 */
class RateLimiter {
    private static string $file = PATH_STORAGE . '/rate_limits.json';

    public static function checkLoginLimit(string $ip): bool {
        $data = self::read();
        $now = time();
        if (isset($data[$ip])) {
            $record = $data[$ip];
            if ($record['locked_until'] > $now) {
                return false; // Currently locked out
            }
            // Reset if lockout period has passed
            if ($record['first_attempt'] < ($now - RATE_LIMIT_LOGIN_LOCKOUT)) {
                unset($data[$ip]);
                self::write($data);
            }
        }
        return true;
    }

    public static function recordFailedLogin(string $ip): int {
        $data = self::read();
        $now = time();
        if (!isset($data[$ip]) || $data[$ip]['first_attempt'] < ($now - RATE_LIMIT_LOGIN_LOCKOUT)) {
            $data[$ip] = [
                'attempts' => 1,
                'first_attempt' => $now,
                'locked_until' => 0
            ];
        } else {
            $data[$ip]['attempts']++;
            if ($data[$ip]['attempts'] >= RATE_LIMIT_LOGIN_MAX_ATTEMPTS) {
                $data[$ip]['locked_until'] = $now + RATE_LIMIT_LOGIN_LOCKOUT;
            }
        }
        self::write($data);
        return $data[$ip]['attempts'];
    }

    public static function resetLoginLimit(string $ip): void {
        $data = self::read();
        if (isset($data[$ip])) {
            unset($data[$ip]);
            self::write($data);
        }
    }

    private static function read(): array {
        if (!file_exists(self::$file)) return [];
        $fp = @fopen(self::$file, 'r');
        if (!$fp) return [];
        flock($fp, LOCK_SH);
        $content = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        $json = json_decode((string)$content, true);
        return is_array($json) ? $json : [];
    }

    private static function write(array $data): void {
        $fp = @fopen(self::$file, 'c+');
        if (!$fp) return;
        flock($fp, LOCK_EX);
        ftruncate($fp, 0);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT));
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

/**
 * Manage authenticated bearer sessions
 */
class SessionManager {
    private static string $file = PATH_STORAGE . '/sessions.json';

    public static function createToken(string $user): string {
        $token = bin2hex(random_bytes(32));
        $now = time();

        // Enforce strictly one active login at a time
        $sessions = [];
        $sessions[$token] = [
            'user' => $user,
            'created_at' => $now,
            'expires_at' => $now + SESSION_LIFESPAN
        ];
        self::write($sessions);
        return $token;
    }

    public static function validateToken(?string $token): bool {
        if (!$token || strlen($token) !== 64) return false;
        $sessions = self::read();
        $now = time();
        if (isset($sessions[$token]) && $sessions[$token]['expires_at'] > $now) {
            return true;
        }
        return false;
    }

    public static function revokeToken(string $token): void {
        $sessions = self::read();
        if (isset($sessions[$token])) {
            unset($sessions[$token]);
            self::write($sessions);
        }
    }

    private static function read(): array {
        if (!file_exists(self::$file)) return [];
        $fp = @fopen(self::$file, 'r');
        if (!$fp) return [];
        flock($fp, LOCK_SH);
        $content = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        $json = json_decode((string)$content, true);
        return is_array($json) ? $json : [];
    }

    private static function write(array $data): void {
        $fp = @fopen(self::$file, 'c+');
        if (!$fp) return;
        flock($fp, LOCK_EX);
        ftruncate($fp, 0);
        fwrite($fp, json_encode($data, JSON_PRETTY_PRINT));
        flock($fp, LOCK_UN);
        fclose($fp);
    }
}

// ── Request Router ─────────────────────────────
$action = $_GET['action'] ?? ($_POST['action'] ?? '');
$ip = getClientIp();

// Verify current session
if ($action === 'verify') {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = '';
    if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
        $token = trim($matches[1]);
    }
    if (SessionManager::validateToken($token)) {
        sendJsonResponse([
            'authenticated' => true,
            'valid' => true,
            'user' => ADMIN_USERNAME
        ]);
    } else {
        sendJsonResponse(['authenticated' => false, 'error' => 'Invalid or expired session'], 401);
    }
}

// Handle Logout
if ($action === 'logout') {
    $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
    $token = '';
    if (preg_match('/Bearer\s+(.+)$/i', $authHeader, $matches)) {
        $token = trim($matches[1]);
    }
    if ($token !== '') {
        SessionManager::revokeToken($token);
    }
    sendJsonResponse(['success' => true, 'message' => 'Logged out successfully']);
}

// Handle Login
if ($action === 'login' || $_SERVER['REQUEST_METHOD'] === 'POST') {
    // Check rate limit lockout first
    if (!RateLimiter::checkLoginLimit($ip)) {
        sendJsonResponse([
            'success' => false,
            'error' => 'Too many failed login attempts. Account temporarily locked for 15 minutes.'
        ], 429);
    }

    // Read payload
    $rawInput = file_get_contents('php://input');
    $payload = json_decode($rawInput, true);
    if (!is_array($payload)) {
        $payload = $_POST;
    }

    $username = trim((string)($payload['username'] ?? ''));
    $password = (string)($payload['password'] ?? '');

    if ($username === '' || $password === '') {
        sendJsonResponse(['success' => false, 'error' => 'Username and password are required'], 400);
    }

    // Verify username
    if ($username !== ADMIN_USERNAME) {
        $attempts = RateLimiter::recordFailedLogin($ip);
        sendJsonResponse([
            'success' => false,
            'error' => 'Invalid credentials.',
            'remainingAttempts' => max(0, RATE_LIMIT_LOGIN_MAX_ATTEMPTS - $attempts)
        ], 401);
    }

    // Verify password via HMAC-SHA256
    $computedHash = hash_hmac('sha256', $password, AUTH_SALT);
    $valid = hash_equals(ADMIN_PASSWORD_HASH, $computedHash);

    if (!$valid) {
        $attempts = RateLimiter::recordFailedLogin($ip);
        sendJsonResponse([
            'success' => false,
            'error' => 'Invalid credentials.',
            'remainingAttempts' => max(0, RATE_LIMIT_LOGIN_MAX_ATTEMPTS - $attempts)
        ], 401);
    }

    // Login successful
    RateLimiter::resetLoginLimit($ip);
    $token = SessionManager::createToken(ADMIN_USERNAME);

    sendJsonResponse([
        'success' => true,
        'token' => $token,
        'user' => ADMIN_USERNAME,
        'expiresIn' => SESSION_LIFESPAN
    ]);
}

// Default fallback
sendJsonResponse(['error' => 'Invalid action'], 400);
