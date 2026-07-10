/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchTargetPreference } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { generateUuid } from 'cs/base/common/uuid';
import type {
	FetchTargetDocument,
	FetchTargetDocumentAdmission,
	FetchTargetLoadOptions,
} from 'cs/workbench/services/fetch/electron-main/fetchTargetService';
import type { FetchTargetService } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';

type FetchTargetRuntime = Pick<
	FetchTargetService,
	'loadBackground' | 'hasWebContentsViewTarget' | 'navigateWebContentsView' | 'waitForWebContentsView'
>;

export interface FetchTargetProviderSource {
	readonly sourceId: string;
	readonly pageUrl: string;
	readonly fetchTarget: FetchTargetPreference;
}

export interface FetchTargetProvider {
	resolveTarget(source: FetchTargetProviderSource): FetchTargetPreference;
	createSession(
		source: FetchTargetProviderSource,
		callbacks: FetchTargetProviderCallbacks,
	): FetchTargetSession;
}

export interface FetchTargetProviderCallbacks {
	onWebContentsViewRequired(targetId: string, pageUrl: string): void;
}

export interface FetchTargetSessionLoadOptions extends FetchTargetLoadOptions {
	readonly admitWebContentsViewDocument: FetchTargetDocumentAdmission;
}

export class FetchTargetSession {
	readonly targetMode: FetchTargetPreference;
	readonly targetId: string | null;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly targetService: FetchTargetRuntime,
		targetMode: FetchTargetPreference,
		private readonly callbacks: FetchTargetProviderCallbacks,
	) {
		this.targetMode = targetMode;
		this.targetId = targetMode === 'webContentsView' ? generateUuid() : null;
	}

	async load(
		pageUrl: string,
		options: FetchTargetSessionLoadOptions,
	): Promise<FetchTargetDocument> {
		const previousTask = this.queue.catch(() => undefined);
		const currentTask = previousTask.then(() => this.loadNow(pageUrl, options));
		this.queue = currentTask.then(
			() => undefined,
			() => undefined,
		);
		return currentTask;
	}

	private async loadNow(
		pageUrl: string,
		options: FetchTargetSessionLoadOptions,
	) {
		if (options.signal?.aborted) {
			throw new DOMException('The Fetch target load was aborted.', 'AbortError');
		}

		if (this.targetMode === 'background') {
			return this.targetService.loadBackground(pageUrl, options);
		}

		const targetId = this.targetId!;
		if (this.targetService.hasWebContentsViewTarget(targetId)) {
			await this.targetService.navigateWebContentsView(targetId, pageUrl);
		} else {
			this.callbacks.onWebContentsViewRequired(targetId, pageUrl);
		}
		return this.targetService.waitForWebContentsView(
			targetId,
			pageUrl,
			options.admitWebContentsViewDocument,
			options,
		);
	}
}

export class ConfiguredFetchTargetProvider implements FetchTargetProvider {
	constructor(private readonly targetService: FetchTargetRuntime) {}

	resolveTarget(source: FetchTargetProviderSource): FetchTargetPreference {
		return source.fetchTarget;
	}

	createSession(
		source: FetchTargetProviderSource,
		callbacks: FetchTargetProviderCallbacks,
	): FetchTargetSession {
		return new FetchTargetSession(
			this.targetService,
			this.resolveTarget(source),
			callbacks,
		);
	}
}
