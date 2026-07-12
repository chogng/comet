/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DropdownOption } from 'cs/base/browser/ui/dropdown/dropdown';
import type { URI } from 'cs/base/common/uri';
import type { LlmProviderId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
	LlmReasoningEffort,
	LlmServiceTier,
} from 'cs/workbench/services/llm/registry';

export type ChatModelDropdownOption = DropdownOption & {
	readonly providerId?: LlmProviderId;
	readonly modelId?: string;
	readonly modelLabel?: string;
	readonly reasoningEffort?: LlmReasoningEffort;
	readonly serviceTier?: LlmServiceTier;
};

/** Presentation supplied for the Chat model currently bound to a widget. */
export interface IChatWidgetPresentation {
	readonly chatResource: URI;
	readonly readOnly: boolean;
	readonly modelOptions: readonly ChatModelDropdownOption[];
	readonly selectedModelId: string | undefined;
	readonly activeModelLabel: string;
}

/** Identifies the addressed Chat whose composer submitted a request. */
export interface IChatWidgetSubmitEvent {
	readonly chatResource: URI;
}

/** Identifies an addressed Chat model-selection intent. */
export interface IChatWidgetModelSelectionEvent {
	readonly chatResource: URI;
	readonly modelId: string | undefined;
}
