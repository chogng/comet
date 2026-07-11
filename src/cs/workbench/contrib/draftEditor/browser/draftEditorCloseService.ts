/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { getLocaleMessages } from 'language/i18n';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import {
	DraftEditorInput,
	IDraftEditorCloseService,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';

export class DraftEditorCloseService implements IDraftEditorCloseService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IDialogService private readonly dialogService: IDialogService,
	) {}

	async confirmClose(input: DraftEditorInput): Promise<boolean> {
		const messages = getLocaleMessages(localeService.getLocale());
		const confirmation = await this.dialogService.prompt<'save' | 'discard'>({
			title: messages.editorUnsavedChangesTitle,
			message: messages.editorUnsavedChangesMessageSingle.replace(
				'{title}',
				input.getName().trim() || messages.editorDraftMode,
			),
			buttons: [
				{
					label: messages.editorUnsavedChangesSave,
					result: 'save',
					primary: true,
				},
				{
					label: messages.editorUnsavedChangesDiscard,
					result: 'discard',
				},
			],
			cancelButton: messages.editorModalCancel,
		});

		if (confirmation.result === 'save') {
			return input.save();
		}
		return confirmation.result === 'discard';
	}
}

registerSingleton(
	IDraftEditorCloseService,
	DraftEditorCloseService,
	InstantiationType.Delayed,
);
