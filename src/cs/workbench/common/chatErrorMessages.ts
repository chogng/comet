/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseAppErrorData } from 'cs/base/common/errors';
import type { LocaleMessages } from 'language/locales';
import { formatLocaleMessage, localizeAppError } from 'cs/workbench/common/errorMessages';

export function localizeChatError(ui: LocaleMessages, error: unknown): string {
	return localizeAppError(ui, parseAppErrorData(error));
}

export function formatChatAnswerFailedMessage(ui: LocaleMessages, error: string): string {
	return formatLocaleMessage(ui.toastRagAnswerFailed, { error });
}

export function formatChatPatchApplyFailedMessage(ui: LocaleMessages, error: string): string {
	return formatLocaleMessage(ui.toastAssistantPatchApplyFailed, { error });
}
