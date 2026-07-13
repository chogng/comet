/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maximumArticleReadableContentBytes } from 'cs/workbench/services/fetch/common/fetch';

const excludedElementNames = new Set([
	'ASIDE',
	'BUTTON',
	'CANVAS',
	'FOOTER',
	'FORM',
	'NAV',
	'NOSCRIPT',
	'SCRIPT',
	'STYLE',
	'SVG',
	'TEMPLATE',
]);

const blockElementNames = new Set([
	'ADDRESS',
	'ARTICLE',
	'BLOCKQUOTE',
	'DD',
	'DIV',
	'DL',
	'DT',
	'FIGCAPTION',
	'FIGURE',
	'H1',
	'H2',
	'H3',
	'H4',
	'H5',
	'H6',
	'HEADER',
	'HR',
	'LI',
	'MAIN',
	'OL',
	'P',
	'PRE',
	'SECTION',
	'TABLE',
	'TBODY',
	'TD',
	'TFOOT',
	'TH',
	'THEAD',
	'TR',
	'UL',
]);

function isExcluded(element: Element): boolean {
	return excludedElementNames.has(element.tagName)
		|| element.hasAttribute('hidden')
		|| element.getAttribute('aria-hidden') === 'true';
}

function appendBoundary(chunks: string[]): void {
	if (chunks.length > 0 && chunks.at(-1) !== '\n') {
		chunks.push('\n');
	}
}

function collectReadableText(node: Node, chunks: string[]): void {
	if (node.nodeType === Node.TEXT_NODE) {
		const value = node.textContent?.replace(/\s+/gu, ' ').trim();
		if (value) {
			const previous = chunks.at(-1);
			if (previous && previous !== '\n' && !previous.endsWith(' ')) {
				chunks.push(' ');
			}
			chunks.push(value);
		}
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) {
		return;
	}

	const element = node as Element;
	if (isExcluded(element)) {
		return;
	}
	if (element.tagName === 'BR') {
		appendBoundary(chunks);
		return;
	}

	const isBlock = blockElementNames.has(element.tagName);
	if (isBlock) {
		appendBoundary(chunks);
	}
	for (const child of element.childNodes) {
		collectReadableText(child, chunks);
	}
	if (isBlock) {
		appendBoundary(chunks);
	}
}

export function extractArticleReadableText(root: Element, label: string): string {
	const chunks: string[] = [];
	collectReadableText(root, chunks);
	const text = chunks.join('')
		.replace(/[ \t]+\n/gu, '\n')
		.replace(/\n[ \t]+/gu, '\n')
		.replace(/\n{3,}/gu, '\n\n')
		.trim();
	if (!text) {
		throw new Error(`${label} does not contain readable body content.`);
	}
	const byteLength = new TextEncoder().encode(text).byteLength;
	if (byteLength > maximumArticleReadableContentBytes) {
		throw new RangeError(
			`${label} readable body cannot exceed ${maximumArticleReadableContentBytes} bytes.`,
		);
	}
	return text;
}
