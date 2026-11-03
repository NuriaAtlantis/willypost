/* WillyPost · web de documentación. Sin dependencias, sin analítica, sin llamadas a ningún servidor. */
(function () {
  var C = window.WILLYPOST_CONFIG || {};

  // Enlaces al repositorio:  <a data-repo="releases">  (home | releases | issues | zip)
  var repo = (C.repoUrl || '').replace(/\/+$/, '');
  var repoMap = { home: repo, releases: repo + '/releases/latest', issues: repo + '/issues', zip: repo + '/archive/refs/heads/main.zip' };
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

  // Guías: ¿esta red ya se conecta sin app propia? Se pregunta al servidor central. Mientras la red esté
  // en revisión (o si no se puede saber), se avisa arriba y se lleva a la opción avanzada.
  var FAMILY = { facebook: 'meta', instagram: 'instagram', threads: 'threads', tiktok: 'tiktok', youtube: 'google', gbp: 'google', linkedin: 'linkedin' };
  var page = (location.pathname.match(/guias\/([a-z]+)\.html$/) || [])[1];
  var family = page && FAMILY[page];
  var body = document.querySelector('.guide-body .container');
  if (family && body && C.brokerUrl && document.getElementById('avanzada')) {
    var warn = function () {
      var box = document.createElement('div');
      box.className = 'callout warn';
      box.innerHTML = '<span class="t">Esta red todavía está en revisión</span><p>La app de WillyPost para esta red aún no está aprobada, así que de momento «Conectar» sin configurar nada no funciona. ' +
        'Mientras tanto, conéctala con tu propia app siguiendo la <a href="#avanzada">opción avanzada</a> de esta guía, o usa el modo manual. En cuanto la red apruebe WillyPost, este aviso desaparece.</p>';
      body.insertBefore(box, body.firstChild);
    };
    var done = false;
    var timer = setTimeout(function () { if (!done) { done = true; warn(); } }, 5000);
    fetch(C.brokerUrl + '/health', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (done) return; done = true; clearTimeout(timer); if (!j || !Array.isArray(j.networks) || j.networks.indexOf(family) < 0) warn(); })
      .catch(function () { if (done) return; done = true; clearTimeout(timer); warn(); });
  }
})();
