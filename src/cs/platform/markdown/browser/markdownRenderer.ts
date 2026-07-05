/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRenderedMarkdown, MarkdownRenderOptions, renderMarkdown } from 'cs/base/browser/markdownRenderer';
import type { IMarkdownString } from 'cs/base/common/htmlContent';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

/**
 * Renders markdown to HTML elements.
 * 
 * This interface is intended to be used by clients that want to render markdown content to HTML elements. 
 * It provides a method to render markdown strings with optional rendering options and an output element.
 * 
 * If you want to render markdown content in a standard way, 
 * prefer using the {@linkcode IMarkdownRendererService} service instead of implementing this interface directly.
 */


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
