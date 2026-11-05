/* WillyPost · web de documentación. Sin dependencias, sin analítica y sin cookies. La única llamada sale de las guías de cada red:
   preguntan a auth.willypost.com/config (datos públicos) si esa red ya se conecta sin app propia. */
(function () {
  var C = window.WILLYPOST_CONFIG || {};

  // Enlaces al repositorio:  <a data-repo="releases">  (home | releases | issues | zip | exe | download)
  //   exe      = instalador de Windows (Instalar-WillyPost.exe, en docs/descargas)
  //   download = botones "Descargar" genéricos: el .exe si entras desde Windows; el ZIP en Mac y en el resto
  var repo = (C.repoUrl || '').replace(/\/+$/, '');
  var zipUrl = repo + '/archive/refs/heads/main.zip';
  var isWindows = /Win/i.test(navigator.platform || '') || /Windows NT/i.test(navigator.userAgent || '');
  var exeUrl = C.windowsExeUrl || zipUrl;
  var repoMap = { home: repo, releases: repo + '/releases/latest', issues: repo + '/issues', zip: zipUrl, exe: exeUrl, download: isWindows ? exeUrl : zipUrl };
  document.querySelectorAll('[data-repo]').forEach(function (a) {
    var href = repoMap[a.getAttribute('data-repo')];
    if (href) a.setAttribute('href', href);
  });

  // Textos que vienen de config.js:  <code data-fill="relayUrl">  /  <a data-fill-href="academyUrl">
  document.querySelectorAll('[data-fill]').forEach(function (el) {
    var v = C[el.getAttribute('data-fill')];
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-fill-href]').forEach(function (el) {
    var key = el.getAttribute('data-fill-href');
    var v = C[key];
    if (!v) return;
    el.setAttribute('href', key === 'contactEmail' ? 'mailto:' + v : v);
    if (el.hasAttribute('data-fill-text')) el.textContent = v;
  });

  // Botones "Copiar"
  document.querySelectorAll('.copybox').forEach(function (box) {
    var btn = box.querySelector('button');
    var code = box.querySelector('code');
    if (!btn || !code) return;
    btn.addEventListener('click', function () {
      var text = code.textContent.trim();
      function ok() {
        var old = btn.textContent;
        btn.textContent = '¡Copiado!'; btn.classList.add('done');
        setTimeout(function () { btn.textContent = old; btn.classList.remove('done'); }, 1800);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok, fallback);
      } else { fallback(); }
      function fallback() {
        var r = document.createRange(); r.selectNodeContents(code);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
        try { document.execCommand('copy'); ok(); } catch (e) { /* el texto queda seleccionado */ }
      }
    });
  });

  // Pestañas Windows / Mac (se elige sola según tu sistema)
  var tabs = document.querySelector('.tabs');
  if (tabs) {
    var buttons = tabs.querySelectorAll('button');
    var select = function (id) {
      buttons.forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === id ? 'true' : 'false'); });
      document.querySelectorAll('.tabpanel').forEach(function (p) { p.hidden = p.id !== 'tab-' + id; });
    };
    buttons.forEach(function (b) { b.addEventListener('click', function () { select(b.getAttribute('data-tab')); }); });
    var isMac = /Mac|iPhone|iPad/i.test(navigator.platform || '') || /Mac OS X/i.test(navigator.userAgent || '');
    select(isMac ? 'mac' : 'windows');
  }

  // Menú en móvil
  var mb = document.querySelector('.menu-btn'), nav = document.querySelector('nav.main');
  if (mb && nav) mb.addEventListener('click', function () {
    var open = nav.classList.toggle('open'); mb.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  // Año del pie
  document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = new Date().getFullYear(); });

  // Guías: ¿esta red ya se conecta sin app propia? Se pregunta al servidor central (/config, la misma lista que
  // usa WillyPost). Si la red aún no está, o si no se puede saber, se avisa arriba y se lleva al modo manual o a la
  // opción avanzada. /config solo trae datos públicos (el ID de cada app), nunca claves.
  //
  // EN_REVISION: redes cuya app ya funciona, pero la red todavía la está revisando (mientras tanto solo entran las
  // cuentas de prueba). Cuando la red apruebe la app, BORRA su línea de aquí y el aviso desaparece de su guía.
  var EN_REVISION = {
    meta: { quien: 'Meta' },    // Facebook e Instagram (Instagram entra a través de Facebook)
    threads: { quien: 'Meta' }
  };
  var has = function (n) { return !!(n && n.client_id); };
  var GUIDE = {
    facebook:  { label: 'Facebook', ventana: 'Facebook', review: 'meta', ok: function (n) { return has(n.meta); } },
    // Instagram: con la app de Meta y su configuración propia de Instagram (ig_config_id), o con una app de Instagram aparte
    instagram: { label: 'Instagram', ventana: 'Facebook', review: 'meta', ok: function (n) { return has(n.instagram) || (has(n.meta) && !!n.meta.ig_config_id); } },
    threads:   { label: 'Threads', ventana: 'Threads', review: 'threads', ok: function (n) { return has(n.threads); } },
    linkedin:  { label: 'LinkedIn', ventana: 'LinkedIn', review: 'linkedin', ok: function (n) { return has(n.linkedin); } },
    tiktok:    { label: 'TikTok', ventana: 'TikTok', review: 'tiktok', ok: function (n) { return has(n.tiktok); } },
    youtube:   { label: 'YouTube Shorts', ventana: 'Google', review: 'google', ok: function (n) { return has(n.google); } },
    gbp:       { label: 'Google Business Profile', ventana: 'Google', review: 'google', ok: function (n) { return has(n.google); } }
  };
  var page = (location.pathname.match(/guias\/([a-z]+)(?:\.html)?$/) || [])[1];
  var g = page && GUIDE[page];
  var body = document.querySelector('.guide-body .container');
  if (g && body && C.brokerUrl && document.getElementById('avanzada')) {
    var salidas = 'Mientras tanto, usa el <strong>modo manual</strong> (WillyPost te avisa a la hora y publicas tú en dos clics) ' +
      'o tu propia app con la <a href="#avanzada">opción avanzada</a> de esta guía.';
    var show = function (cls, title, html) {
      var box = document.createElement('div');
      box.className = 'callout' + (cls ? ' ' + cls : '');
      box.setAttribute('role', 'note');
      box.innerHTML = '<span class="t">' + title + '</span><p>' + html + '</p>';
      body.insertBefore(box, body.firstChild);
    };
    var notReady = function () {
      show('warn', 'La conexión directa con ' + g.label + ' todavía no está lista',
        'La app de WillyPost para ' + g.label + ' aún no está disponible, así que en WillyPost verás <strong>«Configura tu carné»</strong> en vez de «Conectar ' + g.label + '». ' +
        salidas + ' En cuanto esté lista, este aviso desaparece solo.');
    };
    var unknown = function () {
      show('warn', 'No hemos podido comprobar si ' + g.label + ' ya se conecta sola',
        'Si en WillyPost ves «Conectar ' + g.label + '», sigue esta guía con normalidad. Si ves <strong>«Configura tu carné»</strong>, es que todavía no está lista. ' + salidas);
    };
    var inReview = function () {
      var r = EN_REVISION[g.review];
      show('', r.quien + ' está revisando la app de WillyPost',
        'Es un trámite de unos días. Hasta entonces, «Conectar ' + g.label + '» solo funciona con las cuentas de prueba: si ' + g.ventana +
        ' te dice que la app no está disponible o que no tienes permiso, no has hecho nada mal. ' + salidas);
    };
    getNetworks(function (n) {
      if (!n) return unknown();
      if (!g.ok(n)) return notReady();
      if (EN_REVISION[g.review]) inReview();
    });
  }

  // Índice de guías: la etiqueta de cada tarjeta dice si la red ya se conecta sola (sin JavaScript se queda «Fácil»).
  var cards = document.querySelectorAll('a.gcard[href]');
  if (cards.length && C.brokerUrl && /guias\/(index\.html)?$/.test(location.pathname)) {
    getNetworks(function (n) {
      if (!n) return;
      cards.forEach(function (a) {
        var id = (a.getAttribute('href').match(/^([a-z]+)\.html$/) || [])[1];
        var gg = id && GUIDE[id], tag = a.querySelector('.tag');
        if (!gg || !tag) return;
        if (!gg.ok(n)) { tag.textContent = 'Muy pronto'; tag.className = 'tag warn'; }
        else if (EN_REVISION[gg.review]) { tag.textContent = 'En revisión'; tag.className = 'tag'; }
        else { tag.textContent = 'Ya disponible'; tag.className = 'tag ok'; }
      });
    });
  }

  // Pide /config (con un reintento si falla a la primera); cb(networks) o cb(null) si no responde en 8 s.
  function getNetworks(cb) {
    var done = false;
    var finish = function (v) { if (done) return; done = true; clearTimeout(timer); cb(v); };
    var timer = setTimeout(function () { finish(null); }, 8000);
    var ask = function (retry) {
      fetch(C.brokerUrl + '/config', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
        .then(function (j) { finish(j && j.networks && typeof j.networks === 'object' ? j.networks : null); })
        .catch(function () { if (retry) setTimeout(function () { ask(false); }, 1200); else finish(null); });
    };
    ask(true);
  }
})();
