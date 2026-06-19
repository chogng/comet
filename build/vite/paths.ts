import path from 'node:path';

export function resolveViteBinPath(projectRoot: string): string {
  return path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
}
