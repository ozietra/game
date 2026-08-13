import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      // The owner's metrics panel ships alongside the game as its own page. It
      // holds no data of its own, so publishing it costs nothing: without the
      // token it cannot read anything back.
      input: {
        game: resolve(__dirname, 'index.html'),
        panel: resolve(__dirname, 'panel/index.html'),
      },
    },
  },
});
