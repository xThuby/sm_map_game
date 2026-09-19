import { mountParPage } from './ui/parPage';
import { guessableRooms } from './rooms';
import { DEFAULT_RENDER_SETTINGS } from './render/renderer';

const root = document.querySelector<HTMLDivElement>('#par');
if (root) {
  mountParPage(root, { rooms: guessableRooms(), settings: DEFAULT_RENDER_SETTINGS });
}
