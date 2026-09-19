/** Return null for offline mode. Never include submitted key values in errors. */
export function readSupabaseConfig(env = {}) {
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY)?.trim();
  if (!url && !key) return null;
  if (!url || !key) throw new Error('Supabase requires both a URL and a publishable key.');

  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid Supabase URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('Supabase URL must be an HTTPS origin (HTTP is allowed for localhost).');
  }

  if (!key.startsWith('sb_publishable_')) {
    let role;
    try {
      const parts = key.split('.');
      if (parts.length === 3) role = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role;
    } catch { /* Invalid keys fail closed below. */ }
    if (role !== 'anon') throw new Error('Use only a Supabase publishable key or legacy anon key in frontend configuration.');
  }
  return { url: parsed.origin, key };
}
