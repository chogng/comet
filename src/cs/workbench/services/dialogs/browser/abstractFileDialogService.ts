/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type {
	NativeFileDialogFilter,
	NativeOpenDialogOptions,
	NativeOpenDialogProperty,
	NativeSaveDialogOptions,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
	IFileDialogFilter,
	IFileDialogService,
	IOpenDialogOptions,
	ISaveDialogOptions,
} from 'cs/workbench/services/dialogs/common/dialogService';

function toNativeFilters(filters: readonly IFileDialogFilter[] | undefined): NativeFileDialogFilter[] | undefined {
	if (!filters) {
		return undefined;
	}

	return filters.map(filter => ({
		name: filter.name,
		extensions: [...filter.extensions],
	}));
}

export abstract class AbstractFileDialogService implements IFileDialogService {
	declare readonly _serviceBrand: undefined;

	abstract showOpenDialog(options: IOpenDialogOptions): Promise<URI[] | undefined>;
	abstract showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined>;

	pickFileToSave(defaultUri: URI, _availableFileSystems?: readonly string[]) {
		return this.showSaveDialog({ defaultUri });
	}

	protected toNativeOpenDialogOptions(options: IOpenDialogOptions): NativeOpenDialogOptions {
		const properties: NativeOpenDialogProperty[] = ['createDirectory'];

		if (options.canSelectFiles !== false) {
			properties.push('openFile');
		}

		if (options.canSelectFolders) {
			properties.push('openDirectory');
		}

		if (options.canSelectMany) {
			properties.push('multiSelections');
		}

		return {
			title: options.title,
			defaultPath: options.defaultUri?.fsPath,
			buttonLabel: options.openLabel,
			filters: toNativeFilters(options.filters),
			properties,
		};
	}

	protected toNativeSaveDialogOptions(options: ISaveDialogOptions): NativeSaveDialogOptions {
		return {
			title: options.title,
			defaultPath: options.defaultUri?.fsPath,
			buttonLabel: options.saveLabel,
			filters: toNativeFilters(options.filters),
		};
	}
}
