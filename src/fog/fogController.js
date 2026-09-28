/**
 * DM Fog Mode controller (Issue #10 Task 6). Composes the existing 10C mutation bridge
 * (`fogMutations.js`) and the existing 10E editor (`fogEditor.js`) into one DM-facing toolbar and
 * wires them to the app's single, already-created realtime session engine — this module never
 * creates an engine, adapter, subscription or Supabase client itself, and there is exactly one
 * live session engine/lifecycle in the app regardless of whether Fog Mode is active.
 *
 * `render(view)` is fed every authoritative manager `BoardView` from the same snapshot pipeline
 * the rest of the DM board already renders from (see `src/entry/app.js`); this module never
 * hydrates or requests state on its own. Fog controls render only for a manager-shaped view
 * (`view.authority.canManage`); a player-shaped or `null` (denied) view hides everything.
 *
 * Every mutation this controller issues reads its target ids (`levelId`, `locationId`) from the
 * most recently rendered manager view or the stroke payload the editor itself captured at
 * pointerdown — never by inferring an id from DOM text/attributes, and never by guessing from the
 * currently-presented route.
 */
import { createFogMutationBridge } from './fogMutations.js';
import { createFogEditor } from './fogEditor.js';
import { collapseCells, BRUSH_SIZES } from './fogMask.js';

const DISABLE_FOG_MESSAGE = 'Disabling fog makes the entire base map visible to players immediately. '
  + 'DM-hidden creatures, objects, and other concealed elements stay hidden — disabling fog does not '
  + 'reveal them. Your current revealed/hidden cell data is preserved and will be restored exactly as '
  + 'it is now if you re-enable fog.';

function isManagerView(view) {
  return Boolean(view && view.authority && view.authority.canManage === true);
}

/** Expand an area's compact `[y, xStartInclusive, xEndExclusive]` cellRuns into `[x, y]` pairs, for
 * initializing the local edit selection only (design §3.2 / plan step 6.4). Not a security
 * boundary — malformed entries are simply skipped rather than validated strictly. */
function expandCellRuns(cellRuns) {
  const cells = [];
  if (!Array.isArray(cellRuns)) return cells;
  for (const run of cellRuns) {
    if (!Array.isArray(run) || run.length !== 3) continue;
    const [y, xStart, xEnd] = run;
    if (!Number.isInteger(y) || !Number.isInteger(xStart) || !Number.isInteger(xEnd) || xStart >= xEnd) continue;
    for (let x = xStart; x < xEnd; x += 1) cells.push([x, y]);
  }
  return cells;
}

function overrideToSelectValue(override) {
  if (override === true) return 'on';
  if (override === false) return 'off';
  return 'inherit';
}

function selectValueToOverride(value) {
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/**
 * @param {{
 *   engine: ReturnType<import('../realtime/engine.js').createSyncEngine>,
 *   getSessionId: () => string|null,
 *   getView: () => object|null,
 *   frame: HTMLElement,
 *   grid: HTMLElement,
 *   host: HTMLElement,
 *   confirmAction: (request: { action: string, message: string }) => boolean|Promise<boolean>,
 *   onResult?: (result: object) => void,
 * }} args
 */
export function createFogController({ engine, getSessionId, getView, frame, grid, host, confirmAction, onResult = () => {} }) {
  if (!engine || typeof getSessionId !== 'function' || typeof getView !== 'function' || !frame || !grid || !host || typeof confirmAction !== 'function') {
    throw new TypeError('createFogController requires { engine, getSessionId, getView, frame, grid, host, confirmAction }');
  }

  const doc = host.ownerDocument;
  const bridge = createFogMutationBridge(engine);

  let disposed = false;
  let presentationMode = 'dm'; // 'dm' | 'player'
  let editorActive = false; // local "Fog Mode" paint toggle, independent of controller activate()/deactivate()
  let tool = 'reveal';
  let brushSize = 1;
  let opacity = 1;

  // Named-area draft: purely local until Save (design §3.2 / plan step 6.4). `levelId` is captured
  // when the draft starts so a mid-edit render() for a different level can never redirect a Save.
  let draft = null; // { areaId: string|null, levelId: string, name: string, cells: Map<string,[number,number]>, revealedByDefault: boolean }

  // Narrowest possible pending-action guard (10F-FIX1 defect 3): each broad, confirmation-gated
  // mutation gets its own key so at most one confirm/mutate cycle for that specific action can be
  // in flight at a time. This is controller-local state, not a new request architecture/queue.
  const pendingBroadActions = new Set();

  let root = null;
  let els = null; // cached control references, built once with the root

  const editor = createFogEditor({ frame, grid, onStroke: handleStroke });

  /** The single authoritative manager-authority gate (10F-FIX2): returns the current view only if
   * it currently carries manager authority, else `null`. Every mutation path is required to check
   * this — never toolbar visibility, never `presentationMode`, and never authority captured at an
   * earlier point such as when a click originally occurred — because none of those track whether
   * manager authority still holds *right now*. */
  function currentManagerView() {
    const view = getView();
    return isManagerView(view) ? view : null;
  }

  /** Every controller mutation funnels through here, so gating authority in this one place is what
   * makes the boundary systemic rather than per-control: a retained handler fired after demotion,
   * or a confirmation that resolves after authority was already lost, both dead-end here with zero
   * mutation (10F-FIX2). This re-check is deliberately redundant with any earlier check a caller
   * already performed — it is the last line of defense right before the network call. */
  async function submit(mutateFn, type) {
    if (!currentManagerView()) return;
    const sessionId = getSessionId();
    if (!sessionId) return;
    const context = engine.getContext?.();
    const result = await mutateFn(sessionId);
    if (disposed) return;
    if (context === engine.getContext?.() && sessionId === getSessionId()) {
      onResult({ type, ...result });
    }
  }

  function currentLevelId() {
    return getView()?.fog?.levelId ?? null;
  }

  function currentLocationId() {
    return getView()?.dm?.fog?.locationId ?? null;
  }

  function handleStroke(stroke) {
    if (presentationMode !== 'dm') return; // structural safety, not just a hidden control (10F)
    if (stroke.purpose === 'area') {
      if (!draft) return; // stray report from a purpose the draft workflow already left
      for (const [x, y] of stroke.cells) {
        const key = `${x},${y}`;
        if (stroke.action === 'add') draft.cells.set(key, [x, y]);
        else draft.cells.delete(key);
      }
      editor.setSelectedCells(Array.from(draft.cells.values()));
      return;
    }
    void submit(sessionId => bridge.paint(sessionId, { levelId: stroke.levelId, mode: stroke.mode, cells: stroke.cells }), 'fog.paint');
  }

  // --- named-area draft workflow -----------------------------------------------------------

  function startDraft(existingArea) {
    const levelId = currentLevelId();
    draft = existingArea
      ? {
        areaId: existingArea.id,
        levelId: existingArea.levelId ?? levelId,
        name: existingArea.name ?? '',
        cells: new Map(expandCellRuns(existingArea.cellRuns).map(cell => [`${cell[0]},${cell[1]}`, cell])),
        revealedByDefault: Boolean(existingArea.revealedByDefault),
      }
      : { areaId: null, levelId, name: '', cells: new Map(), revealedByDefault: false };
    editor.setPurpose('area');
    editor.setSelectedCells(Array.from(draft.cells.values()));
    if (!editorActive) {
      editorActive = true;
      editor.setActive(true);
      if (els) els.toggle.textContent = 'Exit Fog Mode';
    }
    renderAreaEditor();
  }

  function endDraft() {
    draft = null;
    editor.setPurpose('fog');
    editor.setSelectedCells([]);
    renderAreaEditor();
  }

  function saveDraft() {
    if (!draft) return;
    const { areaId, levelId, revealedByDefault } = draft;
    const name = els.areaName.value;
    const cells = collapseCells(Array.from(draft.cells.values()));
    if (areaId === null) {
      void submit(sessionId => bridge.createArea(sessionId, { levelId, name, cells, revealedByDefault }), 'fog.area.create');
    } else {
      void submit(sessionId => bridge.updateArea(sessionId, { levelId, areaId, name, cells, revealedByDefault }), 'fog.area.update');
    }
    endDraft();
  }

  /** Delete Area's target context is `{ areaId, levelId }`, captured before the confirmation gap
   * exactly like `runLevelScopedBroadAction` captures a broad action's `levelId` (10F-FIX3). If the
   * area object already carries a server-provided `levelId`, it is trusted only when it agrees with
   * the current authoritative manager view — never taken on faith over the authoritative context.
   * After the confirmation resolves, authority and that captured `levelId` are both revalidated
   * against the *current* view before `submit()`: a stale Level A delete whose authoritative context
   * has since moved to Level B aborts with zero mutation instead of deleting Area A under Level B's
   * (or anyone's) authority, rather than silently retargeting. */
  async function deleteArea(area) {
    const managerView = currentManagerView();
    if (!managerView) return; // pre-confirm authority check
    const authoritativeLevelId = managerView.fog?.levelId ?? null;
    if (area.levelId != null && area.levelId !== authoritativeLevelId) return; // area does not belong to the current authoritative level; not a valid target
    const levelId = area.levelId ?? authoritativeLevelId;
    const confirmed = await confirmAction({ action: 'area-delete', message: `Delete the named area "${area.name}"? This removes the saved selection but does not change current fog visibility.` });
    if (!confirmed) return;
    const stillManagerView = currentManagerView();
    if (!stillManagerView || (stillManagerView.fog?.levelId ?? null) !== levelId) return; // post-confirm authority + context check
    void submit(sessionId => bridge.deleteArea(sessionId, { levelId, areaId: area.id }), 'fog.area.delete');
  }

  function setAreaVisibility(area, revealed) {
    void submit(sessionId => bridge.setAreaVisibility(sessionId, { levelId: area.levelId ?? currentLevelId(), areaId: area.id, revealed }), 'fog.area.setVisibility');
  }

  // --- broad actions --------------------------------------------------------------------------

  /** Run `action` under a per-key pending guard: while a confirm/mutate cycle for `key` is still
   * in flight, a repeat invocation is a no-op rather than opening a second confirmation or mutation
   * (10F-FIX1 defect 3). The guard clears once `action` settles (confirmed-and-mutated, declined,
   * or thrown), after which the action may run again normally. */
  async function runPendingGuarded(key, action) {
    if (pendingBroadActions.has(key)) return;
    pendingBroadActions.add(key);
    try {
      await action();
    } finally {
      pendingBroadActions.delete(key);
    }
  }

  /** Runs a level-scoped broad action (Reveal All / Hide All / Reset) under the per-key pending
   * guard. Manager authority is checked before the confirmation is even opened, and the
   * authoritative `levelId` is captured at that same moment rather than re-read later. After the
   * confirmation resolves, both authority and that captured `levelId` are revalidated against the
   * *current* view before the single `submit()` call: if authority is gone, or the authoritative
   * level has moved to a different one while the confirmation was open, the action aborts with zero
   * mutation instead of silently mutating the wrong level (10F-FIX2 defects 1 and 2 for broad
   * actions). */
  async function runLevelScopedBroadAction(key, message, mutate, type) {
    await runPendingGuarded(key, async () => {
      const managerView = currentManagerView();
      if (!managerView) return; // pre-confirm authority check
      const levelId = managerView.fog?.levelId ?? null;
      const confirmed = await confirmAction({ action: key, message });
      if (!confirmed) return;
      const stillManagerView = currentManagerView();
      if (!stillManagerView || (stillManagerView.fog?.levelId ?? null) !== levelId) return; // post-confirm authority + context check
      await submit(sessionId => mutate(sessionId, levelId), type);
    });
  }

  async function revealAll() {
    await runLevelScopedBroadAction('reveal-all', 'Reveal the entire level to players? This immediately exposes the whole map.', (sessionId, levelId) => bridge.revealAll(sessionId, { levelId }), 'fog.revealAll');
  }

  async function hideAll() {
    await runLevelScopedBroadAction('hide-all', 'Hide the entire level from players? This immediately conceals the whole map.', (sessionId, levelId) => bridge.hideAll(sessionId, { levelId }), 'fog.hideAll');
  }

  async function resetDefaults() {
    await runLevelScopedBroadAction('reset', 'Reset fog to its configured defaults? This restores the starting Hidden/Revealed layout for this level and cannot be undone.', (sessionId, levelId) => bridge.resetDefaults(sessionId, { levelId }), 'fog.resetDefaults');
  }

  async function disableCampaignFog() {
    await runPendingGuarded('disable-campaign', async () => {
      if (!currentManagerView()) return; // pre-confirm authority check
      const confirmed = await confirmAction({ action: 'disable-campaign', message: DISABLE_FOG_MESSAGE });
      if (!confirmed) return;
      if (!currentManagerView()) return; // post-confirm authority check
      await submit(sessionId => bridge.setCampaignEnabled(sessionId, { enabled: false }), 'fog.setCampaignEnabled');
    });
  }

  function enableCampaignFog() {
    // No exposure confirmation: enabling restores the stored mask rather than exposing anything.
    void submit(sessionId => bridge.setCampaignEnabled(sessionId, { enabled: true }), 'fog.setCampaignEnabled');
  }

  function setLocationOverride(value) {
    const enabled = selectValueToOverride(value);
    void submit(sessionId => bridge.setLocationOverride(sessionId, { locationId: currentLocationId(), enabled }), 'fog.setLocationOverride');
  }

  function setLevelOverride(value) {
    const enabled = selectValueToOverride(value);
    void submit(sessionId => bridge.setLevelOverride(sessionId, { levelId: currentLevelId(), enabled }), 'fog.setLevelOverride');
  }

  // --- DOM construction ------------------------------------------------------------------------

  function buildToolButtonGroup(className, buttons) {
    const group = doc.createElement('div');
    group.className = className;
    group.setAttribute('role', 'group');
    const refs = {};
    for (const { action, label } of buttons) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.fogAction = action;
      button.textContent = label;
      group.appendChild(button);
      refs[action] = button;
    }
    return { group, refs };
  }

  function guarded(fn) {
    return event => {
      event?.preventDefault?.();
      if (presentationMode !== 'dm') return; // structural safety even if a control is reachable while hidden
      fn();
    };
  }

  function buildDom() {
    root = doc.createElement('details');
    root.className = 'fog-controller';
    root.dataset.fogController = '';
    root.open = true;

    const summary = doc.createElement('summary');
    summary.textContent = 'Fog of War';
    root.appendChild(summary);

    // Fog Mode / tool / brush / opacity
    const modeSection = doc.createElement('div');
    modeSection.className = 'fog-section fog-mode-section';

    const toggle = doc.createElement('button');
    toggle.type = 'button';
    toggle.dataset.fogAction = 'toggle-fog-mode';
    toggle.textContent = 'Enter Fog Mode';
    toggle.addEventListener('click', guarded(() => {
      editorActive = !editorActive;
      editor.setActive(editorActive);
      toggle.textContent = editorActive ? 'Exit Fog Mode' : 'Enter Fog Mode';
    }));
    modeSection.appendChild(toggle);

    const { group: toolGroup, refs: toolRefs } = buildToolButtonGroup('fog-tool-group', [
      { action: 'tool-reveal', label: 'Reveal' },
      { action: 'tool-hide', label: 'Hide' },
    ]);
    toolRefs['tool-reveal'].addEventListener('click', guarded(() => { tool = 'reveal'; editor.setMode('reveal'); updateToolPressedState(); }));
    toolRefs['tool-hide'].addEventListener('click', guarded(() => { tool = 'hide'; editor.setMode('hide'); updateToolPressedState(); }));
    modeSection.appendChild(toolGroup);

    const { group: brushGroup, refs: brushRefs } = buildToolButtonGroup('fog-brush-group', BRUSH_SIZES.map(size => ({ action: `brush-${size}`, label: `${size}x${size}` })));
    for (const size of BRUSH_SIZES) {
      brushRefs[`brush-${size}`].addEventListener('click', guarded(() => { brushSize = size; editor.setBrushSize(size); updateBrushPressedState(); }));
    }
    modeSection.appendChild(brushGroup);

    const opacityLabel = doc.createElement('label');
    opacityLabel.className = 'sidebar-field';
    opacityLabel.textContent = 'Overlay opacity';
    const opacityInput = doc.createElement('input');
    opacityInput.type = 'range';
    opacityInput.min = '0';
    opacityInput.max = '1';
    opacityInput.step = '0.05';
    opacityInput.dataset.fogField = 'opacity';
    opacityInput.value = String(opacity);
    opacityInput.addEventListener('input', () => {
      if (presentationMode !== 'dm') return;
      opacity = Number(opacityInput.value);
      editor.setOpacity(opacity);
    });
    opacityLabel.appendChild(opacityInput);
    modeSection.appendChild(opacityLabel);
    root.appendChild(modeSection);

    // Named areas
    const areasSection = doc.createElement('div');
    areasSection.className = 'fog-section fog-areas-section';
    const areasHeading = doc.createElement('h4');
    areasHeading.textContent = 'Named Areas';
    areasSection.appendChild(areasHeading);
    const areaList = doc.createElement('ul');
    areaList.className = 'fog-area-list';
    areaList.dataset.fogAreaList = '';
    areasSection.appendChild(areaList);

    const newAreaButton = doc.createElement('button');
    newAreaButton.type = 'button';
    newAreaButton.dataset.fogAction = 'new-area';
    newAreaButton.textContent = 'New Area';
    newAreaButton.addEventListener('click', guarded(() => startDraft(null)));
    areasSection.appendChild(newAreaButton);

    const areaEditor = doc.createElement('div');
    areaEditor.className = 'fog-area-editor';
    areaEditor.dataset.fogAreaEditor = '';
    areaEditor.hidden = true;

    const nameLabel = doc.createElement('label');
    nameLabel.className = 'sidebar-field';
    nameLabel.textContent = 'Area name';
    const nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.dataset.fogField = 'area-name';
    nameLabel.appendChild(nameInput);
    areaEditor.appendChild(nameLabel);

    const defaultFieldset = doc.createElement('fieldset');
    defaultFieldset.className = 'fog-area-default';
    for (const value of ['hidden', 'revealed']) {
      const optionLabel = doc.createElement('label');
      const radio = doc.createElement('input');
      radio.type = 'radio';
      radio.name = 'fog-area-default';
      radio.value = value;
      radio.dataset.fogField = 'area-default';
      radio.addEventListener('change', () => {
        if (draft && radio.checked) draft.revealedByDefault = value === 'revealed';
      });
      optionLabel.appendChild(radio);
      optionLabel.appendChild(doc.createTextNode(value === 'hidden' ? 'Hidden by default' : 'Revealed by default'));
      defaultFieldset.appendChild(optionLabel);
    }
    areaEditor.appendChild(defaultFieldset);

    const saveButton = doc.createElement('button');
    saveButton.type = 'button';
    saveButton.dataset.fogAction = 'area-save';
    saveButton.textContent = 'Save Area';
    saveButton.addEventListener('click', guarded(saveDraft));
    areaEditor.appendChild(saveButton);

    const cancelButton = doc.createElement('button');
    cancelButton.type = 'button';
    cancelButton.dataset.fogAction = 'area-cancel';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', guarded(endDraft));
    areaEditor.appendChild(cancelButton);

    areasSection.appendChild(areaEditor);
    root.appendChild(areasSection);

    // Broad actions
    const broadSection = doc.createElement('div');
    broadSection.className = 'fog-section fog-broad-actions';
    const { group: broadGroup, refs: broadRefs } = buildToolButtonGroup('fog-broad-group', [
      { action: 'reveal-all', label: 'Reveal All' },
      { action: 'hide-all', label: 'Hide All' },
      { action: 'reset', label: 'Reset to Defaults' },
    ]);
    broadRefs['reveal-all'].addEventListener('click', guarded(revealAll));
    broadRefs['hide-all'].addEventListener('click', guarded(hideAll));
    broadRefs.reset.addEventListener('click', guarded(resetDefaults));
    broadSection.appendChild(broadGroup);
    root.appendChild(broadSection);

    // Inheritance / enable-disable
    const inheritanceSection = doc.createElement('div');
    inheritanceSection.className = 'fog-section fog-inheritance-section';

    const campaignRow = doc.createElement('div');
    campaignRow.className = 'fog-campaign-row';
    const campaignLabel = doc.createElement('span');
    campaignLabel.textContent = 'Campaign fog: ';
    const campaignStatus = doc.createElement('span');
    campaignStatus.dataset.fogStatus = 'campaign';
    campaignLabel.appendChild(campaignStatus);
    campaignRow.appendChild(campaignLabel);
    const enableButton = doc.createElement('button');
    enableButton.type = 'button';
    enableButton.dataset.fogAction = 'enable-campaign';
    enableButton.textContent = 'Enable Fog';
    enableButton.addEventListener('click', guarded(enableCampaignFog));
    campaignRow.appendChild(enableButton);
    const disableButton = doc.createElement('button');
    disableButton.type = 'button';
    disableButton.dataset.fogAction = 'disable-campaign';
    disableButton.textContent = 'Disable Fog';
    disableButton.addEventListener('click', guarded(() => { void disableCampaignFog(); }));
    campaignRow.appendChild(disableButton);
    inheritanceSection.appendChild(campaignRow);

    function buildOverrideSelect(fieldName, labelText, onChange) {
      const label = doc.createElement('label');
      label.className = 'sidebar-field';
      label.textContent = labelText;
      const select = doc.createElement('select');
      select.dataset.fogField = fieldName;
      for (const [value, text] of [['on', 'On'], ['off', 'Off'], ['inherit', 'Inherit']]) {
        const option = doc.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }
      select.addEventListener('change', () => {
        if (presentationMode !== 'dm') return;
        onChange(select.value);
      });
      label.appendChild(select);
      inheritanceSection.appendChild(label);
      return select;
    }

    const locationSelect = buildOverrideSelect('location-override', 'Location fog', setLocationOverride);
    const levelSelect = buildOverrideSelect('level-override', 'Level fog', setLevelOverride);

    root.appendChild(inheritanceSection);
    root.hidden = true; // until the first render(view) determines manager/presentation visibility
    host.appendChild(root);

    els = {
      root, toggle, toolRefs, brushRefs, opacityInput, areaList, areaEditor, areaName: nameInput,
      areaDefaultHidden: defaultFieldset.querySelector('[value="hidden"]'),
      areaDefaultRevealed: defaultFieldset.querySelector('[value="revealed"]'),
      campaignStatus, enableButton, disableButton, locationSelect, levelSelect,
    };

    function updateToolPressedState() {
      toolRefs['tool-reveal'].setAttribute('aria-pressed', String(tool === 'reveal'));
      toolRefs['tool-hide'].setAttribute('aria-pressed', String(tool === 'hide'));
    }
    function updateBrushPressedState() {
      for (const size of BRUSH_SIZES) brushRefs[`brush-${size}`].setAttribute('aria-pressed', String(size === brushSize));
    }
    updateToolPressedState();
    updateBrushPressedState();
    els.updateToolPressedState = updateToolPressedState;
    els.updateBrushPressedState = updateBrushPressedState;
  }

  function renderAreaEditor() {
    if (!els) return;
    els.areaEditor.hidden = !draft;
    if (!draft) return;
    els.areaName.value = draft.name;
    els.areaDefaultHidden.checked = !draft.revealedByDefault;
    els.areaDefaultRevealed.checked = draft.revealedByDefault;
  }

  function renderAreaList(view) {
    if (!els) return;
    els.areaList.innerHTML = '';
    const levelId = currentLevelId();
    const areas = (view?.dm?.fog?.areas ?? []).filter(area => area.levelId === levelId);
    for (const area of areas) {
      const row = doc.createElement('li');
      row.dataset.areaId = area.id;
      const label = doc.createElement('span');
      label.textContent = `${area.name} (${area.status})`;
      row.appendChild(label);

      const editButton = doc.createElement('button');
      editButton.type = 'button';
      editButton.dataset.fogAction = 'area-edit';
      editButton.dataset.areaId = area.id;
      editButton.textContent = 'Edit';
      editButton.addEventListener('click', guarded(() => startDraft(area)));
      row.appendChild(editButton);

      const revealButton = doc.createElement('button');
      revealButton.type = 'button';
      revealButton.dataset.fogAction = 'area-reveal';
      revealButton.dataset.areaId = area.id;
      revealButton.textContent = 'Reveal Area';
      revealButton.addEventListener('click', guarded(() => setAreaVisibility(area, true)));
      row.appendChild(revealButton);

      const hideButton = doc.createElement('button');
      hideButton.type = 'button';
      hideButton.dataset.fogAction = 'area-hide';
      hideButton.dataset.areaId = area.id;
      hideButton.textContent = 'Hide Area';
      hideButton.addEventListener('click', guarded(() => setAreaVisibility(area, false)));
      row.appendChild(hideButton);

      const deleteButton = doc.createElement('button');
      deleteButton.type = 'button';
      deleteButton.dataset.fogAction = 'area-delete';
      deleteButton.dataset.areaId = area.id;
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', guarded(() => { void deleteArea(area); }));
      row.appendChild(deleteButton);

      els.areaList.appendChild(row);
    }
  }

  function renderInheritance(view) {
    if (!els) return;
    const fog = view?.dm?.fog;
    els.campaignStatus.textContent = fog?.campaignEnabled ? 'On' : 'Off';
    els.locationSelect.value = overrideToSelectValue(fog?.locationOverride ?? null);
    els.levelSelect.value = overrideToSelectValue(fog?.levelOverride ?? null);
  }

  function updateVisibility(view) {
    if (!root) return;
    root.hidden = presentationMode !== 'dm' || !isManagerView(view);
  }

  /** Manager-authority boundary (10F-FIX1 defect 1): deactivate paint interception, discard any
   * uncommitted stroke preview, and discard any named-area draft. Called from `render(view)` the
   * instant a view without manager authority arrives, and reused by `deactivate()` — the controller
   * enforces this itself rather than relying solely on backend authorization (defense in depth). */
  function suspendEditingForAuthorityLoss() {
    editorActive = false;
    editor.setActive(false); // cancels any in-progress stroke preview and disables pointer interception
    if (els) els.toggle.textContent = 'Enter Fog Mode';
    draft = null;
    editor.setPurpose('fog');
    editor.setSelectedCells([]);
    if (els) renderAreaEditor();
  }

  /** Level-context boundary (10F-FIX1 defect 2): a named-area draft is only ever valid for the
   * authoritative `levelId` it began under. If the manager's authoritative editing context moves to
   * a different level, the draft is discarded immediately so a later Save can never redirect a
   * Level A selection at Level B. A same-level authoritative refresh leaves a valid draft alone. */
  function discardDraftIfLevelChanged(view) {
    if (!draft) return;
    const authoritativeLevelId = view?.fog?.levelId ?? null;
    if (authoritativeLevelId !== null && authoritativeLevelId !== draft.levelId) {
      endDraft();
    }
  }

  return {
    activate() {
      if (!root) buildDom();
    },

    deactivate() {
      suspendEditingForAuthorityLoss();
      presentationMode = 'dm';
      if (root) root.hidden = true;
    },

    render(view) {
      editor.setFog(view?.fog ?? null);
      if (isManagerView(view)) {
        discardDraftIfLevelChanged(view);
      } else {
        suspendEditingForAuthorityLoss();
      }
      if (!root) return;
      if (isManagerView(view)) {
        renderAreaList(view);
        renderInheritance(view);
      }
      updateVisibility(view);
    },

    setPresentationMode(mode) {
      if (mode !== 'dm' && mode !== 'player') return;
      if (mode === presentationMode) return;
      presentationMode = mode;
      if (mode === 'player') {
        editorActive = false;
        editor.setActive(false);
        if (els) els.toggle.textContent = 'Enter Fog Mode';
      }
      if (root) root.hidden = presentationMode !== 'dm' || !isManagerView(getView());
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      draft = null;
      pendingBroadActions.clear();
      editor.dispose();
      if (root?.parentNode) root.parentNode.removeChild(root);
      root = null;
      els = null;
    },
  };
}
