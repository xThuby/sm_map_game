import { mountApp } from './ui/app';
import { loadRooms } from './rooms';
import { DEFAULT_RENDER_SETTINGS } from './render/renderer';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  mountApp(root, { rooms: loadRooms(), settings: { ...DEFAULT_RENDER_SETTINGS } });
}
