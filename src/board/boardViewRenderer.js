/**
 * Shared, dependency-free renderer for every player-facing board projection: the real Player
 * Screen and the DM's Player View preview both call this with the same deriveDisplayView(view,
 * 'player') input. Reuses the exact class names/dataset attributes script.js's own DM-side
 * renderer already uses, so the existing, unmodified wireRealtimeBoardActions (bound on
 * `document` by default) wires up any buttons rendered here with no further work.
 *
 * Manage-only controls and the DM section are gated on BOTH presentationMode === 'dm' AND the
 * relevant displayView field — this double condition (not just authority.canManage, unlike
 * script.js's own renderer) is what lets a DM's "preview as player" mode hide these controls
 * without touching authority at all.
 *
 * `options.interactionMode` ('interactive', the default, or 'readOnly') is a second, independent
 * gate, added by the post-review corrective pass: independent review found that own-character HP
 * controls rendered whenever `authority.ownCharacterId` matched a character, regardless of
 * presentationMode — so a DM's manager-shaped preview view (which legitimately has
 * `authority.canManage: true` and, adversarially, could carry any `ownCharacterId`) was never
 * structurally guaranteed to be free of actionable `[data-realtime-action]` controls. With
 * `interactionMode: 'readOnly'`, this function renders ZERO `[data-realtime-action]` elements of
 * any kind — no manage controls, no own-character HP controls — no matter what `authority`
 * contains. `authority` itself is never read for this decision beyond the existing
 * presentationMode/canManage gate; `interactionMode` is a rendering-only concern, never a change
 * to authority.
 *
 * Elements are created via container.ownerDocument (never the bare global `document`) so this
 * module works against any document a caller's container belongs to, including a detached jsdom
 * document in tests.
 *
 * Issue #10 Task 4: whenever `displayView.fog` is present, `presentationMode === 'player'` also
 * mounts the shared player fog stage via `fogRenderer.buildPlayerFogStage` — the same call for
 * both the real Player Screen and the DM's read-only Player Preview, since both reach this
 * function with `presentationMode: 'player'`. This is deliberately gated on `presentationMode`,
 * not `interactionMode`: fog concealment applies to a real interactive player exactly as much as
 * to the DM's read-only preview of what a player sees. `presentationMode: 'dm'` never mounts it —
 * the DM's own live board is the separate, unmodified legacy `script.js` board, not this renderer.
 */

import { buildPlayerFogStage } from '../fog/fogRenderer.js';

// Final corrective pass (scroll persistence): remembers, per container, the last active tokenId
// AND the logical context (session + active level) that container was last rendered for. Keyed by
// container (not module-global) because the real Player Screen panel and the DM's read-only
// preview panel are two independent containers that can both be mounted at once, and must never
// share state. `activeTokenId` alone (the previous corrective pass's version of this map) is
// reused for the existing "only auto-scroll when the active combatant actually changed" gate;
// `contextKey` is new and gates scroll-offset RESTORATION specifically — see renderBoardView.
const containerContextByContainer = new WeakMap();

function contextKeyFor(displayView) {
  return `${displayView.sessionId ?? ''}:${displayView.session?.activeLevelId ?? ''}`;
}

function captureListScrollOffsets(container) {
  return {
    tokens: container.querySelector('.realtime-token-list')?.scrollTop ?? 0,
    characters: container.querySelector('.realtime-character-list')?.scrollTop ?? 0,
    initiative: container.querySelector('.realtime-initiative-list')?.scrollTop ?? 0,
  };
}

function createActionButton(doc, action, label, dataset = {}) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'realtime-action-button';
  button.dataset.realtimeAction = action;
  Object.entries(dataset).forEach(([key, value]) => { button.dataset[key] = value; });
  button.textContent = label;
  return button;
}

function createRailCountHeader(doc, label, count) {
  const header = doc.createElement('div');
  header.className = 'realtime-rail-count';
  header.textContent = `${label} · ${count}`;
  return header;
}

// Corrective pass: the server orders `tokens` by id (an unordered UUID), so bosses are not
// naturally first. Mirrors script.js's own TOKEN_TYPES.priority for the legacy board — same
// product ordering (bosses, then enemies, then NPCs), applied here purely for display.
const KIND_PRIORITY = { boss: 0, enemy: 1, npc: 2, player: 3 };

function sortTokensForDisplay(tokens) {
  return [...tokens].sort((a, b) => {
    const priorityDiff = (KIND_PRIORITY[a.kind] ?? 9) - (KIND_PRIORITY[b.kind] ?? 9);
    if (priorityDiff !== 0) return priorityDiff;
    // Numeric-suffix compare, not string compare — "E2" must sort before "E10".
    const aNumber = Number((a.label ?? '').match(/\d+$/)?.[0] ?? 0);
    const bNumber = Number((b.label ?? '').match(/\d+$/)?.[0] ?? 0);
    return aNumber !== bNumber ? aNumber - bNumber : (a.label ?? '').localeCompare(b.label ?? '');
  });
}

function renderTokenRow(doc, token, canManageHere, isActive) {
  const row = doc.createElement('li');
  row.className = 'realtime-token-row';
  row.classList.toggle('active-combatant', isActive);
  row.dataset.tokenId = token.id;

  const label = doc.createElement('span');
  label.className = 'realtime-token-label';
  label.textContent = token.label ?? '';

  const kind = doc.createElement('span');
  kind.className = 'realtime-token-kind';
  kind.textContent = token.kind ?? '';

  row.append(label, kind);

  if (token.conditionLabel) {
    const condition = doc.createElement('span');
    condition.className = 'realtime-token-condition';
    condition.textContent = token.conditionLabel;
    row.appendChild(condition);
  }

  if (canManageHere) {
    row.appendChild(createActionButton(
      doc,
      'toggle-token-visible',
      token.isVisible ? 'Hide from players' : 'Reveal to players',
      { tokenId: token.id }
    ));
  }

  return row;
}

function renderCharacterCard(doc, character, authority, readOnly) {
  const card = doc.createElement('li');
  card.className = 'realtime-character-card';
  card.dataset.characterId = character.id;

  const name = doc.createElement('h4');
  name.textContent = character.name ?? '';

  const meta = doc.createElement('p');
  meta.textContent = `${character.playerName ?? ''} · HP ${character.hp ?? '—'}/${character.maxHp ?? '—'} · AC ${character.ac ?? '—'}`;

  card.append(name, meta);

  if (Array.isArray(character.statuses) && character.statuses.length) {
    const statuses = doc.createElement('p');
    statuses.className = 'realtime-character-statuses';
    statuses.textContent = character.statuses.join(', ');
    card.appendChild(statuses);
  }

  if (!readOnly && authority?.ownCharacterId && authority.ownCharacterId === character.id) {
    const hpControls = doc.createElement('div');
    hpControls.className = 'realtime-character-hp-controls';
    hpControls.append(
      createActionButton(doc, 'adjust-own-hp', '-1 HP', { characterId: character.id, delta: '-1' }),
      createActionButton(doc, 'adjust-own-hp', '+1 HP', { characterId: character.id, delta: '1' })
    );
    card.appendChild(hpControls);
  }

  return card;
}

function renderInitiativeRow(doc, entry) {
  const row = doc.createElement('li');
  row.className = 'realtime-initiative-row';
  if (entry.isActive) {
    row.classList.add('active-combatant');
  }
  row.textContent = `${entry.initiative ?? '—'} — ${entry.tokenId ?? ''}`;
  return row;
}

/**
 * @param {HTMLElement} container Caller-owned. Only ever sets container.hidden and replaces its children.
 * @param {import('../realtime/boardBridge.js').BoardView|null} displayView Already the output of
 *   deriveDisplayView — this function does not call deriveDisplayView itself.
 * @param {{ presentationMode: 'dm'|'player', interactionMode?: 'interactive'|'readOnly' }} options
 */
export function renderBoardView(container, displayView, options) {
  const { presentationMode, interactionMode = 'interactive' } = options;
  const doc = container.ownerDocument;
  const readOnly = interactionMode === 'readOnly';

  if (displayView == null) {
    container.hidden = true;
    container.innerHTML = '';
    // Teardown/access-loss: this container may be reused later (e.g. dm-screen.js's preview
    // panel is hidden+cleared, not disposed) for a session this viewer may not even be the same
    // recipient of any more. Never let a torn-down context's scroll/active state leak forward.
    containerContextByContainer.delete(container);
    return;
  }

  const contextKey = contextKeyFor(displayView);
  const previous = containerContextByContainer.get(container);
  // Restoring a manual scroll offset only makes sense across a rerender of the SAME logical
  // view (same session, same active level, same container) — never across a genuinely different
  // context (a different session/level, or this container's first render since being torn down),
  // where the old encounter's scroll position has nothing to do with the new one.
  const sameContext = previous?.contextKey === contextKey;
  const scrollToRestore = sameContext ? captureListScrollOffsets(container) : null;

  container.hidden = false;
  container.innerHTML = '';

  const { roundNumber, tokens, characters, initiative, authority, dm, fog } = displayView;
  const canManageHere = !readOnly && presentationMode === 'dm' && Boolean(authority?.canManage);
  // Only ever a tokenId — characters have no initiative entry of their own in this data model
  // (see boardBridge.js), so active-turn auto-scroll only ever applies to the token list.
  const activeTokenId = (initiative || []).find(entry => entry.isActive)?.tokenId;

  const heading = doc.createElement('h3');
  heading.textContent = `Online session — Round ${roundNumber ?? '—'}`;
  container.appendChild(heading);

  if (presentationMode === 'player' && fog) {
    const stage = buildPlayerFogStage(doc, fog);
    if (stage) container.appendChild(stage);
  }

  if (canManageHere) {
    container.appendChild(createActionButton(doc, 'advance-round', 'Advance round'));
  }

  if ((tokens || []).length > 0) {
    container.appendChild(createRailCountHeader(doc, 'Opponents', tokens.length));
  }

  const tokenList = doc.createElement('ul');
  tokenList.className = 'realtime-token-list';
  sortTokensForDisplay(tokens || []).forEach(token => tokenList.appendChild(
    renderTokenRow(doc, token, canManageHere, token.id === activeTokenId)
  ));
  container.appendChild(tokenList);

  if ((characters || []).length > 0) {
    container.appendChild(createRailCountHeader(doc, 'Players', characters.length));
  }

  const characterList = doc.createElement('ul');
  characterList.className = 'realtime-character-list';
  (characters || []).forEach(character => characterList.appendChild(renderCharacterCard(doc, character, authority, readOnly)));
  container.appendChild(characterList);

  if (canManageHere) {
    container.appendChild(createActionButton(doc, 'clear-initiative', 'Clear initiative'));
  }

  const initiativeList = doc.createElement('ol');
  initiativeList.className = 'realtime-initiative-list';
  (initiative || []).forEach(entry => initiativeList.appendChild(renderInitiativeRow(doc, entry)));
  container.appendChild(initiativeList);

  if (!readOnly && presentationMode === 'dm' && dm) {
    const dmSection = doc.createElement('section');
    dmSection.className = 'realtime-dm-section';
    dmSection.setAttribute('aria-label', 'DM-only projection');

    const dmHeading = doc.createElement('h4');
    dmHeading.textContent = 'DM view';
    dmSection.appendChild(dmHeading);

    container.appendChild(dmSection);
  }

  // Priority 1 (same context, same active combatant): restore the manual scroll offset the user
  // left each list at. Setting scrollTop past a list's current max clamps to it natively — a
  // shrunk list (an opponent removed) just settles at its new bottom, no extra code needed.
  if (scrollToRestore) {
    tokenList.scrollTop = scrollToRestore.tokens;
    characterList.scrollTop = scrollToRestore.characters;
    initiativeList.scrollTop = scrollToRestore.initiative;
  }

  // Priority 2 (active combatant changed): only scroll when the active combatant actually
  // changed since this container's last render (never on every re-render — an HP tick or fog
  // edit must not smooth-scroll the screen) — and only after the offset restore above, so this
  // nudges the freshly-restored position the minimum amount needed, never re-centers it. Looking
  // the row up on `container` (this render's own freshly-built DOM) rather than acting on
  // `activeTokenId` directly means a hidden/unauthorized token can never be scrolled to: if
  // deriveDisplayView filtered it out, tokenList never contains a matching row and this is a
  // no-op, so becoming active never reveals it.
  if (activeTokenId !== undefined && activeTokenId !== previous?.activeTokenId) {
    Array.from(tokenList.children)
      .find(row => row.dataset.tokenId === activeTokenId)
      ?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  containerContextByContainer.set(container, { contextKey, activeTokenId });
}
