/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getComparisonKey } from 'cs/base/common/resources';
import type { URI } from 'cs/base/common/uri';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { IChatSelectionFragment } from 'cs/workbench/contrib/chat/common/chatService/chatOwnedAttachments';

export const IChatTranscriptSelectionService =
	createDecorator<IChatTranscriptSelectionService>('chatTranscriptSelectionService');

/** Browser-owned transient Chat transcript selection, separate from pending composer state. */
export interface IChatTranscriptSelectionService {
	readonly _serviceBrand: undefined;
	setSelection(resource: URI, fragments: readonly IChatSelectionFragment[]): void;
	getSelection(resource: URI): readonly IChatSelectionFragment[];
	clearSelection(resource: URI): void;
}

export class ChatTranscriptSelectionService implements IChatTranscriptSelectionService {
	declare readonly _serviceBrand: undefined;

	private readonly selections = new Map<string, readonly IChatSelectionFragment[]>();

	setSelection(resource: URI, fragments: readonly IChatSelectionFragment[]): void {
		const key = getComparisonKey(resource);
		if (fragments.length === 0) {
			this.selections.delete(key);
			return;
		}
		this.selections.set(key, Object.freeze(fragments.map(fragment => Object.freeze({
			message: fragment.message,
			role: fragment.role,
			text: fragment.text,
		}))));
	}

	getSelection(resource: URI): readonly IChatSelectionFragment[] {
		return this.selections.get(getComparisonKey(resource)) ?? [];
	}

	clearSelection(resource: URI): void {
		this.selections.delete(getComparisonKey(resource));
	}
}

registerSingleton(
	IChatTranscriptSelectionService,
	ChatTranscriptSelectionService,
	InstantiationType.Delayed,
);
