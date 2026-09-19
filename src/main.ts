import { mountApp } from './ui/app';
import { loadRooms } from './rooms';
import { TOURNAMENT_SETTINGS } from './render/renderer';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  mountApp(root, { rooms: loadRooms(), settings: { ...TOURNAMENT_SETTINGS, tileSize: 32 } });
}
