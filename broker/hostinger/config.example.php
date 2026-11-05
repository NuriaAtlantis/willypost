<?php
// WillyPost · servidor central · ARCHIVO DE CLAVES (modelo)
//
// 1) Copia este archivo con el nombre  willypost-config.php
// 2) Ponlo FUERA de public_html, en la carpeta del dominio. En Hostinger:
//        domains/willypost.com/willypost-config.php        ← AQUÍ
//        domains/willypost.com/public_html/auth/index.php  (el broker lo busca dos carpetas más arriba)
//    Si lo pones en otro sitio, dentro de public_html NO: cualquiera podría intentar leerlo.
// 3) Rellena cada clave cuando la red apruebe su app. Lo que esté vacío ('') no se usa:
//    esa red no aparece en /config ni en /health hasta que tenga su ID y su secreto.
//
// Este archivo de verdad (willypost-config.php) NUNCA se sube a GitHub.

return [
    // Direcciones (normalmente no hace falta tocarlas)
    'SITE'  => 'https://willypost.com',
    'RELAY' => 'https://willypost.com/callback.html',
    'MEDIA' => 'https://media.willypost.com',

    // Meta · Facebook (app de Meta de Diving With Us SL)
    'META_APP_ID'     => '',
    'META_APP_SECRET' => '',
    'META_CONFIG_ID'  => '', // opcional: configuración de «Facebook Login for Business»
    'META_IG_CONFIG_ID' => '', // opcional: otra configuración de «Facebook Login for Business» SOLO para Instagram.
                               // Las apps nuevas de Meta ya no admiten «Inicio de sesión con Instagram»: con este valor,
                               // Instagram se conecta a través de Facebook y no hacen falta IG_APP_ID / IG_APP_SECRET.

    // Instagram (Inicio de sesión con Instagram: su propio ID y secreto, no los de Facebook)
    'IG_APP_ID'     => '',
    'IG_APP_SECRET' => '',

    // Threads (su propio ID y secreto)
    'THREADS_APP_ID'     => '',
    'THREADS_APP_SECRET' => '',

    // TikTok (Client key y Client secret)
    'TIKTOK_CLIENT_KEY'    => '',
    'TIKTOK_CLIENT_SECRET' => '',

    // LinkedIn
    'LINKEDIN_CLIENT_ID'     => '',
    'LINKEDIN_CLIENT_SECRET' => '',

    // Google (cliente de tipo «App de escritorio»: Google lo considera público y se entrega en /config)
    'GOOGLE_CLIENT_ID'     => '',
    'GOOGLE_CLIENT_SECRET' => '',
];
