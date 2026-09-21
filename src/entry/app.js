import { createEntryService, formatJoinCode, joinLink, isDm } from './service.js';
import { mountCharacters } from '../characters/panel.js';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const e = escapeHtml;
const button = (action, label, value = '', kind = '') => `<button type="button" class="${kind}" data-action="${action}" data-value="${e(value)}">${e(label)}</button>`;
const field = (id, label, type = 'text', extra = '') => `<label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" required ${extra}>`;
const title = (eyebrow, heading, description) => `<div class="entry-heading"><p class="entry-eyebrow">${e(eyebrow)}</p><h1 tabindex="-1">${e(heading)}</h1><p>${e(description)}</p></div>`;
const nameForm = (id, label, submit) => `<form data-form="${id}">${field('name', label, 'text', 'maxlength="80" autocomplete="off"')}<button class="entry-primary" type="submit">${submit}</button></form>`;

/** A small route shell. Guests never import or initialize the local DM board. */
export function startEntry(client, bootBoard) {
  const api = createEntryService(client);
  const root = document.getElementById('onlineEntry');
  const board = document.getElementById('legacyBoard');
  let user = null, route = '', epoch = 0, timer, busy = false, authAction = false;
  let capturedCode = '', activeCampaign = null, activeSession = null, issuedCode = '';
  let boardStarted = false, destroyed = false;
  let characterPanel = null;
  const clearCharacters = () => { characterPanel?.dispose(); characterPanel = null; };
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'entry-board-back'; back.textContent = 'Return to session'; back.hidden = true;
  document.querySelector('.app-header').append(back);
  back.addEventListener('click', () => go(activeSession ? `session/${activeSession.id}` : 'dm'));

  function notice(message, error = false) {
    const target = root.querySelector('#entryNotice');
    if (!target) return;
    target.textContent = message;
    target.classList.toggle('entry-error', error);
  }
  function shell(content) {
    root.innerHTML = `<div class="entry-wrap"><nav class="entry-nav" aria-label="Online navigation"><span class="entry-wordmark">THE CAMPAIGN HALL</span><div>${isDm(user) ? button('dm', 'My campaigns') : button('join', 'Join a session')}${user ? button('logout', 'Sign out') : button('login', 'DM sign in')}</div></nav><div id="entryNotice" role="status" aria-live="polite"></div>${content}<footer class="entry-footer">Aure Relics <span>•</span> Gather your party. Write your legend.</footer></div>`;
    root.querySelector('h1')?.focus();
  }
  function lock(value) {
    busy = value;
    root.setAttribute('aria-busy', String(value));
    for (const el of root.querySelectorAll('button, input')) el.disabled = value;
  }
  function concealBoard() {
    board.hidden = true; back.hidden = true; root.hidden = false;
    document.body.classList.add('entry-active');
  }
  function go(next) {
    history.replaceState(null, '', `#${next}`);
    void load();
  }
  function captureRoute() {
    const raw = location.hash.slice(1);
    if (raw.startsWith('join/')) {
      capturedCode = raw.slice(5);
      history.replaceState(null, '', '#join');
      return 'join';
    }
    // Strip confirmation token fragments without accepting them as a session.
    if (raw.includes('access_token=') || raw.includes('error_description=')) {
      history.replaceState(null, '', '#login');
      return 'login';
    }
    return raw || (isDm(user) ? 'dm' : user ? 'join' : 'login');
  }
  async function run(action, { auth = false } = {}) {
    if (busy) return;
    const stamp = epoch;
    lock(true); notice('Working…'); authAction = auth;
    try { await action(() => stamp === epoch && !destroyed); }
    catch (error) { if (stamp === epoch) notice(error.message || 'Unable to continue. Please try again.', true); }
    finally { authAction = false; lock(false); }
  }
  async function load() {
    const stamp = ++epoch;
    clearCharacters();
    clearTimeout(timer); concealBoard(); issuedCode = '';
    shell('<p class="entry-loading">Opening the campaign hall…</p>');
    try {
      const current = await api.user();
      if (stamp !== epoch || destroyed) return;
      user = current; route = captureRoute();
      const [page, id] = route.split('/');
      if (['dm', 'campaign', 'session', 'board'].includes(page) && !isDm(user)) {
        route = user ? 'join' : 'login';
        history.replaceState(null, '', `#${route}`);
      }
      if (route === 'login' || route === 'register') return renderAuth(route);
      if (route === 'join') return renderJoin();
      if (route === 'dm') {
        const campaigns = await api.campaigns();
        if (stamp !== epoch) return;
        shell(title('DUNGEON MASTER', 'Your campaigns', 'Every great adventure begins with a place to gather.') + `<div class="entry-columns"><section class="entry-panel"><h2>Continue your story</h2><div class="entry-list">${campaigns.length ? campaigns.map(c => `<article class="entry-row"><div><h3>${e(c.name)}</h3><p>Campaign</p></div>${button('campaign', 'Open campaign', c.id)}</article>`).join('') : '<p class="entry-empty">Your first campaign is waiting to be written.</p>'}</div></section><section class="entry-panel entry-accent"><p class="entry-eyebrow">A NEW BEGINNING</p><h2>Create a campaign</h2>${nameForm('campaign', 'Campaign name', 'Create campaign')}</section></div>`);
        return;
      }
      if (page === 'campaign' && isDm(user)) {
        const campaign = await api.campaign(id);
        const sessions = await api.sessions(id);
        if (stamp !== epoch) return;
        activeCampaign = campaign;
        shell(title('YOUR CAMPAIGN', campaign.name, 'Prepare a gathering, then invite your players to the table.') + `<div class="entry-columns"><section class="entry-panel"><h2>Sessions</h2><div class="entry-list">${sessions.length ? sessions.map(s => `<article class="entry-row"><div><h3>${e(s.name)}</h3><span class="entry-badge">${e(s.status)}</span></div>${button('session', 'Open session', s.id)}</article>`).join('') : '<p class="entry-empty">No sessions yet. Give your first gathering a name.</p>'}</div></section><section class="entry-panel entry-accent"><h2>Host a session</h2>${nameForm('session', 'Session name', 'Create session')}</section></div>`);
        return;
      }
      if (['session', 'board'].includes(page) && isDm(user)) {
        const session = await api.session(id);
        const campaign = await api.campaign(session.campaign_id);
        if (stamp !== epoch) return;
        activeSession = session; activeCampaign = campaign;
        if (page === 'board') {
          root.hidden = true; board.hidden = false; back.hidden = false;
          document.body.classList.remove('entry-active');
          if (!boardStarted) { await bootBoard(); boardStarted = true; }
          if (stamp !== epoch) { concealBoard(); return; }
          window.dispatchEvent(new Event('resize'));
          return;
        }
        shell(title(campaign.name, session.name, 'Invite your party and welcome each player before they enter the lobby.') + `<div class="entry-columns"><section class="entry-panel entry-accent"><p class="entry-eyebrow">INVITE YOUR PARTY</p><h2>A seat at the table</h2><p>Join codes expire after 24 hours. Each guest still needs your approval.</p>${session.status === 'closed' ? '<p>This session is closed.</p>' : `<div class="entry-actions">${button('issue', 'Generate / replace code', '', 'entry-primary')}${button('revoke-code', 'Revoke join code')}</div><div id="sharePanel"></div><p class="entry-muted">Replacing or revoking a code stops new requests. Remove a player below to withdraw their existing access.</p>`}<hr><h2>Your battle board</h2><p>The existing board saves scenes on this device. It is not linked to this online session yet.</p>${button('board', 'Open local battle board', session.id)}</section><section class="entry-panel"><div class="entry-section-head"><h2>Your players</h2>${button('refresh', 'Refresh')}</div><p class="entry-muted">Requests update automatically while this panel is open.</p><div id="roster" aria-live="polite"></div></section></div>`);
        await refresh(stamp); return;
      }
      if (page === 'lobby' && user) {
        activeSession = { id };
        shell(title('PLAYER LOBBY', 'Your place in the story', 'Keep this browser open while your DM welcomes the party.') + '<section class="entry-panel entry-lobby"><div id="lobbyState" aria-live="polite"></div><div id="roster"></div><div class="entry-actions">' + button('refresh', 'Check status') + button('join', 'Use another code') + '</div></section>');
        await refresh(stamp); return;
      }
      go(isDm(user) ? 'dm' : 'join');
    } catch (error) {
      if (stamp !== epoch) return;
      concealBoard(); shell(title('CAMPAIGN HALL', 'Unable to open this page', 'Check your connection and session access, then try again.') + button('retry', 'Try again'));
      notice(error.message, true);
    }
  }
  function renderAuth(mode) {
    if (isDm(user)) { go('dm'); return; }
    const register = mode === 'register';
    shell(`<div class="entry-welcome"><div>${title('AURE RELICS · ONLINE', 'The next chapter awaits.', 'A gathering place for the worlds you build and the friends who explore them.')}<div class="entry-flourish" aria-hidden="true">✦ ───── ✦ ───── ✦</div><p class="entry-intro">Host your campaign. Gather your party.<br>Let the adventure begin.</p></div><section class="entry-panel entry-accent"><p class="entry-eyebrow">DUNGEON MASTER</p><h2>${register ? 'Begin your chronicle' : 'Welcome back'}</h2>${user?.is_anonymous ? `<p>You are using a guest identity. Signing out ends access to that guest identity in this browser.</p>${button('logout', 'Sign out of guest identity')}` : `<form data-form="${mode}">${field('email', 'Email address', 'email', 'autocomplete="email" maxlength="254"')}${field('password', 'Password', 'password', `autocomplete="${register ? 'new-password' : 'current-password'}" minlength="8" maxlength="128"`)}<button type="submit" class="entry-primary">${register ? 'Create DM account' : 'Sign in'}</button></form><p class="entry-muted">${register ? 'Already have an account?' : 'New to the campaign hall?'}</p>${button(register ? 'login' : 'register', register ? 'Sign in' : 'Create a DM account')}`}<hr><p>Here as a player?</p>${button('join', 'Join with a code or link')}</section></div>`);
  }
  function renderJoin() {
    shell(title('JOIN THE ADVENTURE', 'Your party is waiting.', 'Bring the invitation your DM shared. No permanent account needed.') + `<section class="entry-panel entry-accent entry-lobby">${isDm(user) ? '<p>You are signed in as a DM. Open the invitation in a separate browser profile to join as a player.</p>' : `<form data-form="join">${field('code', 'Join code or link', 'text', `autocomplete="off" autocapitalize="off" spellcheck="false" value="${e(capturedCode)}"`)}${field('displayName', 'Your player name', 'text', 'maxlength="80" autocomplete="nickname"')}<p class="entry-muted">Your DM and approved party members will see this name. Keep this browser’s data to preserve your guest identity.</p><button type="submit" class="entry-primary">Request a seat</button></form>`}</section>`);
  }
  function rosterHtml(rows, host) {
    const list = (items, empty) => items.length ? items.map(p => `<article class="entry-row"><div><h3>${e(p.display_name || 'Guest')}</h3><span class="entry-badge">${e(p.status)}</span></div>${host ? `<div class="entry-actions">${p.status === 'pending' ? button('approve', 'Approve', p.user_id, 'entry-primary') + button('reject', 'Reject', p.user_id) : p.status === 'approved' ? button('revoke', 'Remove', p.user_id) : ''}</div>` : ''}</article>`).join('') : `<p class="entry-empty">${empty}</p>`;
    return host ? `<h3>Awaiting your welcome</h3>${list(rows.filter(p => p.status === 'pending'), 'No pending requests.')}<h3>Session roster</h3>${list(rows.filter(p => p.status === 'approved'), 'Approved players will appear here.')}<details><summary>Removed requests</summary>${list(rows.filter(p => p.status === 'revoked'), 'None.')}</details>` : `<h2>Your party</h2>${list(rows, 'The party is gathering.')}`;
  }
  async function refresh(stamp = epoch) {
    clearTimeout(timer);
    try {
      const host = route.startsWith('session/');
      if (!host && !route.startsWith('lobby/')) return;
      const session = activeSession.id;
      const lobby = host ? null : await api.lobby(session);
      const rows = host || lobby?.status === 'approved' ? await api.roster(session) : [];
      if (stamp !== epoch || destroyed) return;
      const target = root.querySelector('#roster');
      // Avoid replacing focused approval buttons when nothing changed.
      const html = host || lobby?.status === 'approved' ? rosterHtml(rows, host) : '';
      if (target.innerHTML !== html) target.innerHTML = html;
      if (!host) {
        const states = {
          pending: ['Your request is with the DM', 'Your seat is reserved for review. This page will update when the DM responds.'],
          approved: ['Welcome to the party', 'You are approved for this session. Your DM will guide the next steps; online battle play is not available yet.'],
          revoked: ['This invitation was declined or access was removed', 'Contact your DM if you think this was a mistake.'],
          closed: ['This session has ended', 'Ask your DM for an invitation to the next gathering.']
        };
        const state = states[lobby?.status] || ['No request found', 'Use the join link or code your DM shared to request a seat.'];
        root.querySelector('#lobbyState').innerHTML = `<span class="entry-badge">${e(lobby?.status || 'not joined')}</span><h2>${e(state[0])}</h2><p>${e(state[1])}</p>${lobby ? `<p>${e(lobby.campaign_name)} · ${e(lobby.session_name)}</p>` : ''}`;
      }
      if (host || lobby?.status === 'approved') {
        if (!characterPanel) {
          let panelRoot = root.querySelector('#characters');
          if (!panelRoot) {
            panelRoot = document.createElement('div'); panelRoot.id = 'characters';
            root.querySelector('.entry-footer').before(panelRoot);
          }
          characterPanel = mountCharacters(panelRoot, client, { session, host, displayName: lobby?.display_name || '' });
        } else await characterPanel.refresh();
      } else clearCharacters();
      notice('Up to date.');
    } catch {
      if (stamp === epoch) {
        clearCharacters();
        // Fail closed: do not leave an approved lobby displayed on a failed recheck.
        if (route.startsWith('lobby/')) {
          root.querySelector('#roster').replaceChildren();
          root.querySelector('#lobbyState').textContent = 'Unable to verify session access. Reconnecting…';
        }
        notice('Could not refresh. Check your connection or try again.', true);
      }
    } finally {
      if (stamp === epoch && !destroyed) timer = setTimeout(() => { if (!busy) void refresh(stamp); else timer = setTimeout(() => void refresh(stamp), 5000); }, 5000);
    }
  }
  root.addEventListener('submit', event => {
    const form = event.target.closest('form[data-form]'); if (!form) return;
    event.preventDefault(); const fields = new FormData(form); const kind = form.dataset.form;
    void run(async valid => {
      if (kind === 'login' || kind === 'register') {
        const response = await api[kind](fields.get('email'), fields.get('password'));
        if (!valid()) return;
        if (kind === 'register' && !response.session) {
          form.reset(); notice('Check your email to confirm your account, then return here to sign in.');
        } else go('dm');
      } else if (kind === 'campaign') {
        const campaign = await api.createCampaign(fields.get('name')); if (valid()) go(`campaign/${campaign.id}`);
      } else if (kind === 'session') {
        const session = await api.createSession(activeCampaign.id, fields.get('name')); if (valid()) go(`session/${session.id}`);
      } else if (kind === 'join') {
        const session = await api.join(fields.get('code'), fields.get('displayName'));
        if (valid()) { capturedCode = ''; form.reset(); go(`lobby/${session}`); }
      }
    }, { auth: ['login', 'register', 'join'].includes(kind) });
  });
  root.addEventListener('click', event => {
    const el = event.target.closest('button[data-action]'); if (!el || busy) return;
    const action = el.dataset.action, value = el.dataset.value;
    if (['dm', 'join', 'login', 'register'].includes(action)) return go(action);
    if (['campaign', 'session', 'board'].includes(action)) return go(`${action}/${value}`);
    if (action === 'retry') return void load();
    void run(async valid => {
      if (action === 'logout') {
        await api.logout(); if (valid()) { user = null; capturedCode = ''; activeCampaign = null; activeSession = null; go('login'); }
      } else if (action === 'issue') {
        const secret = await api.issueCode(activeSession.id); if (!valid()) return;
        issuedCode = formatJoinCode(activeCampaign.id, activeSession.id, secret);
        root.querySelector('#sharePanel').innerHTML = `<label for="shareCode">Complete join code</label><input id="shareCode" readonly value="${e(issuedCode)}"><label for="shareLink">Shareable join link</label><input id="shareLink" readonly value="${e(joinLink(location.href, issuedCode))}"><div class="entry-actions">${button('copy-code', 'Copy code')}${button('copy-link', 'Copy link')}</div>`;
        notice('New invitation ready. Earlier codes no longer accept new requests.');
      } else if (action === 'revoke-code') {
        await api.revokeCode(activeSession.id); if (!valid()) return;
        issuedCode = ''; root.querySelector('#sharePanel').replaceChildren(); notice('Join code revoked. Existing player approvals are unchanged.');
      } else if (action.startsWith('copy-')) {
        const input = root.querySelector(action === 'copy-code' ? '#shareCode' : '#shareLink');
        try { await navigator.clipboard.writeText(input.value); if (valid()) notice('Copied. Share privately with your party.'); }
        catch { if (valid()) { input.disabled = false; input.focus(); input.select(); notice('Select and copy the highlighted invitation.'); } }
      } else if (['approve', 'reject', 'revoke'].includes(action)) {
        await api.review(activeSession.id, value, action); if (valid()) await refresh();
      } else if (action === 'refresh') await refresh();
    }, { auth: action === 'logout' });
  });
  const subscription = client.auth.onAuthStateChange((event, session) => {
    if (authAction || destroyed || event === 'INITIAL_SESSION') return;
    if ((session?.user?.id ?? null) !== (user?.id ?? null)) {
      // Callback must return before another Auth operation is started.
      ++epoch; concealBoard(); root.replaceChildren();
      clearCharacters();
      setTimeout(() => { if (!destroyed) void load(); }, 0);
    }
  }).data.subscription;
  const hashChanged = () => { void load(); };
  window.addEventListener('hashchange', hashChanged);
  window.addEventListener('pagehide', () => { clearTimeout(timer); clearCharacters(); });
  window.addEventListener('pageshow', event => { if (event.persisted) void load(); });
  void load();
  return () => { destroyed = true; ++epoch; clearCharacters(); clearTimeout(timer); subscription.unsubscribe(); window.removeEventListener('hashchange', hashChanged); back.remove(); };
}
