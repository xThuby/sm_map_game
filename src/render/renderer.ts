import type { RenderSettings, Room } from '../types';

export interface Renderer {
  render(canvas: HTMLCanvasElement, room: Room, settings: RenderSettings): void;
}

/**
 * Sensible defaults for the quiz: geometry and items shown, hazards and area colour hidden.
 * Hiding the hazards is what makes "is this room heated?" a question about the room rather
 * than about the colour on screen.
 */
export const DEFAULT_RENDER_SETTINGS: RenderSettings = {
  heat: 'hidden',
  water: 'hidden',
  lava: 'hidden',
  acid: 'hidden',
  blueDoors: 'visible',
  walls: 'enhanced',
  items: 'visible',
  areaColour: false,
  tileSize: 24,
};
