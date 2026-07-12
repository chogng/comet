/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import type { URI } from 'cs/base/common/uri';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { IEditorOptions } from 'cs/workbench/common/editor';

export const IEditorResolverService =
	createDecorator<IEditorResolverService>('editorResolverService');

export const enum RegisteredEditorPriority {
	option = 'option',
	builtin = 'builtin',
	default = 'default',
	exclusive = 'exclusive',
}

export interface IResolvedEditorInput {
	readonly editor: EditorInput;
	readonly options: IEditorOptions | undefined;
}

export interface IEditorResolverRegistration {
	readonly id: string;
	readonly label: string;
	readonly priority: RegisteredEditorPriority;
}

export interface IEditorResolverOptions {
	canSupportResource(resource: URI): boolean;
	readonly singlePerResource?: boolean;
}

export interface IEditorResolverFactory {
	createEditorInput(input: {
		readonly resource: URI;
		readonly options?: IEditorOptions;
	}): IResolvedEditorInput;
}

export interface IEditorResolverService {
	readonly _serviceBrand: undefined;
	registerEditor(
		globPattern: string,
		registration: IEditorResolverRegistration,
		options: IEditorResolverOptions,
		factory: IEditorResolverFactory,
	): IDisposable;
	resolveEditor(input: {
		readonly resource: URI;
		readonly options?: IEditorOptions;
	}): IResolvedEditorInput | undefined;
}

export function priorityToRank(priority: RegisteredEditorPriority): number {
	switch (priority) {
		case RegisteredEditorPriority.exclusive:
			return 5;
		case RegisteredEditorPriority.default:
			return 4;
		case RegisteredEditorPriority.builtin:
			return 3;
		case RegisteredEditorPriority.option:
		default:
			return 1;
	}
}
