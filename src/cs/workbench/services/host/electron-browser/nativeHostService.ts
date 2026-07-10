/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	ElectronAPI,
	ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';

class WorkbenchNativeHostService implements INativeHostService {
	declare readonly _serviceBrand: undefined;

	private get api(): ElectronAPI | undefined {
		if (typeof window === 'undefined') {
			return undefined;
		}

		return window.electronAPI;
	}

	canInvoke() {
		return typeof this.api?.invoke === 'function';
	}

	invoke: ElectronInvoke = (command: string, args?: Record<string, unknown>) => {
		if (!this.api?.invoke) {
			return Promise.reject(new Error('Desktop invoke bridge is unavailable.'));
		}

		return this.api.invoke(command, args);
	};

	get ipc() {
		return this.api?.ipc;
	}

	get windowControls() {
		return this.api?.windowControls;
	}

	get webContent() {
		return this.api?.webContent;
	}

	get document() {
		return this.api?.document;
	}
}

export const nativeHostService: INativeHostService =
	new WorkbenchNativeHostService();
