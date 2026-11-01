import { useEffect, useState } from 'react';

function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path: path || '/', query: Object.fromEntries(new URLSearchParams(query)) };
}

export function useRoute() {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path) {
  window.location.hash = '#' + path;
}

// Cambia la URL (por ejemplo para quitar ?ok=…) sin añadir una entrada al historial.
export function replaceRoute(path) {
  history.replaceState(null, '', '#' + path);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
