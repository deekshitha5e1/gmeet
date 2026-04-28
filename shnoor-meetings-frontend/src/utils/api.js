const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
const wsBaseUrl = (import.meta.env.VITE_WS_BASE_URL || '').replace(/\/$/, '');

function getDefaultApiBaseUrl() {
  if (!import.meta.env.DEV) {
    return '';
  }

  const protocol = window.location.protocol;
  const hostname = window.location.hostname || '127.0.0.1';
  return `${protocol}//${hostname}:8000`;
}

function getDefaultWebSocketBaseUrl() {
  if (!import.meta.env.DEV) {
    return '';
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname || '127.0.0.1';
  return `${protocol}//${hostname}:8000`;
}

export function buildApiUrl(path) {
  if (!path.startsWith('/')) {
    throw new Error(`API path must start with "/": ${path}`);
  }

  const resolvedApiBaseUrl = apiBaseUrl || getDefaultApiBaseUrl();
  return resolvedApiBaseUrl ? `${resolvedApiBaseUrl}${path}` : path;
}

export function buildWebSocketUrl(path) {
  if (!path.startsWith('/')) {
    throw new Error(`WebSocket path must start with "/": ${path}`);
  }

  const resolvedWsBaseUrl = wsBaseUrl || getDefaultWebSocketBaseUrl();
  if (resolvedWsBaseUrl) {
    return `${resolvedWsBaseUrl}${path}`;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${path}`;
}
