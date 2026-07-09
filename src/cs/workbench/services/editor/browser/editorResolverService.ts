/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
	IEditorResolverService,
	priorityToRank,
	type IEditorResolverFactory,
	type IEditorResolverOptions,
	type IEditorResolverRegistration,
	type IResolvedEditorInput,
} from 'cs/workbench/services/editor/common/editorResolverService';
import type { URI } from 'cs/base/common/uri';
import type { IEditorOptions } from 'cs/workbench/common/editor';

type EditorResolverEntry = {
	readonly globPattern: string;
	readonly registration: IEditorResolverRegistration;
	readonly options: IEditorResolverOptions;
	readonly factory: IEditorResolverFactory;
};

function globPatternMatchesResource(globPattern: string, resource: URI): boolean {
	if (globPattern === '*') {
		return true;
	}

	const schemeWildcardSuffix = ':/**';
	if (globPattern.endsWith(schemeWildcardSuffix)) {
		return resource.scheme === globPattern.slice(0, -schemeWildcardSuffix.length);
	}

	return resource.toString() === globPattern;
}

export class EditorResolverService implements IEditorResolverService {
	declare readonly _serviceBrand: undefined;

	private readonly entries: EditorResolverEntry[] = [];

	registerEditor(
		globPattern: string,
		registration: IEditorResolverRegistration,
		options: IEditorResolverOptions,
		factory: IEditorResolverFactory,
	): IDisposable {
		const entry: EditorResolverEntry = {
			globPattern,
			registration,
			options,
			factory,
		};
		this.entries.push(entry);

		return toDisposable(() => {
			const index = this.entries.indexOf(entry);
			if (index >= 0) {
				this.entries.splice(index, 1);
			}
		});
	}

	resolveEditor(input: {
		readonly resource: URI;
		readonly options?: IEditorOptions;
	}): IResolvedEditorInput | undefined {
		const [entry] = this.entries
			.filter(candidate =>
				globPatternMatchesResource(candidate.globPattern, input.resource) &&
				candidate.options.canSupportResource(input.resource))
			.sort((left, right) => {
				const priorityDelta =
					priorityToRank(right.registration.priority) -
					priorityToRank(left.registration.priority);
				if (priorityDelta !== 0) {
					return priorityDelta;
				}

				return right.globPattern.length - left.globPattern.length;
			});
		return entry?.factory.createEditorInput(input);
	}
}

registerSingleton(
	IEditorResolverService,
	EditorResolverService,
	InstantiationType.Delayed,
);
