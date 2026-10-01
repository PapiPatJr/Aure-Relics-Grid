const DEFAULT_MIN_ZOOM = 0.25;
const DEFAULT_MAX_ZOOM = 3;

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function zoomRange(camera = {}) {
  const minZoom = finite(camera.minZoom, DEFAULT_MIN_ZOOM);
  const maxZoom = finite(camera.maxZoom, DEFAULT_MAX_ZOOM);
  if (minZoom <= 0 || maxZoom <= minZoom) {
    return { minZoom: DEFAULT_MIN_ZOOM, maxZoom: DEFAULT_MAX_ZOOM };
  }
  return { minZoom, maxZoom };
}

export function clampCamera(camera = {}) {
  const { minZoom, maxZoom } = zoomRange(camera);
  const requestedZoom = finite(camera.zoom, 1);
  return {
    x: finite(camera.x, 0),
    y: finite(camera.y, 0),
    zoom: Math.min(maxZoom, Math.max(minZoom, requestedZoom)),
    minZoom,
    maxZoom,
  };
}

export function createCamera({
  x = 0,
  y = 0,
  zoom = 1,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
} = {}) {
  return clampCamera({ x, y, zoom, minZoom, maxZoom });
}

export function worldToScreen(point, camera) {
  const safe = clampCamera(camera);
  return {
    x: finite(point?.x, 0) * safe.zoom + safe.x,
    y: finite(point?.y, 0) * safe.zoom + safe.y,
  };
}

export function screenToWorld(point, camera) {
  const safe = clampCamera(camera);
  return {
    x: (finite(point?.x, 0) - safe.x) / safe.zoom,
    y: (finite(point?.y, 0) - safe.y) / safe.zoom,
  };
}

export function panBy(camera, delta) {
  const safe = clampCamera(camera);
  return {
    ...safe,
    x: safe.x + finite(delta?.x, 0),
    y: safe.y + finite(delta?.y, 0),
  };
}

export function zoomAt(camera, screenPoint, nextZoom) {
  const safe = clampCamera(camera);
  const anchor = {
    x: finite(screenPoint?.x, 0),
    y: finite(screenPoint?.y, 0),
  };
  const worldAnchor = screenToWorld(anchor, safe);
  const zoom = Math.min(safe.maxZoom, Math.max(safe.minZoom, finite(nextZoom, safe.zoom)));
  return {
    ...safe,
    x: anchor.x - worldAnchor.x * zoom,
    y: anchor.y - worldAnchor.y * zoom,
    zoom,
  };
}

export function fitBounds(camera, bounds, viewport, padding = 48) {
  const safe = clampCamera(camera);
  const width = finite(bounds?.width, 0);
  const height = finite(bounds?.height, 0);
  const viewportWidth = finite(viewport?.width, 0);
  const viewportHeight = finite(viewport?.height, 0);
  const safePadding = Math.max(0, finite(padding, 48));
  const availableWidth = viewportWidth - safePadding * 2;
  const availableHeight = viewportHeight - safePadding * 2;

  if (width <= 0 || height <= 0 || availableWidth <= 0 || availableHeight <= 0) {
    return safe;
  }

  const zoom = Math.min(
    safe.maxZoom,
    Math.max(safe.minZoom, Math.min(availableWidth / width, availableHeight / height)),
  );
  const x = (viewportWidth - width * zoom) / 2 - finite(bounds?.x, 0) * zoom;
  const y = (viewportHeight - height * zoom) / 2 - finite(bounds?.y, 0) * zoom;
  return clampCamera({ ...safe, x, y, zoom });
}

