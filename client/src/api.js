// Fetch helper: attaches the auth token, throws Error(message) on failure.
export function getAuth() {
  try { return JSON.parse(localStorage.getItem('tavern-auth')) || null; } catch { return null; }
}
export function setAuth(auth) {
  if (auth) localStorage.setItem('tavern-auth', JSON.stringify(auth));
  else localStorage.removeItem('tavern-auth');
}

export async function api(method, path, body) {
  const token = getAuth()?.token;
  const res = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { 'x-auth-token': token } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
  return data;
}

// Raw-body upload; returns the public /uploads/... path.
export async function upload(kind, file) {
  const token = getAuth()?.token;
  const res = await fetch(`/api/dm/upload?kind=${kind}&name=${encodeURIComponent(file.name)}`, {
    method: 'PUT',
    headers: { 'x-auth-token': token },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'upload failed');
  return data.path;
}
