import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const appPath = fileURLToPath(new URL('./src', import.meta.url));
const languagePath = fileURLToPath(new URL('./build/lib', import.meta.url));
const csPath = fileURLToPath(new URL('./src/cs', import.meta.url));
const webIndexPath = fileURLToPath(new URL('./index.html', import.meta.url));
const loopbackHost = '127.0.0.1';

// Web mode serves the root index directly so `vite` dev opens at `/`
// instead of requiring the nested Electron workbench HTML path.
export default defineConfig({
  base: './',
  clearScreen: false,
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
    strictPort: false,
  },
  build: {
    outDir: 'dist-web',
    rollupOptions: {
      input: {
        index: webIndexPath,
      },
    },
  },
});
