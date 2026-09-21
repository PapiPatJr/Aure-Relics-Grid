import { bootLegacyPrototype } from './app/legacyBootstrap.js';
import { getSupabaseClient } from './supabase/client.js';
import { startEntry } from './entry/app.js';
import './entry/entry.css';
import './characters/characters.css';

async function start() {
  try {
    const client = getSupabaseClient();
    if (client) {
      startEntry(client, bootLegacyPrototype);
    } else if (!location.hash || location.hash === '#offline') {
      document.getElementById('legacyBoard').hidden = false;
      await bootLegacyPrototype();
    } else {
      throw new Error('Online entry requires configuration.');
    }
  } catch {
    document.getElementById('legacyBoard').hidden = true;
    const entry = document.getElementById('onlineEntry');
    entry.hidden = false;
    document.body.classList.add('entry-active');
    entry.textContent = 'Aure Relics could not start. Check the deployment configuration and reload.';
  }
}
void start();
