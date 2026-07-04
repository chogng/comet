/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IRenderedMarkdown,
	MarkdownRenderOptions,
} from 'cs/base/browser/markdownRenderer';
import { renderMarkdown } from 'cs/base/browser/markdownRenderer';
import type { IMarkdownString } from 'cs/base/common/htmlContent';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export interface IMarkdownRenderer {
	render(
		markdown: IMarkdownString,
		options?: MarkdownRenderOptions,
		outElement?: HTMLElement,
	): IRenderedMarkdown;
}

export const IMarkdownRendererService =
	createDecorator<IMarkdownRendererService>('markdownRendererService');

export interface IMarkdownRendererService extends IMarkdownRenderer {
	readonly _serviceBrand: undefined;
}

export class MarkdownRendererService implements IMarkdownRendererService {
	declare readonly _serviceBrand: undefined;

	render(
		markdown: IMarkdownString,
		options?: MarkdownRenderOptions,
		outElement?: HTMLElement,
	): IRenderedMarkdown {
		const rendered = renderMarkdown(markdown, options, outElement);
		rendered.element.classList.add('rendered-markdown');
		return rendered;
	}
}

registerSingleton(
	IMarkdownRendererService,
	MarkdownRendererService,
	InstantiationType.Delayed,
);
