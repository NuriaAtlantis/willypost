export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = Array.isArray(details) ? details : [];
  }
}

// Avisa a la interfaz cuando se pierde (o vuelve) la conexión con WillyPost.
let offline = false;
const setOffline = (v) => {
  if (offline === v) return;
  offline = v;
  window.dispatchEvent(new CustomEvent(v ? 'wp:offline' : 'wp:online'));
};

async function request(method, url, body, { form = false } = {}) {
  const opts = { method, credentials: 'include', headers: {} };
  if (body !== undefined) {
    if (form) opts.body = body;
    else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    setOffline(true);
    throw new ApiError('No puedo hablar con WillyPost. ¿Sigue abierto en tu ordenador? Ábrelo con su icono y recarga esta página.', 0);
  }
  setOffline(false);
  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Algo ha ido mal (error ${res.status}).`;
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      window.dispatchEvent(new CustomEvent('wp:unauthorized'));
    }
    throw new ApiError(msg, res.status, data && data.details);
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
  upload: (url, files) => {
    const fd = new FormData();
    for (const f of files) fd.append('files', f);
    return request('POST', url, fd, { form: true });
  },
};

export const qs = (obj) => {
  const p = new URLSearchParams();
  Object.entries(obj).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); });
  const s = p.toString();
  return s ? `?${s}` : '';
};
