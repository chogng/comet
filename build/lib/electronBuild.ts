import fs from 'node:fs';
import { promises as fsPromises } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import * as esbuild from 'esbuild';

import { resolveProjectPath } from './util.ts';

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const appRoot = resolveProjectPath('src');
const distElectronDir = resolveProjectPath('dist-electron');
const languageRoot = resolveProjectPath('build', 'lib');
const srcRoot = resolveProjectPath('src', 'cs');
const csRoot = srcRoot;
const claudeAgentRuntimeEntryPoint = path.join(
  srcRoot,
  'code',
  'electron-utility',
  'agentRuntime',
  'claudeAgentRuntimeMain.ts',
);
const entryPoints = [
  path.join(srcRoot, 'code', 'electron-main', 'launch.ts'),
  path.join(srcRoot, 'code', 'electron-main', 'main.ts'),
  path.join(srcRoot, 'base', 'parts', 'sandbox', 'electron-browser', 'preload.ts'),
  path.join(srcRoot, 'platform', 'browserView', 'electron-browser', 'preload-browserView.ts'),
  path.join(srcRoot, 'code', 'electron-utility', 'sharedProcess', 'sharedProcessMain.ts'),
];

function resolveSourcePath(candidatePath: string) {
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

async function readPackageJson() {
  const packageJsonContent = await fsPromises.readFile(resolveProjectPath('package.json'), 'utf8');
  return JSON.parse(packageJsonContent) as PackageJson;
}

async function createElectronBuildOptions(plugins: esbuild.Plugin[] = []) {
  const packageJson = await readPackageJson();
  const packageNames = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ];
  const builtinExternals = builtinModules.flatMap(moduleName => [moduleName, `node:${moduleName}`]);

  return {
    absWorkingDir: resolveProjectPath(),
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
          build.onResolve({ filter: /^(?:app|language|cs)\// }, args => {
            const aliasRoots: Record<string, string> = {
              app: appRoot,
              language: languageRoot,
              cs: csRoot,
            };
            const [alias] = args.path.split('/', 1);

            return {
              path: resolveSourcePath(path.join(aliasRoots[alias], args.path.slice(alias.length + 1))),
            };
          });
        },
      },
      ...plugins,
    ],
    sourcemap: true,
    target: 'node20',
  } satisfies esbuild.BuildOptions;
}

async function createClaudeAgentRuntimeBuildOptions(plugins: esbuild.Plugin[] = []) {
  const options = await createElectronBuildOptions(plugins);
  const builtinExternals = builtinModules.flatMap(moduleName => [moduleName, `node:${moduleName}`]);
  return {
    ...options,
    entryPoints: [claudeAgentRuntimeEntryPoint],
    external: [...builtinExternals, 'electron'],
    packages: undefined,
  } satisfies esbuild.BuildOptions;
}

export async function buildElectron() {
  await fsPromises.rm(distElectronDir, { force: true, recursive: true });
  await Promise.all([
    esbuild.build(await createElectronBuildOptions()),
    esbuild.build(await createClaudeAgentRuntimeBuildOptions()),
  ]);
}

export async function watchElectronBuild(onBuildSuccess: () => void) {
  await fsPromises.rm(distElectronDir, { force: true, recursive: true });

  const initialBuilds = new Set<number>();
  let resolveInitialBuild!: () => void;
  const initialBuild = new Promise<void>(resolve => {
    resolveInitialBuild = resolve;
  });

  const watchPlugin = (buildIndex: number): esbuild.Plugin => ({
    name: 'desktop-dev-electron-watch',
    setup(build) {
      build.onEnd(result => {
        if (result.errors.length > 0) {
          return;
        }
        if (!initialBuilds.has(buildIndex)) {
          initialBuilds.add(buildIndex);
          if (initialBuilds.size === 2) {
            resolveInitialBuild();
          }
          return;
        }
        onBuildSuccess();
      });
    },
  });
  const contexts = await Promise.all([
    esbuild.context(await createElectronBuildOptions([watchPlugin(0)])),
    esbuild.context(await createClaudeAgentRuntimeBuildOptions([watchPlugin(1)])),
  ]);

  await Promise.all(contexts.map(context => context.watch()));
  console.log('[dev:desktop] watching electron main and preload');
  await initialBuild;

  return {
    dispose: async () => {
      await Promise.all(contexts.map(context => context.dispose()));
    },
  };
}
