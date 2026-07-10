/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchTargetPreference } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { generateUuid } from 'cs/base/common/uuid';
import type { URI } from 'cs/base/common/uri';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import type {
	FetchTargetDocument,
	FetchTargetDocumentAdmission,
	FetchTargetLoadOptions,
} from 'cs/workbench/services/fetch/electron-main/fetchTargetService';
import type { FetchTargetService } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';

type FetchTargetRuntime = Pick<
	FetchTargetService,
	'hasTarget' | 'ensureTarget' | 'waitForEditorTarget' | 'load' | 'destroyTarget'
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
	onBrowserTargetRequired(resource: URI, pageUrl: string): void;
}

export interface FetchTargetSessionLoadOptions extends FetchTargetLoadOptions {
	readonly admitDocument: FetchTargetDocumentAdmission;
}

export class FetchTargetSession {
	readonly targetMode: FetchTargetPreference;
	readonly resource: URI;
	private queue: Promise<void> = Promise.resolve();

	constructor(
		private readonly targetService: FetchTargetRuntime,
		targetMode: FetchTargetPreference,
		private readonly callbacks: FetchTargetProviderCallbacks,
	) {
		this.targetMode = targetMode;
		this.resource = BrowserViewUri.forId(generateUuid());
	}

	get targetId(): string {
		return BrowserViewUri.getId(this.resource)!;
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

		const hadTarget = this.targetService.hasTarget(this.resource);
		await this.targetService.ensureTarget(this.resource);
		if (this.targetMode === 'webContentsView' && !hadTarget) {
			this.callbacks.onBrowserTargetRequired(this.resource, pageUrl);
		}
		if (this.targetMode === 'webContentsView') {
			await this.targetService.waitForEditorTarget(this.resource, pageUrl, options);
		}
		return this.targetService.load(
			this.resource,
			this.targetMode,
			pageUrl,
			options.admitDocument,
			options,
		);
	}

	async dispose(): Promise<void> {
		await this.queue;
		if (this.targetService.hasTarget(this.resource)) {
			await this.targetService.destroyTarget(this.resource);
		}
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
