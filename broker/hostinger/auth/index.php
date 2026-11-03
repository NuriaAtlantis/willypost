<?php
// WillyPost · servidor central (broker OAuth) · versión PHP para Hostinger → https://auth.willypost.com
//
// Mismo contrato que broker/worker.js (la implementación de referencia, con tests) y que CENTRAL.md:
//   GET  /config            → datos públicos (qué redes funcionan en modo central)
//   GET  /health            → { "ok": true, "networks": [...] }
//   POST /token/:family/:op → añade la clave secreta y canjea el token con la red; devuelve su JSON y su código tal cual
//
// Sin estado, sin base de datos, NUNCA registra tokens ni cuerpos. PHP 8.1+, solo extensiones curl y json.
// Las claves viven en willypost-config.php FUERA de public_html (ver config.example.php y LEEME.md).
// Si cambias algo aquí, cambia lo mismo en broker/worker.js (y al revés).

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '0'); // un aviso podría incluir una URL con el secreto: mejor no registrar nada
header_remove('X-Powered-By');

// Debe coincidir con GRAPH_VERSION de server/providers/facebook.js y de broker/worker.js.
const GRAPH_VERSION = 'v26.0';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_FIELD_BYTES = 4 * 1024;
const UPSTREAM_TIMEOUT_S = 20;
const RATE_LIMIT = 300; // llamadas a /token por IP y minuto (aproximado). Alto a propósito: tras la CDN de Hostinger muchos alumnos pueden compartir IP
const RATE_WINDOW_S = 60;

const DEFAULTS = [
    'SITE'  => 'https://willypost.com',
    'RELAY' => 'https://willypost.com/callback.html',
    'MEDIA' => 'https://media.willypost.com',
];

/* ---------------------------------------------------------------- configuración ---------------------------------------------------------------- */

/** Busca willypost-config.php fuera de public_html. Sin archivo = ninguna red configurada. */
function load_config(): array
{
    $candidates = [];
    $env = getenv('WILLYPOST_CONFIG');
    if (is_string($env) && $env !== '') $candidates[] = $env;
    $candidates[] = __DIR__ . '/../../willypost-config.php'; // domains/willypost.com/ (public_html/auth → ../..)
    $home = getenv('HOME');
    if (is_string($home) && $home !== '') $candidates[] = rtrim($home, '/') . '/willypost-config.php';
    foreach ($candidates as $file) {
        if (is_file($file) && is_readable($file)) {
            $cfg = include $file;
            return is_array($cfg) ? $cfg : [];
        }
    }
    return [];
}

function v(array $cfg, string $name): string
{
    $val = $cfg[$name] ?? '';
    return is_string($val) ? trim($val) : '';
}

function setting(array $cfg, string $name): string
{
    $val = v($cfg, $name);
    return $val !== '' ? $val : DEFAULTS[$name];
}

/* ------------------------------------------------------------------ redes ------------------------------------------------------------------ */

// Mismo orden que en worker.js.
const FAMILIES = [
    'meta'      => ['id' => 'META_APP_ID',        'secret' => 'META_APP_SECRET'],
    'instagram' => ['id' => 'IG_APP_ID',          'secret' => 'IG_APP_SECRET'],
    'threads'   => ['id' => 'THREADS_APP_ID',     'secret' => 'THREADS_APP_SECRET'],
    'tiktok'    => ['id' => 'TIKTOK_CLIENT_KEY',  'secret' => 'TIKTOK_CLIENT_SECRET'],
    'linkedin'  => ['id' => 'LINKEDIN_CLIENT_ID', 'secret' => 'LINKEDIN_CLIENT_SECRET'],
    // Cliente «App de escritorio»: Google considera público su secreto, por eso SÍ se entrega. Sin operaciones aquí.
    'google'    => ['id' => 'GOOGLE_CLIENT_ID',   'secret' => 'GOOGLE_CLIENT_SECRET'],
];

function family_public(array $cfg, string $family): array
{
    $f = FAMILIES[$family];
    $out = ['client_id' => v($cfg, $f['id'])];
    if ($family === 'meta' && v($cfg, 'META_CONFIG_ID') !== '') $out['config_id'] = v($cfg, 'META_CONFIG_ID');
    if ($family === 'google') $out['client_secret'] = v($cfg, 'GOOGLE_CLIENT_SECRET');
    return $out;
}

function configured(array $cfg, string $family): bool
{
    if (!array_key_exists($family, FAMILIES)) return false;
    $f = FAMILIES[$family];
    return v($cfg, $f['id']) !== '' && v($cfg, $f['secret']) !== '';
}

function configured_families(array $cfg): array
{
    return array_values(array_filter(array_keys(FAMILIES), fn ($f) => configured($cfg, $f)));
}

const GRAPH = 'https://graph.facebook.com/' . GRAPH_VERSION;
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
// Threads: mismo dominio que usa server/providers/threads.js (graph.threads.com; antes graph.threads.net).
const THREADS_ROOT = 'https://graph.threads.com';

// Lista CERRADA de operaciones: family => op => campos que manda la app.
const OPS = [
    'meta'      => ['code' => ['code', 'redirect_uri'], 'long_lived' => ['access_token']],
    'instagram' => ['code' => ['code', 'redirect_uri'], 'long_lived' => ['access_token']],
    'threads'   => ['code' => ['code', 'redirect_uri'], 'long_lived' => ['access_token']],
    'tiktok'    => ['code' => ['code', 'redirect_uri', 'code_verifier'], 'refresh' => ['refresh_token']],
    'linkedin'  => ['code' => ['code', 'redirect_uri']],
];

/** La llamada oficial: ['method' => 'GET'|'POST', 'url' => ..., 'form' => ?array]. */
function build_call(string $family, string $op, array $b, string $id, string $secret): array
{
    switch ("$family/$op") {
        case 'meta/code':
            return ['method' => 'GET', 'url' => GRAPH . '/oauth/access_token?' . qs([
                'client_id' => $id, 'client_secret' => $secret, 'redirect_uri' => $b['redirect_uri'], 'code' => $b['code'],
            ])];
        case 'meta/long_lived':
            return ['method' => 'GET', 'url' => GRAPH . '/oauth/access_token?' . qs([
                'grant_type' => 'fb_exchange_token', 'client_id' => $id, 'client_secret' => $secret, 'fb_exchange_token' => $b['access_token'],
            ])];
        case 'instagram/code':
            return ['method' => 'POST', 'url' => 'https://api.instagram.com/oauth/access_token', 'form' => [
                'client_id' => $id, 'client_secret' => $secret, 'grant_type' => 'authorization_code', 'redirect_uri' => $b['redirect_uri'], 'code' => $b['code'],
            ]];
        case 'instagram/long_lived':
            return ['method' => 'GET', 'url' => 'https://graph.instagram.com/access_token?' . qs([
                'grant_type' => 'ig_exchange_token', 'client_secret' => $secret, 'access_token' => $b['access_token'],
            ])];
        case 'threads/code':
            return ['method' => 'POST', 'url' => THREADS_ROOT . '/oauth/access_token', 'form' => [
                'client_id' => $id, 'client_secret' => $secret, 'code' => $b['code'], 'grant_type' => 'authorization_code', 'redirect_uri' => $b['redirect_uri'],
            ]];
        case 'threads/long_lived':
            return ['method' => 'GET', 'url' => THREADS_ROOT . '/access_token?' . qs([
                'grant_type' => 'th_exchange_token', 'client_secret' => $secret, 'access_token' => $b['access_token'],
            ])];
        case 'tiktok/code':
            return ['method' => 'POST', 'url' => TIKTOK_TOKEN, 'form' => [
                'client_key' => $id, 'client_secret' => $secret, 'code' => $b['code'], 'grant_type' => 'authorization_code',
                'redirect_uri' => $b['redirect_uri'], 'code_verifier' => $b['code_verifier'],
            ]];
        case 'tiktok/refresh':
            return ['method' => 'POST', 'url' => TIKTOK_TOKEN, 'form' => [
                'client_key' => $id, 'client_secret' => $secret, 'grant_type' => 'refresh_token', 'refresh_token' => $b['refresh_token'],
            ]];
        case 'linkedin/code':
            return ['method' => 'POST', 'url' => 'https://www.linkedin.com/oauth/v2/accessToken', 'form' => [
                'grant_type' => 'authorization_code', 'code' => $b['code'], 'client_id' => $id, 'client_secret' => $secret, 'redirect_uri' => $b['redirect_uri'],
            ]];
    }
    throw new LogicException('operación sin construir');
}

/* ---------------------------------------------------------------- utilidades ---------------------------------------------------------------- */

/** Igual que URLSearchParams de JS (espacios como '+'). */
function qs(array $params): string
{
    return http_build_query($params, '', '&', PHP_QUERY_RFC1738);
}

function base_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
}

/** Responde con JSON y termina. */
function send_json($data, int $status = 200, array $extra = []): void
{
    http_response_code($status);
    base_headers();
    foreach ($extra as $k => $val) header("$k: $val");
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $motivo, string $message, array $extra = []): void
{
    send_json(['error' => "willypost_$motivo", 'message' => $message], $status, $extra);
}

/* ------------------------------------------------------------ límite de peticiones ------------------------------------------------------------ */

// Aproximado: un archivito por IP en la carpeta temporal, con la IP cifrada (HMAC-SHA256), nunca en claro.
// Si algo falla (sin permisos, etc.) no se bloquea a nadie.
function rate_limited(string $ip, string $salt): bool
{
    try {
        $dir = rtrim(sys_get_temp_dir(), '/\\') . '/willypost-rl';
        if (!is_dir($dir) && !@mkdir($dir, 0700, true) && !is_dir($dir)) return false;
        $now = microtime(true);
        if (mt_rand(1, 200) === 1) { // limpieza ocasional de ventanas viejas
            foreach ((array) glob($dir . '/*') as $old) {
                if (is_string($old) && @filemtime($old) < $now - 2 * RATE_WINDOW_S) @unlink($old);
            }
        }
        $fh = @fopen($dir . '/' . hash_hmac('sha256', $ip, $salt), 'c+');
        if ($fh === false) return false;
        flock($fh, LOCK_EX);
        $d = json_decode((string) stream_get_contents($fh), true);
        if (!is_array($d) || !isset($d['s'], $d['c']) || $now - (float) $d['s'] >= RATE_WINDOW_S) {
            $d = ['s' => $now, 'c' => 1];
        } else {
            $d['c'] = (int) $d['c'] + 1;
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode($d));
        fflush($fh);
        flock($fh, LOCK_UN);
        fclose($fh);
        return $d['c'] > RATE_LIMIT;
    } catch (Throwable $e) {
        return false;
    }
}

/* ------------------------------------------------------------------ /token ------------------------------------------------------------------ */

function handle_token(array $cfg, string $family, string $op): void
{
    if (!array_key_exists($family, OPS) || !array_key_exists($op, OPS[$family])) {
        fail(404, 'operacion_desconocida', 'Esta operación no existe en el servidor central de WillyPost.');
    }
    $fields = OPS[$family][$op];
    if (!configured($cfg, $family)) {
        fail(404, 'no_configurada', 'Esta red todavía no está disponible en modo central. Usa tu propia app (carné) o inténtalo más adelante.');
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        fail(405, 'metodo_no_permitido', 'Solo se admite POST en esta dirección.', ['Allow' => 'POST']);
    }

    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? 'desconocida');
    if (rate_limited($ip, hash('sha256', serialize($cfg)))) {
        fail(429, 'demasiadas_peticiones', 'Demasiadas peticiones seguidas. Espera un minuto y vuelve a intentarlo.', ['Retry-After' => '60']);
    }

    $ctype = strtolower(trim(explode(';', (string) ($_SERVER['CONTENT_TYPE'] ?? $_SERVER['HTTP_CONTENT_TYPE'] ?? ''))[0]));
    if ($ctype !== 'application/json') {
        fail(400, 'tipo_no_valido', 'La petición debe enviarse en formato JSON (Content-Type: application/json).');
    }
    $declared = $_SERVER['CONTENT_LENGTH'] ?? $_SERVER['HTTP_CONTENT_LENGTH'] ?? '';
    if (is_numeric($declared) && (int) $declared > MAX_BODY_BYTES) {
        fail(413, 'demasiado_grande', 'La petición es demasiado grande.');
    }
    $text = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($text === false) $text = '';
    if (strlen($text) > MAX_BODY_BYTES) {
        fail(413, 'demasiado_grande', 'La petición es demasiado grande.');
    }

    try {
        $body = json_decode($text, false, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        fail(400, 'json_no_valido', 'El contenido de la petición no es un JSON válido.');
    }
    if (!is_object($body)) {
        fail(400, 'json_no_valido', 'El contenido de la petición debe ser un objeto JSON.');
    }

    $clean = [];
    foreach ($fields as $f) {
        $val = property_exists($body, $f) ? $body->$f : null;
        if (!is_string($val) || $val === '') {
            fail(400, 'falta_campo', "Falta el campo «{$f}» o no es un texto.");
        }
        if (strlen($val) > MAX_FIELD_BYTES) {
            fail(400, 'campo_demasiado_largo', "El campo «{$f}» es demasiado largo.");
        }
        $clean[$f] = $val;
    }
    if (array_key_exists('redirect_uri', $clean) && $clean['redirect_uri'] !== setting($cfg, 'RELAY')) {
        fail(400, 'redirect_uri_no_valida', 'La dirección de vuelta (redirect_uri) no es la del servidor central de WillyPost.');
    }

    $F = FAMILIES[$family];
    $call = build_call($family, $op, $clean, v($cfg, $F['id']), v($cfg, $F['secret']));

    $headers = ['Accept: application/json'];
    $ch = curl_init($call['url']);
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT        => UPSTREAM_TIMEOUT_S,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_USERAGENT      => 'WillyPost-broker',
    ];
    if ($call['method'] === 'POST') {
        $headers[] = 'Content-Type: application/x-www-form-urlencoded';
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = qs($call['form']);
    } else {
        $opts[CURLOPT_HTTPGET] = true;
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;
    curl_setopt_array($ch, $opts);

    $raw = curl_exec($ch);
    $errno = curl_errno($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    unset($ch); // (curl_close() está obsoleto desde PHP 8.5)

    if ($raw === false || $errno !== 0 || $status === 0) {
        fail(
            502,
            'red_no_responde',
            $errno === 28 // CURLE_OPERATION_TIMEDOUT
                ? 'La red social ha tardado demasiado en responder. Inténtalo de nuevo en unos minutos.'
                : 'No se ha podido contactar con la red social. Inténtalo de nuevo en unos minutos.'
        );
    }
    if ($status >= 300 && $status < 400) {
        fail(502, 'respuesta_no_valida', 'La red social ha respondido de una forma inesperada (redirección). Inténtalo más tarde.');
    }
    try {
        json_decode((string) $raw, false, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        send_json(
            ['error' => 'willypost_respuesta_no_valida', 'message' => 'La red social ha respondido de una forma inesperada. Inténtalo más tarde.', 'status' => $status],
            502
        );
    }
    // Tal cual: mismo JSON y mismo código HTTP que la red. No se copian sus cabeceras (cookies, etc.).
    http_response_code($status);
    base_headers();
    echo $raw;
    exit;
}

/* ------------------------------------------------------------------ entrada ------------------------------------------------------------------ */

try {
    $cfg = load_config();
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = explode('?', (string) ($_SERVER['REQUEST_URI'] ?? '/'), 2)[0];
    $path = rtrim($path, '/');
    if ($path === '') $path = '/';

    if (preg_match('#^/token/([^/]+)/([^/]+)$#', $path, $m)) {
        handle_token($cfg, $m[1], $m[2]);
    }

    // Avisos de Meta (Instagram/Threads/Facebook) cuando alguien quita la app o pide borrar sus datos.
    // El servidor no guarda nada de nadie, así que solo confirmamos y señalamos la página de borrado.
    if ($path === '/meta/deauthorize' || $path === '/meta/delete') {
        if ($method !== 'POST') fail(405, 'metodo_no_permitido', 'Solo se admite POST.', ['Allow' => 'POST']);
        if ($path === '/meta/deauthorize') send_json(['ok' => true]);
        send_json([
            'url' => rtrim(setting($cfg, 'SITE'), '/') . '/borrar-datos.html',
            'confirmation_code' => bin2hex(random_bytes(8)),
        ]);
    }

    $isRead = $method === 'GET' || $method === 'HEAD';
    if ($path === '/config' || $path === '/health') {
        if (!$isRead) fail(405, 'metodo_no_permitido', 'Solo se admite GET.', ['Allow' => 'GET, HEAD']);
        $families = configured_families($cfg);
        if ($path === '/health') send_json(['ok' => true, 'networks' => $families], 200, ['Access-Control-Allow-Origin' => '*']);
        $networks = new stdClass(); // {} y no [] cuando no hay ninguna
        foreach ($families as $f) $networks->$f = family_public($cfg, $f);
        send_json(
            ['version' => 1, 'relay' => setting($cfg, 'RELAY'), 'media' => setting($cfg, 'MEDIA'), 'networks' => $networks],
            200,
            ['Access-Control-Allow-Origin' => '*']
        );
    }
    if ($path === '/' && $isRead) {
        http_response_code(302);
        header('Location: ' . setting($cfg, 'SITE'));
        header('Cache-Control: no-store');
        exit;
    }
    fail(404, 'no_encontrado', 'Dirección no encontrada.');
} catch (Throwable $e) {
    // Sin registrar nada: el error podría contener datos de la petición.
    if (!headers_sent()) {
        fail(500, 'error_interno', 'Ha habido un error en el servidor central de WillyPost. Inténtalo de nuevo.');
    }
    exit;
}
