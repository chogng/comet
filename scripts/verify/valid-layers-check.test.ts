/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { findLayerViolations } from './valid-layers-check.ts';

test('Layer check resolves imports and enforces Editor and Sessions entry points', t => {
	const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'comet-valid-layers-'));
	const sourceRoot = path.join(fixtureRoot, 'src/cs');
	t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
	const writeSource = (relativePath: string, contents: string): void => {
		const file = path.join(sourceRoot, relativePath);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, contents);
	};

	writeSource('sessions/common/shared.ts', 'export const shared = true;\n');
	writeSource(
		'sessions/common/invalid.ts',
		"import '../services/demo/browser/service.js';\n",
	);
	writeSource('sessions/browser/shell.ts', 'export const shell = true;\n');
	writeSource(
		'sessions/browser/load.ts',
		"import '../contrib/chat/browser/chat.contribution.js';\n",
	);
	writeSource(
		'sessions/services/demo/browser/service.ts',
		"export { chatContribution } from '../../../contrib/chat/browser/chat.contribution.js';\n",
	);
	writeSource(
		'sessions/contrib/chat/browser/chat.contribution.ts',
		'export const chatContribution = true;\n',
	);
	writeSource(
		'sessions/contrib/providers/one/browser/provider.ts',
		"import '../../two/browser/provider.js';\n",
	);
	writeSource(
		'sessions/contrib/providers/two/browser/provider.ts',
		'export const provider = true;\n',
	);
	writeSource('workbench/browser/local.ts', 'export const local = true;\n');
	writeSource('workbench/browser/valid.ts', "import './local.js';\n");
	writeSource(
		'workbench/browser/static.ts',
		"import '../../sessions/common/shared.js';\n",
	);
	writeSource(
		'workbench/browser/dynamic.ts',
		"void import('../../sessions/common/shared.js');\n",
	);
	writeSource(
		'workbench/workbench.common.main.ts',
		[
			"import 'cs/editor/editor.all';",
			"import 'cs/editor/browser/services/openerService';",
			'',
		].join('\n'),
	);
	writeSource(
		'editor/browser/view/invalid.ts',
		"import 'prosemirror-state';\n",
	);

	const violations = findLayerViolations({
		sourceRoot,
		compilerOptions: {
			module: ts.ModuleKind.ESNext,
			moduleResolution: ts.ModuleResolutionKind.Bundler,
		},
	});
	assert.equal(violations.length, 10);
	assert.ok(violations.some(violation => violation.includes(
		'workbench/browser/static.ts:1: lower cs layers must not import Sessions',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'workbench/browser/dynamic.ts:1: lower cs layers must not import Sessions',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'sessions/common/invalid.ts:1: Sessions common may import only Sessions common',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'sessions/services/demo/browser/service.ts:1: Sessions services must not import shell, runtime, or contributions',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'sessions/browser/load.ts:1: Sessions core shell must not import contributions',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'sessions/contrib/providers/one/browser/provider.ts:1: Sessions providers must not import sibling providers',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'workbench/workbench.common.main.ts:2: Workbench must load Editor registrations through editor.all',
	)));
	assert.ok(violations.some(violation => violation.includes(
		'editor/browser/view/invalid.ts:1: the native Editor pipeline must not import ProseMirror',
	)));
	assert.equal(
		violations.filter(violation => violation.includes('only Sessions entry points may load contribution entry points')).length,
		2,
	);
});
