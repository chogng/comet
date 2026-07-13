/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { maximumBrowserViewReadableContentCharacters } from 'cs/platform/browserView/common/browserView';

export interface BrowserViewReadableContentEvaluation {
	readonly text: string;
	readonly truncated: boolean;
}

export function parseBrowserViewReadableContentEvaluation(
	value: unknown,
): BrowserViewReadableContentEvaluation | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate);
	if (
		keys.length !== 2 ||
		!keys.includes('text') ||
		!keys.includes('truncated') ||
		typeof candidate.text !== 'string' ||
		candidate.text.length > maximumBrowserViewReadableContentCharacters ||
		typeof candidate.truncated !== 'boolean'
	) {
		return undefined;
	}
	return {
		text: candidate.text,
		truncated: candidate.truncated,
	};
}
