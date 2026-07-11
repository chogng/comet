/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { PdfEditorInput } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';

test('PdfEditorInput owns resource identity independently from its source URL', () => {
	const first = new PdfEditorInput({
		id: 'pdf-a',
		url: 'https://example.com/paper.pdf',
	});
	const second = new PdfEditorInput({
		id: 'pdf-b',
		url: 'https://example.com/paper.pdf',
	});

	assert.equal(first.matches(second), false);
	assert.equal(first.getUrl(), second.getUrl());
	assert.equal(first.serialize().id, 'pdf-a');
	assert.equal(second.serialize().id, 'pdf-b');
	first.dispose();
	second.dispose();
});

test('PdfEditorInput emits source and label changes', () => {
	const input = new PdfEditorInput({ id: 'pdf-a' });
	let sourceChanges = 0;
	let labelChanges = 0;
	input.onDidChangeSource(() => sourceChanges += 1);
	input.onDidChangeLabel(() => labelChanges += 1);

	input.setSource('https://example.com/paper.pdf', 'Paper');
	assert.equal(input.getUrl(), 'https://example.com/paper.pdf');
	assert.equal(input.getName(), 'Paper');
	assert.equal(sourceChanges, 1);
	assert.equal(labelChanges, 1);
	input.dispose();
});
