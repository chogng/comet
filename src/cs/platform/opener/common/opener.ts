/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IOpenerService = createDecorator<IOpenerService>('openerService');

export type OpenInternalOptions = {
	readonly openToSide?: boolean;
	readonly editorOptions?: unknown;
	readonly fromUserGesture?: boolean;
	readonly allowCommands?: boolean | readonly string[];
};

export type OpenExternalOptions = {
	readonly openExternal?: boolean;
	readonly allowTunneling?: boolean;
	readonly allowContributedOpeners?: boolean | string;
	readonly fromWorkspace?: boolean;
	readonly skipValidation?: boolean;
};

export type OpenOptions = OpenInternalOptions & OpenExternalOptions;

export type ResolveExternalUriOptions = {
	readonly allowTunneling?: boolean;
};

export interface IResolvedExternalUri extends IDisposable {
	resolved: URI;
}

export interface IOpener {
	open(resource: URI | string, options?: OpenOptions): Promise<boolean>;
}

export interface IExternalOpener {
	openExternal(
		href: string,
		context: { sourceUri: URI; preferredOpenerId?: string },
		token: CancellationToken,
	): Promise<boolean>;
	dispose?(): void;
}

export interface IValidator {
	shouldOpen(resource: URI | string, openOptions?: OpenOptions): Promise<boolean>;
}

export interface IExternalUriResolver {
	resolveExternalUri(
		resource: URI,
		options?: OpenOptions,
	): Promise<{ resolved: URI; dispose(): void } | undefined>;
}

export interface IOpenerService {
	readonly _serviceBrand: undefined;

	registerOpener(opener: IOpener): IDisposable;
	registerValidator(validator: IValidator): IDisposable;
	registerExternalUriResolver(resolver: IExternalUriResolver): IDisposable;
	setDefaultExternalOpener(opener: IExternalOpener): void;
	registerExternalOpener(opener: IExternalOpener): IDisposable;
	open(resource: URI | string, options?: OpenOptions): Promise<boolean>;
	resolveExternalUri(resource: URI, options?: ResolveExternalUriOptions): Promise<IResolvedExternalUri>;
}

export interface ITextEditorSelection {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber?: number;
	readonly endColumn?: number;
}

export function withSelection(uri: URI, selection: ITextEditorSelection): URI {
	return uri.with({
		fragment: `${selection.startLineNumber},${selection.startColumn}${selection.endLineNumber ? `-${selection.endLineNumber}${selection.endColumn ? `,${selection.endColumn}` : ''}` : ''}`,
	});
}

export function extractSelection(uri: URI): { selection: ITextEditorSelection | undefined; uri: URI } {
	let selection: ITextEditorSelection | undefined;
	const match = /^L?(\d+)(?:,(\d+))?(-L?(\d+)(?:,(\d+))?)?/.exec(uri.fragment);
	if (match) {
		selection = {
			startLineNumber: Number.parseInt(match[1], 10),
			startColumn: match[2] ? Number.parseInt(match[2], 10) : 1,
			endLineNumber: match[4] ? Number.parseInt(match[4], 10) : undefined,
			endColumn: match[4] ? (match[5] ? Number.parseInt(match[5], 10) : 1) : undefined,
		};
		uri = uri.with({ fragment: '' });
	}
	return { selection, uri };
}
