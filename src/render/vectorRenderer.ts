import { computeDrawOps } from './drawOps';
import type { DrawOp, Glyph, Paint } from './drawOps';
import type { Renderer } from './renderer';
import type { Area, RenderSettings, Room } from '../types';

/**
 * The drawing surface, structurally satisfied by CanvasRenderingContext2D. Narrowed to what
 * is actually used so tests can record calls without a real canvas.
 */
export interface DrawTarget {
  // Widened to exactly what CanvasRenderingContext2D declares, or a real context would not
  // structurally satisfy this interface.
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

const COLOURS: Record<Paint, string> = {
  background: '#10131c',
  heat: '#3d2110',
  water: '#1d3a72',
  lava: '#7a2113',
  acid: '#27701f',
  wall: '#c9ccd8',
  item: '#ffffff',
  utility: '#9fe3ff',
  special: '#b9a7ff',
};

/** Roughly the hues Super Metroid uses for each region on the map screen. */
const AREA_COLOURS: Record<Area, string> = {
  Crateria: '#7ec6d8',
  Brinstar: '#63d16a',
  Norfair: '#e0603f',
  'Wrecked Ship': '#c9b96a',
  Maridia: '#6f8ee0',
  Tourian: '#b06fd8',
};

/** Single characters standing in for the map screen's station and refill icons. */
const GLYPH_TEXT: Partial<Record<Glyph, string>> = {
  save: 'S',
  map: 'M',
  energyRefill: 'E',
  ammoRefill: 'A',
  doubleRefill: 'R',
  ship: '^',
};

export function canvasSize(room: Room, settings: RenderSettings): {
  width: number;
  height: number;
} {
  return { width: room.width * settings.tileSize, height: room.height * settings.tileSize };
}

function drawGlyph(target: DrawTarget, op: Extract<DrawOp, { kind: 'glyph' }>): void {
  const { x, y, size, glyph } = op;
  const unit = size / 8;

  const text = GLYPH_TEXT[glyph];
  if (text !== undefined) {
    target.font = `${Math.max(size * 0.6, 6)}px monospace`;
    target.textAlign = 'center';
    target.textBaseline = 'middle';
    target.fillText(text, x, y);
    return;
  }

  switch (glyph) {
    case 'item':
      target.fillRect(x - unit, y - unit, unit * 2, unit * 2);
      break;
    case 'doubleItem':
      target.fillRect(x - unit * 2.5, y - unit, unit * 2, unit * 2);
      target.fillRect(x + unit * 0.5, y - unit, unit * 2, unit * 2);
      break;
    case 'hiddenItem':
      target.lineWidth = Math.max(unit * 0.5, 1);
      target.strokeRect(x - unit, y - unit, unit * 2, unit * 2);
      break;
    case 'elevatorPlatform':
      target.fillRect(x - unit * 2, y - unit * 0.5, unit * 4, unit);
      break;
    case 'elevator':
    case 'tube':
      target.fillRect(x - unit * 0.5, y - unit * 2.5, unit, unit * 5);
      break;
  }
}

/** Executes a list of draw ops against a surface, in order. */
export function paint(target: DrawTarget, ops: DrawOp[]): void {
  for (const op of ops) {
    const colour = op.kind === 'fill' && op.area
      ? COLOURS[op.paint]
      : op.kind === 'line' && op.area
        ? AREA_COLOURS[op.area]
        : COLOURS[op.paint];

    switch (op.kind) {
      case 'fill':
        target.fillStyle = colour;
        target.fillRect(op.x, op.y, op.w, op.h);
        break;
      case 'line':
        target.strokeStyle = colour;
        target.lineWidth = 1;
        target.beginPath();
        target.moveTo(op.x1, op.y1);
        target.lineTo(op.x2, op.y2);
        target.stroke();
        break;
      case 'glyph':
        target.fillStyle = colour;
        target.strokeStyle = colour;
        drawGlyph(target, op);
        break;
    }
  }
}

export const vectorRenderer: Renderer = {
  render(canvas, room, settings) {
    const { width, height } = canvasSize(room, settings);
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context is unavailable');
    ctx.clearRect(0, 0, width, height);
    paint(ctx, computeDrawOps(room, settings));
  },
};
