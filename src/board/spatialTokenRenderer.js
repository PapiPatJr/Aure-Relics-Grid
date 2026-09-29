/**
 * Shared spatial presentation for realtime board tokens (Tuesday Online Package 2B). Turns an
 * authoritative token's grid coordinates into a percentage-based rectangle inside a board box
 * sized `width`x`height` (the active level's `grid_width`/`grid_height`, exactly as delivered on
 * `displayView.fog.width`/`fog.height` — see supabase/migrations/20260925223000_fog_projection.sql's
 * `private.session_projection`, which computes `fog_state` once, identically for a manager and a
 * player). Percentage-based absolute positioning inside that one shared aspect-ratio box is the
 * single authoritative coordinate mapping: a token's cell `(x, y)` and a fog cell `(x, y)` land on
 * the exact same rendered pixel because both are positioned as `x / width` / `y / height` fractions
 * of the identical parent box — there is no second, independently-computed coordinate system.
 *
 * Presentation only: this module never decides *whether* a token is authorized to be seen. The
 * real Player Screen and the DM Player Preview both already receive a `tokens` array the backend
 * (or, for the preview, `src/board/displayView.js`'s `publicVisible` filter) has already reduced to
 * exactly what that recipient may see; this module renders exactly that array, nothing more. A DM's
 * manager-shaped `tokens` array additionally contains hidden (`isVisible: false`) tokens, which the
 * caller may opt into showing (with a distinguishing treatment) via `showHiddenTreatment` — never
 * decided in here.
 *
 * Bounded DOM cost by construction: rendering is O(visible tokens), never O(width * height). A
 * 200x200 board with a handful of tokens produces a handful of DOM nodes, not 40,000.
 *
 * Malformed/missing board dimensions or token geometry fail closed: `computeTokenRectPercent`
 * returns `null` rather than guessing a placement, and `renderSpatialToken`/`buildSpatialTokenLayer`
 * simply omit that token rather than rendering it somewhere arbitrary.
 */

const KIND_MODIFIERS = new Set(['player', 'enemy', 'npc', 'boss']);

function isPositiveInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value) {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** True when `width`/`height` are usable board dimensions (positive integers) — the same shape
 * `fog.width`/`fog.height` always carries when `fog` itself is non-null. */
export function isValidBoardExtent(width, height) {
  return isPositiveInt(width) && isPositiveInt(height);
}

/**
 * Compute a token's rectangle as percentages of a `boardWidth`x`boardHeight` box, or `null` when
 * the board extent or the token's own geometry cannot be trusted. Requires `width`/`height` to be
 * present and valid on the token itself — a missing size is never silently defaulted to 1x1, even
 * though every token the current backend creates already has one (see
 * supabase/migrations/20260919151359_v09_core.sql's `public.tokens` — `width`/`height` are
 * `not null default 1`); this stays defensive against a malformed/adversarial payload rather than
 * assuming that invariant.
 * @param {{ x?: unknown, y?: unknown, width?: unknown, height?: unknown }} token
 * @param {number} boardWidth
 * @param {number} boardHeight
 * @returns {{ leftPct: number, topPct: number, widthPct: number, heightPct: number }|null}
 */
export function computeTokenRectPercent(token, boardWidth, boardHeight) {
  if (!isValidBoardExtent(boardWidth, boardHeight)) return null;
  const { x, y, width, height } = token ?? {};
  if (!isNonNegativeInt(x) || !isNonNegativeInt(y)) return null;
  if (!isPositiveInt(width) || !isPositiveInt(height)) return null;
  if (x + width > boardWidth || y + height > boardHeight) return null;
  return {
    leftPct: (x / boardWidth) * 100,
    topPct: (y / boardHeight) * 100,
    widthPct: (width / boardWidth) * 100,
    heightPct: (height / boardHeight) * 100,
  };
}

function abbreviateLabel(label) {
  const trimmed = typeof label === 'string' ? label.trim() : '';
  return trimmed ? trimmed.slice(0, 2).toUpperCase() : '?';
}

function buildAriaLabel(token, { isActive, hiddenFromPlayers }) {
  const bits = [token.label || 'Token', token.kind || 'token'];
  if (isActive) bits.push('active turn');
  if (hiddenFromPlayers) bits.push('hidden from players');
  return bits.join(', ');
}

/**
 * Render one token as an absolutely-positioned element inside a board box already sized to match
 * `boardWidth`x`boardHeight` (via CSS `aspect-ratio`, see `.spatial-board-stage`/`.fog-player-stage`
 * in `src/board/spatialBoard.css`/`src/fog/fog.css`). Returns `null` — renders nothing — for a
 * token this module cannot place with confidence (see `computeTokenRectPercent`) or that has no
 * `id`, rather than rendering it at a guessed position.
 * @param {Document} doc
 * @param {object} token
 * @param {{ boardWidth: number, boardHeight: number, isActive?: boolean, showHiddenTreatment?: boolean }} options
 */
export function renderSpatialToken(doc, token, { boardWidth, boardHeight, isActive = false, showHiddenTreatment = false } = {}) {
  if (!token || token.id == null) return null;
  const rect = computeTokenRectPercent(token, boardWidth, boardHeight);
  if (!rect) return null;

  const hiddenFromPlayers = Boolean(showHiddenTreatment && token.isVisible === false);

  const el = doc.createElement('div');
  el.className = 'spatial-token';
  if (KIND_MODIFIERS.has(token.kind)) el.classList.add(`spatial-token--${token.kind}`);
  if (isActive) el.classList.add('spatial-token--active');
  if (hiddenFromPlayers) el.classList.add('spatial-token--hidden');

  el.style.left = `${rect.leftPct}%`;
  el.style.top = `${rect.topPct}%`;
  el.style.width = `${rect.widthPct}%`;
  el.style.height = `${rect.heightPct}%`;

  const label = buildAriaLabel(token, { isActive, hiddenFromPlayers });
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', label);
  el.title = label;

  const glyph = doc.createElement('span');
  glyph.className = 'spatial-token-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = abbreviateLabel(token.label);
  el.appendChild(glyph);

  el.dataset.spatialTokenId = token.id;
  el.dataset.tokenKind = token.kind ?? '';
  el.dataset.tokenX = String(token.x);
  el.dataset.tokenY = String(token.y);
  el.dataset.tokenWidth = String(token.width);
  el.dataset.tokenHeight = String(token.height);

  return el;
}

/**
 * Build the `.spatial-token-layer` containing one element per placeable token in `tokens` — never
 * one element per grid cell. Returns `null` when `width`/`height` are not a usable board extent
 * (mirrors `fogRenderer.js`'s `buildPlayerFogStage` returning `null` for the same reason); an
 * otherwise-valid board with zero placeable tokens still returns an (empty) layer element.
 * @param {Document} doc
 * @param {{ width: number, height: number, tokens?: object[], activeTokenId?: string|null, showHiddenTreatment?: boolean }} options
 */
export function buildSpatialTokenLayer(doc, { width, height, tokens = [], activeTokenId = null, showHiddenTreatment = false } = {}) {
  if (!isValidBoardExtent(width, height)) return null;

  const layer = doc.createElement('div');
  layer.className = 'spatial-token-layer';

  for (const token of tokens) {
    const el = renderSpatialToken(doc, token, {
      boardWidth: width,
      boardHeight: height,
      isActive: token?.id != null && token.id === activeTokenId,
      showHiddenTreatment,
    });
    if (el) layer.appendChild(el);
  }

  return layer;
}

/**
 * Build a standalone spatial board stage (base substrate + token layer) sized to `width`x`height`,
 * for a presentation context with no fog canvas of its own to mount the token layer inside (the DM
 * management view, which shows every manager-authorized token — including hidden ones, per
 * `showHiddenTreatment` — plainly, never behind a player-facing concealment canvas). The real
 * Player Screen and the DM Player Preview instead mount `buildSpatialTokenLayer`'s result directly
 * inside the existing `.fog-player-stage` (see `src/board/boardViewRenderer.js`), so tokens and fog
 * concealment share the exact same box rather than two independently-sized ones.
 * @param {Document} doc
 * @param {{ width: number, height: number, tokens?: object[], activeTokenId?: string|null, showHiddenTreatment?: boolean }} options
 */
export function buildSpatialBoardStage(doc, options) {
  const layer = buildSpatialTokenLayer(doc, options);
  if (!layer) return null;

  const stage = doc.createElement('div');
  stage.className = 'spatial-board-stage';
  stage.style.setProperty('--board-cols', String(options.width));
  stage.style.setProperty('--board-rows', String(options.height));

  const base = doc.createElement('div');
  base.className = 'spatial-board-stage-base';
  stage.appendChild(base);
  stage.appendChild(layer);

  return stage;
}
