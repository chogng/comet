/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { StandardSessionsLayoutPolicy } from 'cs/sessions/contrib/layout/browser/standardSessionsLayoutPolicy';

test('StandardSessionsLayoutPolicy defines and normalizes the target arrangement', () => {
	const policy = new StandardSessionsLayoutPolicy();
	const input = Object.freeze({
		mode: 'flow' as const,
		isSidebarVisible: false,
		sidebarSize: 100.4,
		isEditorCollapsed: false,
		expandedEditorSize: 200.8,
	});

	assert.deepStrictEqual({
		initial: policy.createInitialState(),
		arranged: policy.arrange({ width: 1440, height: 900 }, input),
		input,
	}, {
		initial: {
			mode: 'agent',
			isSidebarVisible: true,
			sidebarSize: 250,
			isEditorCollapsed: true,
			expandedEditorSize: 420,
		},
		arranged: {
			mode: 'flow',
			isSidebarVisible: false,
			sidebarSize: 220,
			isEditorCollapsed: false,
			expandedEditorSize: 420,
		},
		input: {
			mode: 'flow',
			isSidebarVisible: false,
			sidebarSize: 100.4,
			isEditorCollapsed: false,
			expandedEditorSize: 200.8,
		},
	});
});
