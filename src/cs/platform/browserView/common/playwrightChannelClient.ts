/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import type {
	IBrowserPageSnapshot,
	IInvokeFunctionResult,
	IPageSnapshotOptions,
	IPageTrackingLease,
	IPlaywrightService,
} from 'cs/platform/browserView/common/playwrightService';

/** Routes typed Playwright service operations over the shared-process channel. */
export class PlaywrightChannelClient implements IPlaywrightService {
	declare readonly _serviceBrand: undefined;
	readonly onDidChangeTrackedPages: Event<readonly string[]>;

	constructor(
		private readonly channel: IChannel,
		private readonly windowId?: number,
	) {
		this.onDidChangeTrackedPages = this.channel.listen(
			'onDidChangeTrackedPages',
			this.createChannelArgument(undefined),
		);
	}

	acquirePageTracking(viewId: string): Promise<IPageTrackingLease> {
		return this.call('acquirePageTracking', [viewId]);
	}

	releasePageTracking(lease: IPageTrackingLease): Promise<void> {
		return this.call('releasePageTracking', [lease]);
	}

	isPageTracked(viewId: string): Promise<boolean> {
		return this.call('isPageTracked', [viewId]);
	}

	getTrackedPages(): Promise<readonly string[]> {
		return this.call('getTrackedPages');
	}

	openPage(sessionId: string, url: string): Promise<{ pageId: string; summary: string }> {
		return this.call('openPage', [sessionId, url]);
	}

	getSummary(sessionId: string, pageId: string): Promise<string> {
		return this.call('getSummary', [sessionId, pageId]);
	}

	navigatePage(sessionId: string, trackingLease: IPageTrackingLease, url: string, token: CancellationToken): Promise<void> {
		return this.call('navigatePage', [sessionId, trackingLease, url], token);
	}

	async captureSnapshot(
		sessionId: string,
		trackingLease: IPageTrackingLease,
		options: IPageSnapshotOptions | undefined,
		token: CancellationToken,
	): Promise<IBrowserPageSnapshot> {
		const snapshot = await this.call<
			Omit<IBrowserPageSnapshot, 'uri'> & { uri: Parameters<typeof URI.revive>[0] }
		>('captureSnapshot', [sessionId, trackingLease, options], token);
		const uri = URI.revive(snapshot.uri);
		if (!uri) {
			throw new Error('Shared process returned a snapshot without a URI.');
		}
		return { ...snapshot, uri };
	}

	invokeFunctionRaw<T>(
		sessionId: string,
		pageId: string,
		fnDef: string,
		...args: unknown[]
	): Promise<T> {
		return this.call('invokeFunctionRaw', [sessionId, pageId, fnDef, ...args]);
	}

	invokeFunction(
		sessionId: string,
		pageId: string,
		fnDef: string,
		args: unknown[] = [],
		timeoutMs?: number,
	): Promise<IInvokeFunctionResult> {
		return this.call('invokeFunction', [sessionId, pageId, fnDef, args, timeoutMs]);
	}

	waitForDeferredResult(
		sessionId: string,
		deferredResultId: string,
		timeoutMs: number,
	): Promise<IInvokeFunctionResult> {
		return this.call('waitForDeferredResult', [sessionId, deferredResultId, timeoutMs]);
	}

	replyToFileChooser(
		sessionId: string,
		pageId: string,
		files: string[],
	): Promise<{ summary: string }> {
		return this.call('replyToFileChooser', [sessionId, pageId, files]);
	}

	replyToDialog(
		sessionId: string,
		pageId: string,
		accept: boolean,
		promptText?: string,
	): Promise<{ summary: string }> {
		return this.call('replyToDialog', [sessionId, pageId, accept, promptText]);
	}

	disposeSession(sessionId: string): Promise<void> {
		return this.call('disposeSession', [sessionId]);
	}

	private call<T = unknown>(
		command: string,
		args: unknown[] = [],
		token?: CancellationToken,
	): Promise<T> {
		return this.channel.call<T>(command, this.createChannelArgument(args), token);
	}

	private createChannelArgument(value: unknown): unknown {
		return this.windowId === undefined ? value : [this.windowId, value];
	}
}
