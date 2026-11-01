/* WillyPost · configuración de la web de documentación.
   Si cambias de organización o de repositorio en GitHub, cámbialo AQUÍ (y solo aquí).
   Los enlaces de descarga, las URIs de redirección de las guías y el email de contacto se rellenan desde este archivo.
   (callback.html NO usa este archivo a propósito: no carga ningún script externo.) */
window.WILLYPOST_CONFIG = {
  // Repositorio de GitHub (el botón "Descargar" apunta a <repoUrl>/releases/latest)
  repoUrl: 'https://github.com/NuriaAtlantis/willypost',

  // URL pública de esta web (GitHub Pages)
  siteUrl: 'https://nuriaatlantis.github.io/willypost/',

  // URI de redirección para Meta (Facebook, Instagram, Threads) y LinkedIn. Debe coincidir con RELAY_URL de server/config.js
  relayUrl: 'https://nuriaatlantis.github.io/willypost/callback.html',

  // URI de redirección para Google (YouTube, GBP) y TikTok. Debe coincidir con LOCAL_REDIRECT de server/config.js
  localRedirect: 'http://localhost:4747/oauth/callback',

  // Dirección de WillyPost en el ordenador del alumno
  appUrl: 'http://localhost:4747',

  contactEmail: 'nuria.olive@gmail.com',

  // Web de la academia
  academyUrl: 'https://willyseo.net/'
};

// Direcciones derivadas de siteUrl (las que piden Meta, TikTok, Google y LinkedIn al crear la app).
// No hace falta tocarlas: se recalculan solas al cambiar siteUrl.
(function (C) {
  var base = (C.siteUrl || '').replace(/\/*$/, '/');
  C.privacyUrl = C.privacyUrl || base + 'privacidad.html';
  C.termsUrl = C.termsUrl || base + 'terminos.html';
  C.dataDeletionUrl = C.dataDeletionUrl || base + 'borrar-datos.html';
})(window.WILLYPOST_CONFIG);
