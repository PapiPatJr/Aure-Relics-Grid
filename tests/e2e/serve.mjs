import { createServer } from 'vite';
import { localStack, apiOrigin } from './local-stack.mjs';

const status = localStack();
// Only public local credentials enter Vite. Existing .env files cannot override these.
process.env.VITE_SUPABASE_URL = apiOrigin;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = '';
process.env.VITE_SUPABASE_ANON_KEY = status.ANON_KEY;
const server = await createServer({ mode: 'e2e', server: { host: '127.0.0.1', port: 5179, strictPort: true, open: false } });
await server.listen();
console.log('Aure E2E server ready on local port 5179.');
