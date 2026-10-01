import { panBy, screenToWorld as defaultScreenToWorld, zoomAt } from './camera.js';

function pointFromEvent(element, event) {
  const rect = element.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function midpoint(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function capturePointer(element, pointerId) {
  try {
    element.setPointerCapture?.(pointerId);
  } catch {
    // Synthetic events and browsers without active capture still support local gesture tracking.
  }
}

export function attachCameraControls({
  element,
  getCamera,
  setCamera,
  screenToWorld = defaultScreenToWorld,
  options = {},
}) {
  if (!element || typeof getCamera !== 'function' || typeof setCamera !== 'function') {
    throw new Error('attachCameraControls requires an element and camera accessors.');
  }

  const pointers = new Map();
  let mousePan = null;
  let touchGesture = null;
  let spacePressed = false;

  const isHandMode = () => typeof options.isHandMode === 'function' && options.isHandMode();

  function onWheel(event) {
    event.preventDefault();
    const camera = getCamera();
    const multiplier = Math.exp(-event.deltaY * 0.0015);
    setCamera(zoomAt(camera, pointFromEvent(element, event), camera.zoom * multiplier));
  }

  function onKeyDown(event) {
    if (event.code !== 'Space' || event.repeat) return;
    const target = event.target;
    if (target instanceof element.ownerDocument.defaultView.HTMLElement
      && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
    spacePressed = true;
    event.preventDefault();
  }

  function onKeyUp(event) {
    if (event.code === 'Space') spacePressed = false;
  }

  function onPointerDown(event) {
    const point = pointFromEvent(element, event);
    if (event.pointerType === 'touch') {
      pointers.set(event.pointerId, point);
      capturePointer(element, event.pointerId);
      if (pointers.size === 2) {
        const [first, second] = pointers.values();
        touchGesture = { center: midpoint(first, second), distance: distance(first, second) };
        event.preventDefault();
      }
      return;
    }

    const mayPan = event.button === 1 || (event.button === 0 && (spacePressed || isHandMode()));
    if (!mayPan) return;
    mousePan = { pointerId: event.pointerId, point };
    capturePointer(element, event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    const point = pointFromEvent(element, event);
    if (event.pointerType === 'touch' && pointers.has(event.pointerId)) {
      pointers.set(event.pointerId, point);
      if (pointers.size < 2) return;
      const [first, second] = pointers.values();
      const center = midpoint(first, second);
      const nextDistance = distance(first, second);
      if (!touchGesture || touchGesture.distance <= 0) {
        touchGesture = { center, distance: nextDistance };
        return;
      }
      const camera = getCamera();
      const worldAnchor = screenToWorld(touchGesture.center, camera);
      const zoom = camera.zoom * (nextDistance / touchGesture.distance);
      const clamped = zoomAt(camera, center, zoom);
      setCamera({
        ...clamped,
        x: center.x - worldAnchor.x * clamped.zoom,
        y: center.y - worldAnchor.y * clamped.zoom,
      });
      touchGesture = { center, distance: nextDistance };
      event.preventDefault();
      return;
    }

    if (!mousePan || mousePan.pointerId !== event.pointerId) return;
    setCamera(panBy(getCamera(), {
      x: point.x - mousePan.point.x,
      y: point.y - mousePan.point.y,
    }));
    mousePan.point = point;
    event.preventDefault();
  }

  function onPointerEnd(event) {
    if (event.pointerType === 'touch') {
      pointers.delete(event.pointerId);
      touchGesture = null;
    }
    if (mousePan?.pointerId === event.pointerId) mousePan = null;
  }

  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerEnd);
  element.addEventListener('pointercancel', onPointerEnd);
  element.ownerDocument.defaultView.addEventListener('keydown', onKeyDown);
  element.ownerDocument.defaultView.addEventListener('keyup', onKeyUp);

  return () => {
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerEnd);
    element.removeEventListener('pointercancel', onPointerEnd);
    element.ownerDocument.defaultView.removeEventListener('keydown', onKeyDown);
    element.ownerDocument.defaultView.removeEventListener('keyup', onKeyUp);
  };
}
