import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { builtinModules } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as esbuild from 'esbuild';

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptsMarker = `${path.sep}scripts${path.sep}`;
const scriptsMarkerIndex = scriptFilePath.lastIndexOf(scriptsMarker);
const projectRoot =
  scriptsMarkerIndex >= 0
    ? scriptFilePath.slice(0, scriptsMarkerIndex)
    : path.dirname(scriptFilePath);
const watchMode = process.argv.includes('--watch');
const appRoot = path.join(projectRoot, 'src');
const distElectronDir = path.join(projectRoot, 'dist-electron');
const languageRoot = path.join(projectRoot, 'build', 'lib');
const srcRoot = path.join(projectRoot, 'src', 'ls');
const lsRoot = srcRoot;
const entryPoints = [
  path.join(srcRoot, 'code', 'electron-main', 'launch.ts'),
  path.join(srcRoot, 'code', 'electron-main', 'main.ts'),
  path.join(srcRoot, 'base', 'parts', 'sandbox', 'electron-browser', 'preload.ts'),
];

const packageJson = await import(pathToFileURL(path.join(projectRoot, 'package.json')).href, {
  with: { type: 'json' },
});
const packageNames = [
  ...Object.keys(packageJson.default.dependencies ?? {}),
  ...Object.keys(packageJson.default.devDependencies ?? {}),
];
const builtinExternals = builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]);

function resolveSourcePath(candidatePath) {
  const candidatePaths = candidatePath.endsWith('.js')
    ? [
        `${candidatePath.slice(0, -3)}.ts`,
        `${candidatePath.slice(0, -3)}.tsx`,
        candidatePath,
      ]
    : !path.extname(candidatePath)
      ? [
          `${candidatePath}.ts`,
          `${candidatePath}.tsx`,
          path.join(candidatePath, 'index.ts'),
          path.join(candidatePath, 'index.tsx'),
          candidatePath,
        ]
      : [candidatePath];

  for (const resolvedPath of candidatePaths) {
    if (!fs.existsSync(resolvedPath)) {
      continue;
    }

    if (fs.statSync(resolvedPath).isFile()) {
      return resolvedPath;
    }
  }

  return candidatePath;
}

const buildOptions = {
  absWorkingDir: projectRoot,
  bundle: true,
  entryPoints,
  external: [...builtinExternals, ...packageNames],
  format: 'esm',
  logLevel: 'info',
  outbase: srcRoot,
  outdir: distElectronDir,
  packages: 'external',
  platform: 'node',
  plugins: [
    {
      name: 'source-alias',
      setup(build) {
        build.onResolve({ filter: /^(?:app|language|ls)\// }, (args) => {
          const aliasRoots = {
            app: appRoot,
            language: languageRoot,
            ls: lsRoot,
          };
          const [alias] = args.path.split('/', 1);
          const aliasRoot = aliasRoots[alias];
          return {
            path: resolveSourcePath(path.join(aliasRoot, args.path.slice(alias.length + 1))),
          };
        });
      },
    },
  ],
  sourcemap: true,
  target: 'node20',
};

if (watchMode) {
  await fsPromises.rm(distElectronDir, { force: true, recursive: true });
  const context = await esbuild.context(buildOptions);
  await context.watch();
  console.log('[build-electron] watching for changes');
} else {
  await fsPromises.rm(distElectronDir, { force: true, recursive: true });
  await esbuild.build(buildOptions);
}
