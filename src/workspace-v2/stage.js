import Konva from 'konva';

import { clampCamera } from './camera.js';
import { SCENE_LAYER_ORDER } from './sceneModel.js';

const TOKEN_COLORS = {
  player: '#5ec8e5',
  npc: '#8fd18a',
  enemy: '#dc685e',
  boss: '#b46de0',
};

function drawGrid(layer, width, height, cellSize) {
  const worldWidth = width * cellSize;
  const worldHeight = height * cellSize;
  for (let x = 0; x <= width; x += 1) {
    layer.add(new Konva.Line({
      points: [x * cellSize, 0, x * cellSize, worldHeight],
      stroke: x % 5 === 0 ? '#59616d' : '#343b45',
      strokeWidth: x % 5 === 0 ? 1.5 : 1,
      listening: false,
    }));
  }
  for (let y = 0; y <= height; y += 1) {
    layer.add(new Konva.Line({
      points: [0, y * cellSize, worldWidth, y * cellSize],
      stroke: y % 5 === 0 ? '#59616d' : '#343b45',
      strokeWidth: y % 5 === 0 ? 1.5 : 1,
      listening: false,
    }));
  }
}

function drawTokens(layer, tokens, cellSize) {
  for (const token of tokens) {
    const width = token.width * cellSize;
    const height = token.height * cellSize;
    const group = new Konva.Group({
      x: token.x * cellSize,
      y: token.y * cellSize,
      listening: false,
      id: `token-${token.id}`,
      name: 'workspace-v2-token',
    });
    group.add(new Konva.Rect({
      width,
      height,
      fill: TOKEN_COLORS[token.kind] ?? '#d5b96f',
      opacity: token.isVisible ? 0.94 : 0.45,
      cornerRadius: Math.min(width, height) * 0.2,
      stroke: '#f5f1e8',
      strokeWidth: 2,
      shadowColor: '#000',
      shadowBlur: 12,
      shadowOpacity: 0.35,
    }));
    group.add(new Konva.Text({
      width,
      height,
      text: token.label.trim().slice(0, 2).toUpperCase() || '?',
      align: 'center',
      verticalAlign: 'middle',
      fontFamily: 'Inter, sans-serif',
      fontSize: Math.max(12, Math.min(width, height) * 0.32),
      fontStyle: 'bold',
      fill: '#11151c',
      listening: false,
    }));
    layer.add(group);
  }
}

export function createWorkspaceStage({
  container,
  width,
  height,
  cellSize = 64,
  gridWidth = 40,
  gridHeight = 40,
  camera,
}) {
  if (!container) throw new Error('createWorkspaceStage requires a container.');
  const stage = new Konva.Stage({ container, width, height });
  const layers = new Map();
  let currentCamera = clampCamera(camera);
  let currentScene = { grid: { width: gridWidth, height: gridHeight }, tokens: [] };

  for (const name of SCENE_LAYER_ORDER) {
    const layer = new Konva.Layer({
      name,
      listening: name === 'interaction',
    });
    layers.set(name, layer);
    stage.add(layer);
  }

  function setCamera(nextCamera) {
    currentCamera = clampCamera(nextCamera);
    for (const layer of layers.values()) {
      layer.position({ x: currentCamera.x, y: currentCamera.y });
      layer.scale({ x: currentCamera.zoom, y: currentCamera.zoom });
      layer.batchDraw();
    }
  }

  function render(scene = currentScene) {
    currentScene = scene;
    const grid = scene?.grid ?? { width: gridWidth, height: gridHeight };
    const background = layers.get('background');
    background.destroyChildren();
    background.add(new Konva.Rect({
      width: grid.width * cellSize,
      height: grid.height * cellSize,
      fill: '#1c232d',
      listening: false,
    }));

    const gridLayer = layers.get('grid');
    gridLayer.destroyChildren();
    drawGrid(gridLayer, grid.width, grid.height, cellSize);

    const tokenLayer = layers.get('token');
    tokenLayer.destroyChildren();
    drawTokens(tokenLayer, scene?.tokens ?? [], cellSize);

    background.batchDraw();
    gridLayer.batchDraw();
    tokenLayer.batchDraw();
  }

  function resize(nextWidth, nextHeight) {
    stage.size({
      width: Math.max(1, Number.isFinite(nextWidth) ? nextWidth : 1),
      height: Math.max(1, Number.isFinite(nextHeight) ? nextHeight : 1),
    });
    stage.batchDraw();
  }

  setCamera(currentCamera);
  render(currentScene);

  return {
    stage,
    layers,
    setCamera,
    resize,
    render,
    destroy() {
      stage.destroy();
    },
  };
}

