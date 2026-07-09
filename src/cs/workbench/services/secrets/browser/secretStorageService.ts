/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService } from 'cs/platform/storage/common/storage';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
	BaseSecretStorageService,
	ISecretStorageService,
} from 'cs/platform/secrets/common/secret';

export class BrowserSecretStorageService extends BaseSecretStorageService {
	constructor(@IStorageService storageService: IStorageService) {
		super(storageService);
	}
}

registerSingleton(
	ISecretStorageService,
	BrowserSecretStorageService,
	InstantiationType.Delayed,
);
