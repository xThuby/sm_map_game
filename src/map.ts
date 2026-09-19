import { mountMapPage } from './ui/mapPage';
import { TOURNAMENT_SETTINGS } from './render/renderer';

const root = document.querySelector<HTMLDivElement>('#map');
// Area colour on: a generated map assigns the areas itself, so the colour means something
// here in a way it does not on a single room.
if (root) mountMapPage(root, { settings: { ...TOURNAMENT_SETTINGS } });
