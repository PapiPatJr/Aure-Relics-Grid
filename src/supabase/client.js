import { createClient } from '@supabase/supabase-js';
import { readSupabaseConfig } from './config.js';

let client;
let clientConfig;

/** Opt-in only: importing this module does not authenticate or access the network. */
export function getSupabaseClient(env = import.meta.env ?? {}) {
  const config = readSupabaseConfig(env);
  if (!config) return null;
  if (client && (clientConfig.url !== config.url || clientConfig.key !== config.key)) {
    throw new Error('Supabase configuration changed; reload before switching projects.');
  }
  if (!client) {
    client = createClient(config.url, config.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    clientConfig = config;
  }
  return client;
}
