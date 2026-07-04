/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, reset } from 'cs/base/browser/dom';
import type {
	IRenderedMarkdown,
	MarkdownRenderOptions,
} from 'cs/base/browser/markdownRenderer';
import { renderMarkdown } from 'cs/base/browser/markdownRenderer';
import type { IMarkdownString } from 'cs/base/common/htmlContent';
import type { MarkedExtension } from 'cs/base/common/marked/marked';
import { Schemas } from 'cs/base/common/network';

const remoteImageDisallowed = () => false;

const nonPlainTextMarkdownSyntax = /[\\`*_[\]<>|&$]/;
const gfmAutolink = /\b(?:https?:\/\/|www\.)/i;
const gfmStrikethrough = /~~/;
const blockMarkdownSyntax = /(^|\n)\s{0,3}(?:#{1,6}\s|>\s?|[-+]\s|\d+[.)]\s|---+\s*$)/;

const literalSingleTildeExtension: MarkedExtension = {
	extensions: [{
		name: 'literalSingleTilde',
		level: 'inline',
		tokenizer: source => {
			if (source[0] === '~' && source[1] !== '~') {
				return { type: 'text', raw: '~', text: '~' };
			}
			return undefined;
		},
	}],
};

function renderPlainTextMarkdown(
	markdown: IMarkdownString,
	outElement?: HTMLElement,
): IRenderedMarkdown | undefined {
	const value = markdown.value;
	if (
		!value ||
		value.includes('\n') ||
		nonPlainTextMarkdownSyntax.test(value) ||
		gfmAutolink.test(value) ||
		gfmStrikethrough.test(value) ||
		blockMarkdownSyntax.test(value)
	) {
		return undefined;
	}

	const element = outElement ?? $('div');
	element.classList.add('rendered-markdown');
	reset(element, $('p', undefined, value.length > 100_000 ? `${value.substr(0, 100_000)}...` : value));
	return {
		element,
		dispose: () => {},
	};
}

export const allowedChatMarkdownHtmlTags = Object.freeze([
	'b',
	'blockquote',
	'br',
	'code',
	'del',
	'em',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'i',
	'ins',
	'li',
	'ol',
	'p',
	'pre',
	's',
	'strong',
	'sub',
	'sup',
	'table',
	'tbody',
	'td',
	'th',
	'thead',
	'tr',
	'ul',
	'a',
	'img',
	'span',
	'div',
	'input',
]);

export function getChatMarkdownRenderOptions(
	options?: MarkdownRenderOptions,
): MarkdownRenderOptions {
	return {
		...options,
		markedExtensions: options?.markedExtensions?.includes(literalSingleTildeExtension)
			? options.markedExtensions
			: [...(options?.markedExtensions ?? []), literalSingleTildeExtension],
		sanitizerConfig: {
			replaceWithPlaintext: true,
			allowedTags: {
				override: allowedChatMarkdownHtmlTags,
			},
			...options?.sanitizerConfig,
			allowedLinkSchemes: {
				augment: [Schemas.vscodeBrowser],
			},
			remoteImageIsAllowed: remoteImageDisallowed,
		},
	};
}

export class ChatContentMarkdownRenderer {
	render(
		markdown: IMarkdownString,
		options?: MarkdownRenderOptions,
		outElement?: HTMLElement,
	): IRenderedMarkdown {
		const plainTextResult = renderPlainTextMarkdown(markdown, outElement);
		if (plainTextResult) {
			return plainTextResult;
		}

		const result = renderMarkdown(
			markdown,
			getChatMarkdownRenderOptions(options),
			outElement,
		);

		result.element.classList.add('rendered-markdown');
		result.element.normalize();
		for (const child of Array.from(result.element.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
				child.replaceWith($('p', undefined, child.textContent));
			}
		}

		return result;
	}
}
