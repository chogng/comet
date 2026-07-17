/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'node:test';

import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import {
	createTrustedCanonicalUtf8Text,
	encodeUtf8,
	hashCanonicalJson,
	hashCanonicalJsonText,
	hashTrustedCanonicalJsonText,
	hashUtf8,
	hashUtf8Bytes,
	patchTrustedCanonicalUtf8Text,
	type ITrustedCanonicalUtf8Text,
} from 'cs/editor/common/core/sha256';

function nodeSha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nodeSha256Bytes(value: string): Uint8Array {
	return new Uint8Array(createHash('sha256').update(value, 'utf8').digest());
}

function utf8Offset(value: string, utf16Offset: number): number {
	return Buffer.byteLength(value.slice(0, utf16Offset), 'utf8');
}

suite('Portable SHA-256', () => {
	test('matches stable SHA-256 vectors', () => {
		assert.equal(
			hashUtf8(''),
			'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
		assert.equal(
			hashUtf8('abc'),
			'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
		);
		assert.equal(
			hashUtf8('a'.repeat(1_000_000)),
			'sha256:cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
		);
	});

	test('matches the Node crypto oracle across SHA-256 block boundaries', () => {
		const byteLengths = [
			0,
			1,
			2,
			3,
			54,
			55,
			56,
			57,
			63,
			64,
			65,
			119,
			120,
			121,
			127,
			128,
			129,
			255,
			256,
			257,
			1_024,
		];

		for (const byteLength of byteLengths) {
			const value = 'x'.repeat(byteLength);
			assert.equal(hashUtf8(value), `sha256:${nodeSha256(value)}`, `byte length ${byteLength}`);
			assert.deepStrictEqual(
				Array.from(hashUtf8Bytes(value)),
				Array.from(nodeSha256Bytes(value)),
				`digest bytes at byte length ${byteLength}`,
			);
		}
	});

	test('matches the Node crypto oracle for Unicode and exact UTF-8 bytes', () => {
		const values = [
			'ASCII',
			'中文稿件',
			'emoji 😀🧪🚀',
			'e\u0301 versus é',
			'\0control\nline\tend',
			'𐀀\ue000',
			'混合😀e\u0301'.repeat(4_096),
		];

		for (const value of values) {
			assert.equal(hashUtf8(value), `sha256:${nodeSha256(value)}`);
			assert.deepStrictEqual(
				Array.from(encodeUtf8(value)),
				Array.from(Buffer.from(value, 'utf8')),
			);
		}
	});

	test('rejects malformed Unicode before hashing', () => {
		for (const value of ['\ud800', '\udc00', `before${'\ud800'}after`]) {
			assert.throws(
				() => hashUtf8(value),
				error => error instanceof TypeError
					&& error.message === 'Manuscript hash input must be well-formed Unicode.',
			);
			assert.throws(
				() => hashUtf8Bytes(value),
				error => error instanceof TypeError
					&& error.message === 'Manuscript hash input must be well-formed Unicode.',
			);
		}
	});

	test('hashes canonical payloads through the exact manuscript preimage', () => {
		const canonicalJson = '{"a":"值😀","z":0}';
		const preimage =
			`NIRECO\0HASH\0V1\0nireco.document-content.v1\0${canonicalJson}`;
		const fromPayload = hashCanonicalJson(
			manuscriptHashDomains.documentContent,
			{ z: -0, a: '值😀' },
		);
		const fromText = hashCanonicalJsonText(
			manuscriptHashDomains.documentContent,
			canonicalJson,
		);

		assert.deepStrictEqual(fromPayload, {
			type: 'ok',
			hash: `sha256:${nodeSha256(preimage)}`,
			canonicalJson,
			preimage,
		});
		assert.deepStrictEqual(fromText, fromPayload);
		assert.deepStrictEqual(
			hashCanonicalJson(manuscriptHashDomains.documentContent, { value: undefined }),
			{
				type: 'error',
				reason: 'canonical-json',
				path: '$.value',
			},
		);
	});

	test('trusted handles hash identically and cannot be forged structurally', () => {
		const canonicalText = '{"count":1,"text":"值😀"}';
		const trusted = createTrustedCanonicalUtf8Text(canonicalText);
		const expected = hashCanonicalJsonText(
			manuscriptHashDomains.documentContent,
			canonicalText,
		);
		const forged = Object.freeze({
			utf16Length: trusted.utf16Length,
			utf8ByteLength: trusted.utf8ByteLength,
		}) as ITrustedCanonicalUtf8Text;

		assert.equal(Object.isFrozen(trusted), true);
		assert.deepStrictEqual(
			{
				utf16Length: trusted.utf16Length,
				utf8ByteLength: trusted.utf8ByteLength,
			},
			{
				utf16Length: canonicalText.length,
				utf8ByteLength: Buffer.byteLength(canonicalText, 'utf8'),
			},
		);
		assert.deepStrictEqual(
			hashTrustedCanonicalJsonText(manuscriptHashDomains.documentContent, trusted),
			expected,
		);
		assert.equal(
			hashTrustedCanonicalJsonText(manuscriptHashDomains.documentContent, forged),
			undefined,
		);
		assert.equal(patchTrustedCanonicalUtf8Text(forged, []), undefined);
	});

	test('patches multiple Unicode ranges with exact UTF-8 provenance', () => {
		const sourceText = '{"alpha":"值😀","omega":"tail"}';
		const firstTarget = '值😀';
		const secondTarget = 'tail';
		const firstStart = sourceText.indexOf(firstTarget);
		const firstEnd = firstStart + firstTarget.length;
		const secondStart = sourceText.indexOf(secondTarget);
		const secondEnd = secondStart + secondTarget.length;
		const expectedText = '{"alpha":"new文","omega":"done😀"}';
		const source = createTrustedCanonicalUtf8Text(sourceText);

		const patched = patchTrustedCanonicalUtf8Text(source, [
			{
				startUtf16Offset: firstStart,
				endUtf16Offset: firstEnd,
				replacement: 'new文',
			},
			{
				startUtf16Offset: secondStart,
				endUtf16Offset: secondEnd,
				replacement: 'done😀',
			},
		]);

		assert.notEqual(patched, undefined);
		assert.deepStrictEqual(patched && {
			canonicalText: patched.canonicalText,
			utf16Length: patched.utf8.utf16Length,
			utf8ByteLength: patched.utf8.utf8ByteLength,
			replacements: patched.replacements,
		}, {
			canonicalText: expectedText,
			utf16Length: expectedText.length,
			utf8ByteLength: Buffer.byteLength(expectedText, 'utf8'),
			replacements: [
				{
					sourceStartUtf8Offset: utf8Offset(sourceText, firstStart),
					sourceEndUtf8Offset: utf8Offset(sourceText, firstEnd),
					nextStartUtf8Offset: utf8Offset(expectedText, expectedText.indexOf('new文')),
					nextEndUtf8Offset: utf8Offset(
						expectedText,
						expectedText.indexOf('new文') + 'new文'.length,
					),
				},
				{
					sourceStartUtf8Offset: utf8Offset(sourceText, secondStart),
					sourceEndUtf8Offset: utf8Offset(sourceText, secondEnd),
					nextStartUtf8Offset: utf8Offset(expectedText, expectedText.indexOf('done😀')),
					nextEndUtf8Offset: utf8Offset(
						expectedText,
						expectedText.indexOf('done😀') + 'done😀'.length,
					),
				},
			],
		});
		assert.deepStrictEqual(
			patched && hashTrustedCanonicalJsonText(
				manuscriptHashDomains.documentContent,
				patched.utf8,
			),
			hashCanonicalJsonText(manuscriptHashDomains.documentContent, expectedText),
		);
		assert.deepStrictEqual(
			hashTrustedCanonicalJsonText(manuscriptHashDomains.documentContent, source),
			hashCanonicalJsonText(manuscriptHashDomains.documentContent, sourceText),
		);
	});

	test('accepts supplied UTF-8 offsets only when inherited from an exact prior patch', () => {
		const sourceText = '{"value":"old😀"}';
		const oldStart = sourceText.indexOf('old😀');
		const oldEnd = oldStart + 'old😀'.length;
		const source = createTrustedCanonicalUtf8Text(sourceText);
		const first = patchTrustedCanonicalUtf8Text(source, [{
			startUtf16Offset: oldStart,
			endUtf16Offset: oldEnd,
			replacement: 'new值',
		}]);

		assert.notEqual(first, undefined);
		const inherited = first?.replacements[0];
		assert.notEqual(inherited, undefined);
		if (first === undefined || inherited === undefined) {
			return;
		}

		const newStart = first.canonicalText.indexOf('new值');
		const newEnd = newStart + 'new值'.length;
		const second = patchTrustedCanonicalUtf8Text(first.utf8, [{
			startUtf16Offset: newStart,
			endUtf16Offset: newEnd,
			replacement: 'final😀',
			startUtf8Offset: inherited.nextStartUtf8Offset,
			endUtf8Offset: inherited.nextEndUtf8Offset,
		}]);

		assert.equal(second?.canonicalText, '{"value":"final😀"}');
		assert.equal(
			patchTrustedCanonicalUtf8Text(source, [{
				startUtf16Offset: oldStart,
				endUtf16Offset: oldEnd,
				replacement: 'untrusted',
				startUtf8Offset: inherited.sourceStartUtf8Offset,
				endUtf8Offset: inherited.sourceEndUtf8Offset,
			}]),
			undefined,
		);
		assert.equal(
			patchTrustedCanonicalUtf8Text(first.utf8, [{
				startUtf16Offset: newStart,
				endUtf16Offset: newEnd,
				replacement: 'wrong-range',
				startUtf8Offset: inherited.nextStartUtf8Offset + 1,
				endUtf8Offset: inherited.nextEndUtf8Offset,
			}]),
			undefined,
		);
	});

	test('rejects invalid and overlapping patches without changing the source handle', () => {
		const sourceText = '{"value":"A😀B"}';
		const targetStart = sourceText.indexOf('A😀B');
		const emojiStart = sourceText.indexOf('😀');
		const source = createTrustedCanonicalUtf8Text(sourceText);
		const originalHash = hashTrustedCanonicalJsonText(
			manuscriptHashDomains.documentContent,
			source,
		);
		const invalidReplacements = [
			[
				{
					startUtf16Offset: targetStart,
					endUtf16Offset: targetStart + 2,
					replacement: 'first',
				},
				{
					startUtf16Offset: targetStart + 1,
					endUtf16Offset: targetStart + 3,
					replacement: 'overlap',
				},
			],
			[{
				startUtf16Offset: emojiStart + 1,
				endUtf16Offset: emojiStart + 1,
				replacement: 'surrogate-midpoint',
			}],
			[{
				startUtf16Offset: targetStart,
				endUtf16Offset: sourceText.length + 1,
				replacement: 'out-of-range',
			}],
			[{
				startUtf16Offset: targetStart,
				endUtf16Offset: targetStart,
				replacement: '\ud800',
			}],
			[{
				startUtf16Offset: targetStart,
				endUtf16Offset: targetStart + 1,
				replacement: 'partial-offset',
				startUtf8Offset: utf8Offset(sourceText, targetStart),
			}],
		];

		for (const replacements of invalidReplacements) {
			assert.equal(patchTrustedCanonicalUtf8Text(source, replacements), undefined);
		}
		assert.deepStrictEqual(
			hashTrustedCanonicalJsonText(manuscriptHashDomains.documentContent, source),
			originalHash,
		);
	});
});
