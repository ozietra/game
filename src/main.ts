import './style.css';
import { Game } from './core/game';
import { readSave } from './core/save';
import { App } from './ui/app';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');

const saved = readSave();
const game = new Game(saved ?? undefined);
const app = new App(game, root);

void app.start();
