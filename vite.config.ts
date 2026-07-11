import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const appPath = fileURLToPath(new URL('./src', import.meta.url));
const languagePath = fileURLToPath(new URL('./build/lib', import.meta.url));
const csPath = fileURLToPath(new URL('./src/cs', import.meta.url));
const workbenchHtmlPath = fileURLToPath(
  new URL('./src/cs/code/electron-browser/workbench.html', import.meta.url),
);
const loopbackHost = '127.0.0.1';
const webWorkbenchPath = '/src/cs/code/browser/';

export default defineConfig({
  base: './',
  clearScreen: false,
	plugins: [
		{
			name: 'web-workbench-root-redirect',
			configureServer(server) {
				server.middlewares.use((request, response, next) => {
					if (request.url !== '/') {
						next();
						return;
					}

					response.statusCode = 302;
					response.setHeader('Location', webWorkbenchPath);
					response.end();
				});
			},
		},
	],
	resolve: {
		alias: {
			app: appPath,
			language: languagePath,
			cs: csPath,
		},
	},
  server: {
    host: loopbackHost,
    port: 1420,
    strictPort: true,
    hmr: {
      host: loopbackHost,
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
