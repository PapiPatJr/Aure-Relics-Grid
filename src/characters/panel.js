import { createCharacterService, validatePortrait } from './service.js';
const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const button = (action, label, id = '') => `<button type="button" data-character-action="${action}" data-id="${e(id)}">${label}</button>`;
const input = (name, label, value = '', extra = '') => `<label>${label}<input name="${name}" value="${e(value)}" ${extra}></label>`;

/** Session-scoped UI. The server checks identity and authority on every operation. */
export function mountCharacters(root, client, { session, host, displayName = '' }) {
  const api = createCharacterService(client);
  let data, disposed = false, busy = false, dirty = false, generation = 0, imageGeneration = 0, signature = '', own;
  const urls = new Set();
  function releaseImages() { ++imageGeneration; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
  function message(text, error = false) {
    const target = root.querySelector('[data-character-notice]');
    if (target) { target.textContent = text; target.classList.toggle('entry-error', error); }
  }
  function fields(c = {}) {
    return `${input('name', 'Character name', c.name, 'required maxlength="80"')}${input('player_name', 'Player name', c.player_name ?? displayName, 'required maxlength="80"')}<div class="character-stats">${[['hp', 'Current HP', 0, -999, 9999], ['max_hp', 'Maximum HP', 0, 0, 9999], ['temp_hp', 'Temporary HP', 0, 0, 9999], ['ac', 'Armor class', 10, 0, 99], ['speed', 'Speed', 30, 0, 999]].map(([key, label, value, min, max]) => input(key, label, c[key] ?? value, `type="number" required min="${min}" max="${max}" step="1"`)).join('')}</div>${input('statuses', 'Statuses (comma-separated)', (c.statuses || []).join(', '), 'maxlength="1219"')}<label>Shared character notes<textarea name="notes" maxlength="2000" rows="3">${e(c.public_notes)}</textarea></label><p class="entry-muted">These notes are shared with your DM. Keep private information out.</p>`;
  }
  function imagePicker() { return '<label>Character portrait<input name="portrait" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="entry-muted">PNG, JPEG or WebP, up to 5 MiB. Guests upload once; your DM can replace a portrait.</p><img class="character-portrait" data-image-preview hidden alt="Selected portrait preview">'; }
  function card(c) {
    return `<article class="character-card" data-character-id="${e(c.id)}"><div class="entry-section-head"><h3>${e(c.name)}</h3><span class="entry-badge">${c.approved ? 'Character approved' : 'Awaiting character approval'}</span></div><p>${e(c.player_name)} · ${e((c.assignments || []).map(a => a.display_name).join(', ') || 'Unassigned')}</p>${c.image_path ? `<img class="character-portrait" data-portrait="${e(c.id)}" alt="Portrait of ${e(c.name)}"><p data-image-error="${e(c.id)}" role="status"></p>` : '<p class="entry-muted">No portrait yet.</p>'}<details><summary>Edit character</summary><form data-character-form="edit" data-id="${e(c.id)}">${fields(c)}<button type="submit">Save character</button></form></details>${host || !c.image_path ? `<details><summary>${c.image_path ? 'Replace portrait' : 'Add portrait'}</summary><form data-character-form="image" data-id="${e(c.id)}">${imagePicker()}<button type="submit">${c.image_path ? 'Replace portrait' : 'Upload portrait'}</button>${button('link-image', 'Retry linking uploaded portrait', c.id)}</form></details>` : ''}${host ? `<div class="entry-actions">${c.approved ? button('issue', 'Generate / replace character code', c.id) + button('revoke', 'Revoke character code', c.id) + button('unapprove', 'Withdraw character approval', c.id) : button('approve', 'Approve & issue code', c.id)}</div>${c.approved ? `<details><summary>Recover / reassign character</summary><p>Transfers control to an approved player in this session and revokes the old character code. Their previous character will remain saved.</p><form data-character-form="assign" data-id="${e(c.id)}"><label>Assign to player<select name="player" required><option value="">Choose a player</option>${data.players.map(p => `<option value="${e(p.user_id)}">${e(p.display_name)}</option>`).join('')}</select></label><button type="submit">Reassign character</button></form></details>` : ''}` : ''}<p class="entry-muted">Created ${e(c.created_at ? new Date(c.created_at).toLocaleString() : '')} · Updated ${e(c.updated_at ? new Date(c.updated_at).toLocaleString() : '')}</p></article>`;
  }
  function render() {
    releaseImages();
    root.innerHTML = `<section class="entry-panel character-panel"><p class="entry-eyebrow">CAMPAIGN CHARACTERS</p><h2>${host ? 'Your campaign characters' : 'Your character'}</h2><p>${host ? 'Review submissions, manage portraits and help returning players recover their characters.' : 'Your character stays with this campaign. Character approval is separate from your seat at the table.'}</p><div data-character-notice role="status" aria-live="polite"></div><div data-issued-code></div>${data.characters.length ? data.characters.map(card).join('') : host ? '<p>No characters submitted yet.</p>' : `<details open><summary>Create your character</summary><form data-character-form="create">${fields()}${imagePicker()}<button type="submit" class="entry-primary">Submit character</button></form></details><details><summary>Reclaim a saved character</summary><p>Ask your DM for your character code. A valid code transfers control to this guest identity. Codes expire after 30 days.</p><form data-character-form="reclaim">${input('character_code', 'Character reclaim code', '', 'required autocomplete="off" autocapitalize="off" spellcheck="false"')}<button type="submit">Reclaim character</button></form></details>`}<div class="entry-actions">${button('refresh', 'Refresh characters')}</div></section>`;
    void loadPortraits(imageGeneration);
  }
  async function loadPortraits(stamp) {
    for (const c of data.characters.filter(c => c.image_path)) {
      try {
        const blob = await api.portrait(c.image_path, c.updated_at);
        if (disposed || stamp !== imageGeneration) return;
        const img = root.querySelector(`[data-portrait="${c.id}"]`);
        if (img) { const url = URL.createObjectURL(blob); urls.add(url); img.src = url; }
      } catch (error) {
        if (!disposed && stamp === imageGeneration) { const target = root.querySelector(`[data-image-error="${c.id}"]`); if (target) target.textContent = error.message; }
      }
    }
  }
  async function refresh(force = false) {
    if (disposed || busy) return;
    const stamp = ++generation;
    try {
      const next = await api.panel(session);
      if (disposed || stamp !== generation) return;
      if (!next || !Array.isArray(next.characters)) throw new Error('Unable to verify character access.');
      const changedOwner = own !== next.own_character_id;
      const nextSignature = JSON.stringify(next);
      data = next;
      if (force || changedOwner || (!dirty && signature !== nextSignature)) {
        dirty = false; signature = nextSignature; own = next.own_character_id; render();
      }
    } catch (error) {
      if (disposed || stamp !== generation) return;
      releaseImages(); dirty = false; data = null; signature = ''; own = undefined;
      root.innerHTML = `<section class="entry-panel"><h2>Characters unavailable</h2><p role="status">${e(error.message)}</p>${button('refresh', 'Retry characters')}</section>`;
    }
  }
  function showCode(code) {
    const target = root.querySelector('[data-issued-code]');
    if (!target) return;
    target.innerHTML = `<div class="character-code"><label>Issued character reclaim code<input data-character-secret readonly value="${e(code)}" autocomplete="off"></label><p>Share privately with this character’s player. Anyone holding this code can reclaim the character after session approval. Expires in 30 days. It is only shown here now.</p>${button('copy', 'Copy character code')}${button('hide', 'Hide character code')}</div>`;
  }
  async function run(action) {
    if (busy || disposed) return;
    busy = true; const stamp = generation;
    root.setAttribute('aria-busy', 'true');
    root.querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = true; });
    message('Working…');
    try { await action(() => !disposed && generation === stamp); }
    catch (error) { if (!disposed && generation === stamp) message(error.message || 'Unable to continue. Try again.', true); }
    finally { busy = false; if (!disposed) { root.setAttribute('aria-busy', 'false'); root.querySelectorAll('button,input,textarea,select').forEach(el => { el.disabled = false; }); } }
  }
  async function reloadAfter(valid, text, code) {
    if (!valid()) return;
    busy = false; await refresh(true); busy = true;
    if (!disposed) { message(text); if (code) showCode(code); }
  }
  async function submit(event) {
    const form = event.target.closest('[data-character-form]'); if (!form) return;
    event.preventDefault();
    const values = Object.fromEntries(new root.ownerDocument.defaultView.FormData(form));
    const id = form.dataset.id;
    void run(async valid => {
      const kind = form.dataset.characterForm;
      if (kind === 'create') {
        const file = values.portrait?.size ? values.portrait : null;
        if (file) validatePortrait(file);
        const created = await api.create(session, values);
        if (!valid()) return;
        let text = 'Character submitted for DM approval.';
        if (file) {
          try { await api.upload(session, data.campaign_id, created, file); }
          catch (error) { text += ` Portrait not linked: ${error.message} Use Add portrait or Retry linking uploaded portrait.`; }
        }
        await reloadAfter(valid, text);
      } else if (kind === 'edit') {
        await api.update(session, id, values); await reloadAfter(valid, 'Character saved.');
      } else if (kind === 'reclaim') {
        await api.reclaim(session, data.campaign_id, values.character_code);
        if (valid()) form.reset();
        await reloadAfter(valid, 'Character reclaimed.');
      } else if (kind === 'assign') {
        await api.assign(session, id, values.player); await reloadAfter(valid, 'Character reassigned. Previous character code revoked. Issue a fresh code if needed.');
      } else if (kind === 'image') {
        const c = data.characters.find(c => c.id === id);
        await api.upload(session, data.campaign_id, id, values.portrait, host && !!c.image_path);
        await reloadAfter(valid, 'Portrait saved.');
      }
    });
  }
  function click(event) {
    const el = event.target.closest('[data-character-action]'); if (!el) return;
    const action = el.dataset.characterAction, id = el.dataset.id;
    if (action === 'refresh') { dirty = false; void refresh(true); return; }
    if (action === 'hide') { root.querySelector('[data-issued-code]')?.replaceChildren(); return; }
    void run(async valid => {
      if (action === 'copy') {
        const input = root.querySelector('[data-character-secret]');
        try { await navigator.clipboard.writeText(input.value); if (valid()) message('Character code copied. Share privately.'); }
        catch { if (valid()) { input.disabled = false; input.focus(); input.select(); message('Select and copy the highlighted character code.'); } }
      } else if (action === 'approve' || action === 'issue') {
        root.querySelector('[data-issued-code]')?.replaceChildren();
        if (action === 'approve') await api.review(id, true);
        if (!valid()) return;
        const code = await api.issue(data.campaign_id, id);
        await reloadAfter(valid, 'New character code issued. Earlier codes are invalid.', code);
      } else if (action === 'revoke' || action === 'unapprove') {
        root.querySelector('[data-issued-code]')?.replaceChildren();
        if (action === 'revoke') await api.revoke(id); else await api.review(id, false);
        await reloadAfter(valid, action === 'revoke' ? 'Character code revoked.' : 'Character approval withdrawn; code revoked.');
      } else if (action === 'link-image') {
        await api.linkImage(session, id); await reloadAfter(valid, 'Uploaded portrait linked.');
      }
    });
  }
  function changed(event) {
    dirty = true;
    if (event.target.name !== 'portrait') return;
    const img = event.target.closest('form').querySelector('[data-image-preview]');
    if (img.src) { URL.revokeObjectURL(img.src); urls.delete(img.src); } img.removeAttribute('src'); img.hidden = true;
    const file = event.target.files?.[0]; if (!file) return;
    try { validatePortrait(file); const url = URL.createObjectURL(file); urls.add(url); img.src = url; img.hidden = false; }
    catch (error) { event.target.value = ''; message(error.message, true); }
  }
  root.addEventListener('submit', submit); root.addEventListener('click', click); root.addEventListener('input', changed);
  root.innerHTML = '<p role="status">Loading campaign characters…</p>';
  void refresh();
  return { refresh, dispose() { disposed = true; ++generation; releaseImages(); root.replaceChildren(); root.removeEventListener('submit', submit); root.removeEventListener('click', click); root.removeEventListener('input', changed); } };
}
