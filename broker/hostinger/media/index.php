<?php
// WillyPost · proxy de medios para TikTok · versión PHP para Hostinger → https://media.willypost.com
//
//   GET|HEAD /t/<sub>/m/<token>/<archivo>  →  https://<sub>.trycloudflare.com/m/<token>/<archivo>
//
// Mismo contrato que handleMedia() de broker/worker.js (implementación de referencia con tests) y CENTRAL.md:
// streaming sin guardar nada, validación estricta, solo GET/HEAD, solo respuestas image/* o video/*
// (nunca SVG ni HTML), sin redirecciones, pasa Range / Content-Length / Content-Range / Accept-Ranges.
// No necesita claves: no lee willypost-config.php. No registra nada. PHP 8.1+, extensión curl.
// Si cambias algo aquí, cambia lo mismo en broker/worker.js (y al revés).

declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '0');
header_remove('X-Powered-By');

const UPSTREAM_TIMEOUT_S = 20;   // sin un solo byte durante 20 s (también antes de las cabeceras) → se corta
const MAX_TRANSFER_S = 1800;     // tope de seguridad para vídeos muy grandes
const TUNNEL_DOMAIN = 'trycloudflare.com';
const MEDIA_PATH = '#^/t/([a-z0-9-]{3,63})/m/([A-Za-z0-9_-]{16,128})/(media\.(?:jpg|jpeg|png|webp|gif|mp4|mov|webm))$#';
const MEDIA_TYPE = '#^(?:image/(?:jpeg|png|webp|gif)|video/[a-z0-9.+-]+)$#'; // nunca SVG ni HTML
const RANGE_RE = '#^bytes=\d*-\d*$#';
const PASS_HEADERS = [
    'content-type'   => 'Content-Type',
    'content-length' => 'Content-Length',
    'content-range'  => 'Content-Range',
    'accept-ranges'  => 'Accept-Ranges',
    'last-modified'  => 'Last-Modified',
    'etag'           => 'ETag',
];

function base_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
}

function fail(int $status, string $motivo, string $message, array $extra = []): void
{
    http_response_code($status);
    base_headers();
    foreach ($extra as $k => $val) header("$k: $val");
    echo json_encode(['error' => "willypost_$motivo", 'message' => $message], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

try {
    $method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = explode('?', (string) ($_SERVER['REQUEST_URI'] ?? '/'), 2)[0];

    if (!preg_match(MEDIA_PATH, $path, $m)) fail(404, 'no_encontrado', 'Archivo no encontrado.');
    if ($method !== 'GET' && $method !== 'HEAD') {
        fail(405, 'metodo_no_permitido', 'Solo se admite GET o HEAD.', ['Allow' => 'GET, HEAD']);
    }
    [, $sub, $token, $file] = $m;
    $range = trim((string) ($_SERVER['HTTP_RANGE'] ?? ''));
    if ($range !== '' && !preg_match(RANGE_RE, $range)) {
        fail(400, 'rango_no_valido', 'La cabecera Range no es válida.');
    }

    $target = 'https://' . $sub . '.' . TUNNEL_DOMAIN . '/m/' . $token . '/' . $file;
    $isHead = $method === 'HEAD';

    // Streaming de verdad: sin búferes de PHP ni compresión por medio.
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) @ob_end_clean();
    @set_time_limit(0);
    ignore_user_abort(false);

    $status = 0;
    $hdrs = [];
    $mode = null;  // null = aún sin decidir · 'stream' · 'nobody' · 'error'
    $error = null; // [status, motivo, mensaje]

    /** Decide con el código y las cabeceras del túnel: envía las cabeceras al cliente o prepara el error. */
    $decide = function () use (&$status, &$hdrs, &$error, $isHead): string {
        if ($status >= 300 && $status < 400) {
            $error = [502, 'redireccion_no_permitida', 'El archivo no se puede servir con redirecciones.'];
            return 'error';
        }
        if ($status === 416) {
            http_response_code(416);
            base_headers();
            if (isset($hdrs['content-range'])) header('Content-Range: ' . $hdrs['content-range']);
            return 'nobody';
        }
        if ($status !== 200 && $status !== 206) {
            $error = ($status === 404 || $status === 410)
                ? [404, 'no_encontrado', 'Archivo no encontrado o caducado.']
                : [502, 'respuesta_no_valida', 'El ordenador del alumno ha respondido con un error.'];
            return 'error';
        }
        $type = strtolower(trim(explode(';', $hdrs['content-type'] ?? '')[0]));
        if (!preg_match(MEDIA_TYPE, $type)) {
            $error = [502, 'tipo_no_permitido', 'Solo se sirven fotos o vídeos.'];
            return 'error';
        }
        http_response_code($status);
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: no-referrer');
        foreach (PASS_HEADERS as $lower => $name) {
            if (isset($hdrs[$lower]) && $hdrs[$lower] !== '') header($name . ': ' . $hdrs[$lower]);
        }
        header('Content-Type: ' . $type);
        return $isHead ? 'nobody' : 'stream';
    };

    $ch = curl_init($target);
    $reqHeaders = [];
    if ($range !== '') $reqHeaders[] = 'Range: ' . $range; // solo Range: ni cookies ni Authorization
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION  => false, // TikTok no acepta redirecciones y no queremos seguir ninguna
        CURLOPT_NOBODY          => $isHead,
        CURLOPT_HTTPHEADER      => $reqHeaders,
        CURLOPT_CONNECTTIMEOUT  => 10,
        CURLOPT_LOW_SPEED_LIMIT => 1,
        CURLOPT_LOW_SPEED_TIME  => UPSTREAM_TIMEOUT_S,
        CURLOPT_TIMEOUT         => MAX_TRANSFER_S,
        CURLOPT_SSL_VERIFYPEER  => true,
        CURLOPT_SSL_VERIFYHOST  => 2,
        CURLOPT_USERAGENT       => 'WillyPost-media',
        CURLOPT_HEADERFUNCTION  => function ($ch, string $line) use (&$status, &$hdrs): int {
            $t = trim($line);
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $t, $mm)) {
                $status = (int) $mm[1]; // nueva respuesta (p. ej. tras un 100 Continue): se empieza de cero
                $hdrs = [];
            } elseif (($p = strpos($t, ':')) !== false) {
                $hdrs[strtolower(trim(substr($t, 0, $p)))] = trim(substr($t, $p + 1));
            }
            return strlen($line);
        },
        CURLOPT_WRITEFUNCTION   => function ($ch, string $data) use (&$mode, $decide): int {
            if ($mode === null) $mode = $decide();
            if ($mode === 'error') return 0;          // corta la descarga: no se manda nada del túnel
            if ($mode === 'nobody') return strlen($data);
            if (connection_aborted()) return 0;       // TikTok ha colgado: dejamos de descargar
            echo $data;
            flush();
            return strlen($data);
        },
    ]);

    curl_exec($ch);
    $errno = curl_errno($ch);
    unset($ch); // (curl_close() está obsoleto desde PHP 8.5)

    if ($mode === null) {
        // No llegó ningún byte del cuerpo: fallo de red, HEAD o archivo vacío.
        if ($errno !== 0 || $status === 0) {
            fail(
                502,
                'red_no_responde',
                $errno === 28 // CURLE_OPERATION_TIMEDOUT
                    ? 'El ordenador del alumno ha tardado demasiado en responder.'
                    : 'No se ha podido contactar con el ordenador del alumno.'
            );
        }
        $mode = $decide();
    }
    if ($mode === 'error' && is_array($error) && !headers_sent()) {
        fail($error[0], $error[1], $error[2]);
    }
    exit; // 'stream' ya se envió; si el túnel se cortó a mitad, no hay nada más que hacer
} catch (Throwable $e) {
    if (!headers_sent()) {
        fail(500, 'error_interno', 'Ha habido un error en el servidor central de WillyPost. Inténtalo de nuevo.');
    }
    exit;
}
