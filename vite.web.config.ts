import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const appPath = fileURLToPath(new URL('./src', import.meta.url));
const languagePath = fileURLToPath(new URL('./build/lib', import.meta.url));
const csPath = fileURLToPath(new URL('./src/cs', import.meta.url));
const webRootPath = fileURLToPath(new URL('./src/cs/code/browser', import.meta.url));
const webOutputPath = fileURLToPath(new URL('./dist-web', import.meta.url));
const loopbackHost = '127.0.0.1';

export default defineConfig({
  base: './',
  clearScreen: false,
  root: webRootPath,
	resolve: {
		alias: {
			app: appPath,
			language: languagePath,
			cs: csPath,
		},
	},
  server: {
    host: loopbackHost,
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: webOutputPath,
    emptyOutDir: true,
  },
});
