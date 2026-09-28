import { test, expect } from '@playwright/test';

/**
 * Issue #10D-FIX browser regression: QA found that scaling the player fog canvas to a CSS size
 * that is not an exact integer multiple of the board dimensions let the browser's own image
 * interpolation blend opaque fog pixels with fully-transparent revealed pixels at the boundary,
 * bleeding a few partially-transparent pixels of whatever sits underneath (a magenta substrate,
 * standing in for future map art) into cells that must remain fully hidden. This can only be
 * observed in a real browser's compositor/rasterizer — jsdom has no layout/paint pipeline and
 * `tests/fog-renderer.test.js` only exercises the pure drawing-call logic against a fake 2D
 * context, so it cannot see this class of bug at all. Deliberately uses `@playwright/test`
 * directly rather than `./fixtures.js`'s Supabase actor harness: this is a pure rendering
 * regression with no session/auth/realtime concerns, on the same runner/webServer/browser
 * project every other e2e spec already uses.
 *
 * The harness (fog-pixel-harness.html) stretches a 200x200 board's fog stage to a 303px CSS
 * square — the reported repro ratio, and not an integer multiple of 200 — with one interior cell
 * revealed, over a full-bleed magenta background standing in for whatever the fog layer conceals.
 * A real screenshot (not the canvas element's own backing-store pixels, which never see the CSS
 * scaling step at all) is decoded back to pixel data entirely with built-in browser APIs
 * (`Image` + canvas `getImageData`) — no new dependency for PNG decoding.
 */

const FOG_COLOR = [16, 13, 10]; // src/fog/fogRenderer.js PLAYER_FOG_FILL '#100d0a'
const SUBSTRATE_COLOR = [255, 0, 255]; // harness magenta substrate

function classify([r, g, b, a]) {
  if (a !== 255) return 'ambiguous'; // any non-opaque pixel is itself a leak of the layer beneath
  const nearFog = Math.abs(r - FOG_COLOR[0]) <= 12 && Math.abs(g - FOG_COLOR[1]) <= 12 && Math.abs(b - FOG_COLOR[2]) <= 12;
  const nearSubstrate = r >= 235 && g <= 20 && b >= 235;
  if (nearFog && !nearSubstrate) return 'fog';
  if (nearSubstrate && !nearFog) return 'revealed';
  return 'ambiguous'; // neither pure color: an interpolated/blended pixel
}

test('scaled fog canvas (200x200 board at ~303 CSS px) never blends substrate color into hidden cells', async ({ page }) => {
  const size = 303;
  const boardWidth = 200;
  const boardHeight = 200;
  const revealX = 100;
  const revealY = 100;

  await page.goto(`/tests/e2e/fog-pixel-harness.html?size=${size}&width=${boardWidth}&height=${boardHeight}&revealX=${revealX}&revealY=${revealY}`);
  await page.waitForFunction(() => window.__fogPixelHarness?.ready === true);

  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
  const base64 = shot.toString('base64');

  const cellPx = size / boardWidth;
  const scanY = Math.round((revealY + 0.5) * cellPx);
  const scanXStart = Math.max(0, Math.round((revealX - 6) * cellPx));
  const scanXEnd = Math.min(size - 1, Math.round((revealX + 7) * cellPx));

  const pixels = await page.evaluate(async ({ base64, scanY, scanXStart, scanXEnd }) => {
    const img = new Image();
    const loaded = new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    img.src = `data:image/png;base64,${base64}`;
    await loaded;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const row = [];
    for (let x = scanXStart; x <= scanXEnd; x += 1) {
      row.push({ x, rgba: Array.from(ctx.getImageData(x, scanY, 1, 1).data) });
    }
    return row;
  }, { base64, scanY, scanXStart, scanXEnd });

  const classified = pixels.map(p => ({ x: p.x, kind: classify(p.rgba), rgba: p.rgba }));

  const ambiguous = classified.filter(p => p.kind === 'ambiguous');
  expect(ambiguous, `no interpolated/blended pixel across the fog boundary; got ${JSON.stringify(ambiguous)}`).toEqual([]);

  const revealedPixels = classified.filter(p => p.kind === 'revealed');
  const fogPixels = classified.filter(p => p.kind === 'fog');
  expect(revealedPixels.length, 'the revealed cell must actually expose the substrate').toBeGreaterThan(0);
  expect(fogPixels.length, 'cells beside the revealed one must remain opaque fog').toBeGreaterThan(0);

  // The revealed cell's own authoritative pixel range must be classified "revealed"...
  const revealPxStart = revealX * cellPx;
  const revealPxEnd = (revealX + 1) * cellPx;
  const centerX = Math.round((revealPxStart + revealPxEnd) / 2);
  const center = classified.find(p => p.x === centerX);
  expect(center?.kind).toBe('revealed');

  // ...and a pixel two full cells away on either side must remain fully fog-colored (adjacent
  // hidden cells, exactly the pixels QA found bleeding magenta).
  const leftNeighborX = Math.round((revealX - 2 + 0.5) * cellPx);
  const rightNeighborX = Math.round((revealX + 1 + 2 + 0.5) * cellPx);
  const leftNeighbor = classified.find(p => p.x === leftNeighborX);
  const rightNeighbor = classified.find(p => p.x === rightNeighborX);
  expect(leftNeighbor?.kind).toBe('fog');
  expect(rightNeighbor?.kind).toBe('fog');
});
