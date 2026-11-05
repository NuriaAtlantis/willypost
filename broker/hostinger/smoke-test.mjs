#!/usr/bin/env node
// WillyPost · prueba rápida del servidor central YA PUBLICADO (Hostinger o Cloudflare).
//
//   node broker/hostinger/smoke-test.mjs https://auth.willypost.com [https://media.willypost.com]
//
// Solo hace peticiones que el servidor rechaza (no canjea ningún token real) y comprueba que el
// contrato de CENTRAL.md se cumple: /health, forma de /config, errores 400/404/405/413 y 404 de medios.
// Sale con código 1 si algo falla. Sin dependencias (Node 18+).

const args = process.argv.slice(2);
if (!args[0] || args[0] === '-h' || args[0] === '--help') {
  console.log('Uso: node broker/hostinger/smoke-test.mjs <URL de auth> [URL de medios]');
  console.log('Ejemplo: node broker/hostinger/smoke-test.mjs https://auth.willypost.com https://media.willypost.com');
  process.exit(args[0] ? 0 : 2);
}
const AUTH = args[0].replace(/\/+$/, '');
let MEDIA = args[1] ? args[1].replace(/\/+$/, '') : null;

const OPS = {
  meta: ['code', 'long_lived'],
  instagram: ['code', 'long_lived'],
  threads: ['code', 'long_lived'],
  tiktok: ['code', 'refresh'],
  linkedin: ['code'],
};

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const bad = (msg) => { failures++; console.log(`  ✘ ${msg}`); };
const warn = (msg) => { warnings++; console.log(`  ! ${msg}`); };
const check = (cond, msg, detail = '') => (cond ? ok(msg) : bad(detail ? `${msg} → ${detail}` : msg));

async function req(url, init = {}) {
  const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30_000), ...init });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { res, status: res.status, text, json, headers: res.headers };
}

const post = (path, body, ctype = 'application/json') =>
  req(`${AUTH}${path}`, { method: 'POST', headers: ctype ? { 'Content-Type': ctype } : {}, body });

function expectError(r, status, code, label) {
  const got = `${r.status} ${r.json?.error ?? r.text.slice(0, 80)}`;
  check(r.status === status && r.json?.error === code && typeof r.json?.message === 'string', `${label}: ${status} ${code}`, got);
  if (r.status === status && !String(r.headers.get('cache-control') || '').includes('no-store')) bad(`${label}: falta Cache-Control: no-store`);
}

async function main() {
  console.log(`\nServidor central: ${AUTH}`);

  /* /health */
  console.log('\n/health');
  const h = await req(`${AUTH}/health`);
  check(h.status === 200, 'responde 200', String(h.status));
  check(h.json?.ok === true && Array.isArray(h.json?.networks), 'JSON { ok: true, networks: [...] }', h.text.slice(0, 120));
  check(String(h.headers.get('cache-control') || '').includes('no-store'), 'Cache-Control: no-store');
  if (h.headers.get('x-powered-by')) warn(`la cabecera X-Powered-By revela «${h.headers.get('x-powered-by')}»`);
  const healthNets = Array.isArray(h.json?.networks) ? h.json.networks : [];
  console.log(`  · redes activas: ${healthNets.length ? healthNets.join(', ') : '(ninguna todavía)'}`);

  /* /config */
  console.log('\n/config');
  const c = await req(`${AUTH}/config`);
  check(c.status === 200, 'responde 200', String(c.status));
  const cfg = c.json || {};
  check(cfg.version === 1, 'version: 1', String(cfg.version));
  check(typeof cfg.relay === 'string' && cfg.relay.startsWith('https://'), `relay: ${cfg.relay}`);
  check(typeof cfg.media === 'string' && cfg.media.startsWith('https://'), `media: ${cfg.media}`);
  const nets = cfg.networks;
  check(nets && typeof nets === 'object' && !Array.isArray(nets), 'networks es un objeto ({} si no hay ninguna)', JSON.stringify(nets));
  const names = nets && typeof nets === 'object' ? Object.keys(nets) : [];
  check(JSON.stringify([...names].sort()) === JSON.stringify([...healthNets].sort()), 'las mismas redes que /health', `${names} / ${healthNets}`);
  for (const n of names) {
    const net = nets[n] || {};
    check(typeof net.client_id === 'string' && net.client_id.length > 0, `${n}: tiene client_id`);
    const extra = Object.keys(net).filter((k) => !['client_id', ...(n === 'meta' ? ['config_id', 'ig_config_id'] : []), ...(n === 'google' ? ['client_secret'] : [])].includes(k));
    check(extra.length === 0, `${n}: no entrega nada más (ni secretos)`, extra.join(', '));
  }
  if (!MEDIA && typeof cfg.media === 'string') MEDIA = cfg.media.replace(/\/+$/, '');

  /* rutas y operaciones desconocidas */
  console.log('\nRutas y operaciones');
  expectError(await req(`${AUTH}/no-existe`), 404, 'willypost_no_encontrado', 'ruta desconocida');
  expectError(await post('/token/nada/code', '{}'), 404, 'willypost_operacion_desconocida', 'familia desconocida');
  expectError(await post('/token/meta/borrar', '{}'), 404, 'willypost_operacion_desconocida', 'operación desconocida');
  expectError(await post('/token/google/code', '{}'), 404, 'willypost_operacion_desconocida', 'google no pasa por el broker');
  expectError(await req(`${AUTH}/config`, { method: 'POST' }), 405, 'willypost_metodo_no_permitido', 'POST a /config');

  const missing = Object.keys(OPS).find((f) => !names.includes(f));
  if (missing) {
    expectError(await post(`/token/${missing}/${OPS[missing][0]}`, '{}'), 404, 'willypost_no_configurada', `red sin claves (${missing})`);
  }

  /* validaciones con una red configurada */
  const fam = Object.keys(OPS).find((f) => names.includes(f));
  if (!fam) {
    warn('No hay ninguna red con claves: no se pueden probar los errores 400/405/413 (vuelve a pasar la prueba cuando haya una).');
  } else {
    const op = 'code';
    const path = `/token/${fam}/${op}`;
    console.log(`\nValidaciones (con ${fam}/${op}; no se canjea nada)`);
    expectError(await req(`${AUTH}${path}`), 405, 'willypost_metodo_no_permitido', 'GET en vez de POST');
    expectError(await post(path, 'code=x', 'application/x-www-form-urlencoded'), 400, 'willypost_tipo_no_valido', 'sin Content-Type JSON');
    expectError(await post(path, '{nope'), 400, 'willypost_json_no_valido', 'JSON mal formado');
    expectError(await post(path, '[1,2]'), 400, 'willypost_json_no_valido', 'JSON que no es objeto');
    expectError(await post(path, JSON.stringify({ redirect_uri: cfg.relay })), 400, 'willypost_falta_campo', 'falta «code»');
    expectError(
      await post(path, JSON.stringify({ code: 'x'.repeat(4097), redirect_uri: cfg.relay, code_verifier: 'v' })),
      400, 'willypost_campo_demasiado_largo', 'campo de más de 4 KB',
    );
    expectError(
      await post(path, JSON.stringify({ code: 'x', redirect_uri: 'https://example.invalid/callback.html', code_verifier: 'v' })),
      400, 'willypost_redirect_uri_no_valida', 'redirect_uri que no es el relay',
    );
    expectError(await post(path, JSON.stringify({ code: 'x'.repeat(17 * 1024) })), 413, 'willypost_demasiado_grande', 'cuerpo de más de 16 KB');
  }

  /* medios */
  if (!MEDIA) {
    warn('Sin URL de medios: no se prueba el proxy.');
  } else {
    console.log(`\nProxy de medios: ${MEDIA}`);
    const tok = 'a'.repeat(64);
    expectError(await req(`${MEDIA}/t/ab/m/${tok}/media.jpg`), 404, 'willypost_no_encontrado', 'subdominio demasiado corto');
    expectError(await req(`${MEDIA}/t/abc-def/m/corto/media.jpg`), 404, 'willypost_no_encontrado', 'token demasiado corto');
    expectError(await req(`${MEDIA}/t/abc-def/m/${tok}/media.svg`), 404, 'willypost_no_encontrado', 'extensión no permitida');
    expectError(await req(`${MEDIA}/config`), 404, 'willypost_no_encontrado', '/config no existe en medios');
    expectError(await req(`${MEDIA}/t/abc-def/m/${tok}/media.jpg`, { method: 'POST', body: 'x' }), 405, 'willypost_metodo_no_permitido', 'POST en medios');
    expectError(await req(`${MEDIA}/t/abc-def/m/${tok}/media.jpg`, { headers: { Range: 'items=1-2' } }), 400, 'willypost_rango_no_valido', 'Range mal formado');
    const r = await req(`${MEDIA}/t/willypost-prueba-inexistente/m/${tok}/media.jpg`);
    check(
      (r.status === 404 || r.status === 502) && typeof r.json?.error === 'string',
      'túnel inexistente → 404 o 502 en JSON (sin redirecciones)',
      `${r.status} ${r.text.slice(0, 80)}`,
    );
  }

  /* HTTPS obligatorio (aviso, no fallo) */
  if (AUTH.startsWith('https://')) {
    try {
      const r = await fetch(`${AUTH.replace(/^https:/, 'http:')}/health`, { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
      if (r.status === 301 || r.status === 308) ok('http:// redirige a https://');
      else warn(`http:// no redirige a https:// (código ${r.status})`);
    } catch {
      warn('no se ha podido probar http:// (puede ser normal)');
    }
  }

  console.log(`\n${failures === 0 ? 'TODO BIEN' : `${failures} FALLO(S)`}${warnings ? ` · ${warnings} aviso(s)` : ''}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log(`\n✘ No se ha podido completar la prueba: ${e?.message || e}\n`);
  process.exit(1);
});
