/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRenderedMarkdown, MarkdownRenderOptions, renderMarkdown } from 'cs/base/browser/markdownRenderer';
import { onUnexpectedError } from 'cs/base/common/errors';
import type { IMarkdownString, MarkdownStringTrustedOptions } from 'cs/base/common/htmlContent';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'cs/platform/opener/common/opener';

/**
 * Renders markdown to HTML.
 */
export interface IMarkdownRenderer {
	render(
		markdown: IMarkdownString,
		options?: MarkdownRenderOptions,
		outElement?: HTMLElement,
	): IRenderedMarkdown;
}

export const IMarkdownRendererService = createDecorator<IMarkdownRendererService>('markdownRendererService');

export interface IMarkdownRendererService extends IMarkdownRenderer {
	readonly _serviceBrand: undefined;
}

export class MarkdownRendererService implements IMarkdownRendererService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IOpenerService private readonly openerService: IOpenerService,
	) {}

	render(
		markdown: IMarkdownString,
		options?: MarkdownRenderOptions,
		outElement?: HTMLElement,
	): IRenderedMarkdown {
		const resolvedOptions = { ...options };
		if (!resolvedOptions.actionHandler) {
			resolvedOptions.actionHandler = (link, markdownString) => {
				return openLinkFromMarkdown(this.openerService, link, markdownString.isTrusted);
			};
		}

		const rendered = renderMarkdown(markdown, resolvedOptions, outElement);
		rendered.element.classList.add('rendered-markdown');
		return rendered;
	}
}

export async function openLinkFromMarkdown(
	openerService: IOpenerService,
	link: string,
	isTrusted: boolean | MarkdownStringTrustedOptions | undefined,
	skipValidation?: boolean,
): Promise<boolean> {
	try {
		return await openerService.open(link, {
			fromUserGesture: true,
			allowContributedOpeners: true,
			allowCommands: toAllowCommandsOption(isTrusted),
			skipValidation,
		});
	} catch (error) {
		onUnexpectedError(error);
		return false;
	}
}

function toAllowCommandsOption(isTrusted: boolean | MarkdownStringTrustedOptions | undefined): boolean | readonly string[] {
	if (isTrusted === true) {
		return true;
	}

	if (isTrusted && Array.isArray(isTrusted.enabledCommands)) {
		return isTrusted.enabledCommands;
	}

	return false;
}

registerSingleton(
	IMarkdownRendererService,
	MarkdownRendererService,
	InstantiationType.Delayed,
);
