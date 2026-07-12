/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawnSync } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const scriptFilePath = fileURLToPath(import.meta.url);
const scriptsMarker = `${path.sep}scripts${path.sep}`;
const scriptsMarkerIndex = scriptFilePath.lastIndexOf(scriptsMarker);
const rootDir =
  scriptsMarkerIndex >= 0
    ? scriptFilePath.slice(0, scriptsMarkerIndex)
    : path.dirname(scriptFilePath);
const outputDir = path.join(rootDir, '.tmp', 'editor-tests');
const testPaths = [
	'cs/base/browser/ui/aria/tests/aria.test.ts',
	'cs/base/browser/ui/dateRangePicker/tests/dateRangePicker.test.ts',
	'cs/base/browser/tests/dom.test.ts',
	'cs/base/browser/ui/dropdown/tests/dropdown.test.ts',
	'cs/base/browser/ui/dropdown/tests/dropdownMenuActionViewItem.test.ts',
	'cs/base/browser/ui/hover/tests/hover.test.ts',
	'cs/base/browser/ui/list/tests/listWidget.test.ts',
	'cs/base/browser/ui/menu/test/menu.test.ts',
	'cs/base/browser/ui/progressbar/tests/progressbar.test.ts',
	'cs/base/browser/ui/selectbox/tests/selectBox.test.ts',
	'cs/base/browser/ui/tree/tests/simpleTree.test.ts',
	'cs/base/test/browser/actionbar.test.ts',
	'cs/base/test/browser/ui/contextview/contextview.test.ts',
  'cs/editor/browser/text/tests/prosemirrorDocument.test.ts',
  'cs/editor/browser/text/tests/fontSizePresets.test.ts',
  'cs/editor/browser/text/tests/editorDraftStyleService.test.ts',
  'cs/editor/browser/text/tests/editorDraftToolbarStyleModel.test.ts',
  'cs/editor/browser/text/tests/input.test.ts',
  'cs/editor/browser/text/tests/editorCommandRegistry.test.ts',
  'cs/editor/browser/text/tests/editorDom.test.ts',
  'cs/editor/browser/text/tests/sync.test.ts',
  'cs/code/electron-main/document/tests/editorDocxSerializer.test.ts',
  'cs/workbench/browser/test/editorGroup.test.ts',
  'cs/workbench/browser/test/editorGroups.test.ts',
  'cs/workbench/browser/test/draftEditorInput.test.ts',
  'cs/workbench/browser/test/pdfEditorInput.test.ts',
  'cs/workbench/browser/test/editorInputSerializerRegistry.test.ts',
  'cs/workbench/browser/test/editorCreateActions.test.ts',
  'cs/workbench/browser/test/editorPartLifecycle.test.ts',
  'cs/workbench/browser/test/editorPaneHost.test.ts',
	'cs/sessions/browser/test/editorPartLifecycle.test.ts',
	'cs/platform/hover/test/hoverService.test.ts',
];
const sourceRoot = path.join(rootDir, 'src');
const entryPoints = testPaths.map(testPath => path.join(sourceRoot, testPath));

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await build({
  entryPoints,
  outdir: outputDir,
  outbase: sourceRoot,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: 'inline',
  external: ['node:assert/strict', 'node:test', 'jsdom'],
  loader: {
    '.css': 'empty',
    '.svg': 'text',
  },
});

const outputFiles = testPaths.map(testPath =>
  path.join(outputDir, testPath.replace(/\.ts$/, '.js')),
);

const result = spawnSync(process.execPath, [
  '--import',
  path.join(rootDir, 'scripts', 'workbench-browser-test-bootstrap.mjs'),
  '--test',
  ...outputFiles,
], {
  stdio: 'inherit',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}

if (result.error) {
  throw result.error;
}

process.exit(1);
