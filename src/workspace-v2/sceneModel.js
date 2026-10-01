export const SCENE_LAYER_ORDER = Object.freeze([
  'background',
  'grid',
  'terrain',
  'structure',
  'difficultTerrain',
  'hazard',
  'trap',
  'token',
  'fog',
  'measurement',
  'interaction',
]);

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function boardExtent(view) {
  const width = view?.fog?.width;
  const height = view?.fog?.height;
  return positiveInteger(width) && positiveInteger(height)
    ? { width, height }
    : { width: 40, height: 40 };
}

function normalizeToken(token, grid) {
  if (!token || token.id == null) return null;
  const { x, y, width, height } = token;
  if (!nonNegativeInteger(x) || !nonNegativeInteger(y)) return null;
  if (!positiveInteger(width) || !positiveInteger(height)) return null;
  if (x + width > grid.width || y + height > grid.height) return null;
  return {
    id: String(token.id),
    label: typeof token.label === 'string' ? token.label : '',
    kind: typeof token.kind === 'string' ? token.kind : '',
    x,
    y,
    width,
    height,
    isVisible: token.isVisible !== false,
  };
}

export function createSceneModel(view) {
  const grid = boardExtent(view);
  return {
    revision: typeof view?.revision === 'string' ? view.revision : null,
    grid,
    tokens: (Array.isArray(view?.tokens) ? view.tokens : [])
      .map(token => normalizeToken(token, grid))
      .filter(Boolean),
    fog: view?.fog
      ? {
          enabled: view.fog.enabled === true,
          revealedRuns: Array.isArray(view.fog.revealedRuns) ? [...view.fog.revealedRuns] : [],
        }
      : null,
  };
}

