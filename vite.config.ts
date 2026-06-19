import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const appPath = fileURLToPath(new URL('./src', import.meta.url));
const languagePath = fileURLToPath(new URL('./build/lib', import.meta.url));
const lsPath = fileURLToPath(new URL('./src/ls', import.meta.url));
const workbenchHtmlPath = fileURLToPath(
  new URL('./src/ls/code/electron-sandbox/workbench/workbench.html', import.meta.url),
);
const loopbackHost = '127.0.0.1';

export default defineConfig({
  base: './',
  clearScreen: false,
  resolve: {
    alias: {
      app: appPath,
      language: languagePath,
      ls: lsPath,
    },
  },
  server: {
    host: loopbackHost,
    port: 1420,
    strictPort: true,
    hmr: {
      host: loopbackHost,
      port: 1421,
    },
  },
  build: {
    rollupOptions: {
      input: {
        workbench: workbenchHtmlPath,
      },
      output: {
        manualChunks(id) {
          if (id.includes('/node_modules/prosemirror-')) {
            return 'prosemirror-vendor';
          }

          return undefined;
        },
      },
    },
  },
});
