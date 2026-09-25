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
 */

function createActionButton(doc, action, label, dataset = {}) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'realtime-action-button';
  button.dataset.realtimeAction = action;
  Object.entries(dataset).forEach(([key, value]) => { button.dataset[key] = value; });
  button.textContent = label;
  return button;
}

function renderTokenRow(doc, token, canManageHere) {
  const row = doc.createElement('li');
  row.className = 'realtime-token-row';
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
    return;
  }

  container.hidden = false;
  container.innerHTML = '';

  const { roundNumber, tokens, characters, initiative, authority, dm } = displayView;
  const canManageHere = !readOnly && presentationMode === 'dm' && Boolean(authority?.canManage);

  const heading = doc.createElement('h3');
  heading.textContent = `Online session — Round ${roundNumber ?? '—'}`;
  container.appendChild(heading);

  if (canManageHere) {
    container.appendChild(createActionButton(doc, 'advance-round', 'Advance round'));
  }

  const tokenList = doc.createElement('ul');
  tokenList.className = 'realtime-token-list';
  (tokens || []).forEach(token => tokenList.appendChild(renderTokenRow(doc, token, canManageHere)));
  container.appendChild(tokenList);

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
}
