/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import { ApplicationStorageService } from 'cs/platform/storage/common/storageService';
import type { IStorageService } from 'cs/platform/storage/common/storage';

export function createTestChatStorageService(): IStorageService {
	return Object.assign(
		new ApplicationStorageService(new Storage(new InMemoryStorageDatabase())),
		{ _serviceBrand: undefined },
	) as IStorageService;
}
