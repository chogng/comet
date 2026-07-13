/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { maximumBrowserViewReadableContentCharacters } from 'cs/platform/browserView/common/browserView';
import {
	parseBrowserViewReadableContentEvaluation,
} from 'cs/platform/browserView/electron-main/browserViewReadableContent';

test('Browser readable-content parser accepts only the bounded exact result', () => {
	assert.deepEqual(parseBrowserViewReadableContentEvaluation({
		text: 'Readable document text',
		truncated: false,
	}), {
		text: 'Readable document text',
		truncated: false,
	});
	assert.deepEqual(parseBrowserViewReadableContentEvaluation({
		text: 'x'.repeat(maximumBrowserViewReadableContentCharacters),
		truncated: true,
	}), {
		text: 'x'.repeat(maximumBrowserViewReadableContentCharacters),
		truncated: true,
	});
	assert.equal(parseBrowserViewReadableContentEvaluation({ text: '', truncated: false, url: 'https://example.com' }), undefined);
	assert.equal(parseBrowserViewReadableContentEvaluation({ text: 'text', truncated: 0 }), undefined);
	assert.equal(parseBrowserViewReadableContentEvaluation({
		text: 'x'.repeat(maximumBrowserViewReadableContentCharacters + 1),
		truncated: true,
	}), undefined);
});
