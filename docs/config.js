/* WillyPost · configuración de la web de documentación.
   Si cambias de dominio, de organización o de repositorio en GitHub, cámbialo AQUÍ (y solo aquí).
   Los enlaces de descarga, las URIs de redirección de las guías y el email de contacto se rellenan desde este archivo.
   (callback.html NO usa este archivo a propósito: no carga ningún script externo.)
   El mismo dominio aparece en server/config.js y en la configuración del broker (ver CENTRAL.md). */
window.WILLYPOST_CONFIG = {
  // Dominio propio de WillyPost (web en GitHub Pages con dominio propio; DNS en Hostinger)
  domain: 'willypost.com',

  // Repositorio de GitHub (el botón "Descargar" apunta a <repoUrl>/archive/refs/heads/main.zip)
  repoUrl: 'https://github.com/NuriaAtlantis/willypost',

  contactEmail: 'nuria.olive@gmail.com',

  // Web de la academia
  academyUrl: 'https://willyseo.net/',

  // Dirección de WillyPost en el ordenador del alumno
  appUrl: 'http://localhost:4747',

  // URI de redirección para Google (YouTube, GBP) y TikTok cuando usas TU PROPIA app.
  // Debe coincidir con LOCAL_REDIRECT de server/config.js
  localRedirect: 'http://localhost:4747/oauth/callback'
};

// Direcciones derivadas del dominio. No hace falta tocarlas: se recalculan solas al cambiar `domain`.
(function (C) {
  var base = 'https://' + C.domain + '/';
  C.siteUrl = C.siteUrl || base;
  // Página de vuelta (relé) para Meta, LinkedIn y TikTok en modo central. Debe coincidir con RELAY_URL de server/config.js
  C.relayUrl = C.relayUrl || base + 'callback.html';
  C.privacyUrl = C.privacyUrl || base + 'privacidad.html';
  C.termsUrl = C.termsUrl || base + 'terminos.html';
  C.dataDeletionUrl = C.dataDeletionUrl || base + 'borrar-datos.html';
  C.englishUrl = C.englishUrl || base + 'en.html';
  // Servicio de conexión (broker) y proxy de fotos para TikTok
  C.brokerUrl = C.brokerUrl || 'https://auth.' + C.domain;
  C.mediaUrl = C.mediaUrl || 'https://media.' + C.domain;
})(window.WILLYPOST_CONFIG);
