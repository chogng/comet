/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import { INativeHostService } from 'cs/platform/native/common/native';
import { AbstractFileDialogService } from 'cs/workbench/services/dialogs/browser/abstractFileDialogService';
import {
	IFileDialogService,
	type IOpenDialogOptions,
	type ISaveDialogOptions,
} from 'cs/workbench/services/dialogs/common/dialogService';

export class FileDialogService extends AbstractFileDialogService implements IFileDialogService {
	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();
	}

	async showOpenDialog(options: IOpenDialogOptions): Promise<URI[] | undefined> {
		const result = await this.nativeHostService.invoke(
			'show_open_dialog',
			this.toNativeOpenDialogOptions(options),
		);

		if (result.canceled || result.filePaths.length === 0) {
			return undefined;
		}

		return result.filePaths.map(filePath => URI.file(filePath));
	}

	async showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined> {
		const result = await this.nativeHostService.invoke(
			'show_save_dialog',
			this.toNativeSaveDialogOptions(options),
		);

		if (result.canceled || !result.filePath) {
			return undefined;
		}

		return URI.file(result.filePath);
	}
}

registerSingleton(IFileDialogService, FileDialogService, InstantiationType.Delayed);
