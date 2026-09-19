import { mountApp } from './ui/app';
import { guessableRooms } from './rooms';
import { DEFAULT_RENDER_SETTINGS } from './render/renderer';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  mountApp(root, { rooms: guessableRooms(), settings: { ...DEFAULT_RENDER_SETTINGS } });
}
