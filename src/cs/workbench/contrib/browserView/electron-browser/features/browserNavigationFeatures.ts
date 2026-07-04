/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	combinedDisposable,
	DisposableStore,
	MutableDisposable,
	toDisposable,
	type DisposableLike,
} from 'cs/base/common/lifecycle';
import type {
	WebContentBounds,
	WebContentLayoutPhase,
} from 'cs/platform/browserView/common/browserView';
import type { INativeHostService } from 'cs/platform/native/common/native';

type WebContentApi = NonNullable<INativeHostService['webContent']>;

type WebContentLayoutSnapshot = {
	visible: boolean;
	bounds: WebContentBounds | null;
};

type BrowserViewSurfaceSynchronizerOptions = {
	targetWindow: Window;
	webContentApi: WebContentApi;
	getHostElement: () => HTMLElement | null;
	onDidChangeHostElement: (listener: () => void) => DisposableLike;
	getRetentionLimit: () => number;
	onDidChangeRetentionLimit: (listener: () => void) => DisposableLike;
};

function readBrowserViewLayout(browserViewHostElement: HTMLElement | null) {
	if (!browserViewHostElement) {
		return {
			visible: false,
			bounds: null,
		};
	}

	if (browserViewHostElement.dataset.webcontentActive !== 'true') {
		return {
			visible: false,
			bounds: null,
		};
	}

	const rect = browserViewHostElement.getBoundingClientRect();
	const width = Math.round(rect.width);
	const height = Math.round(rect.height);

	if (width <= 0 || height <= 0) {
		return {
			visible: false,
			bounds: null,
		};
	}

	return {
		visible: true,
		bounds: {
			x: Math.round(rect.x),
			y: Math.round(rect.y),
			width,
			height,
		},
	};
}

function areBoundsEqual(
	left: WebContentLayoutSnapshot['bounds'],
	right: WebContentLayoutSnapshot['bounds'],
) {
	return (
		left?.x === right?.x &&
		left?.y === right?.y &&
		left?.width === right?.width &&
		left?.height === right?.height
	);
}

function areLayoutSnapshotsEqual(
	left: WebContentLayoutSnapshot | null,
	right: WebContentLayoutSnapshot | null,
) {
	if (!left || !right) {
		return left === right;
	}

	return left.visible === right.visible && areBoundsEqual(left.bounds, right.bounds);
}

function addDisposableListener(
	target: EventTarget,
	type: string,
	listener: EventListenerOrEventListenerObject,
	options?: boolean | AddEventListenerOptions,
) {
	target.addEventListener(type, listener, options);
	return toDisposable(() => {
		target.removeEventListener(type, listener, options);
	});
}

export class BrowserViewSurfaceSynchronizer {
	private readonly disposables = new DisposableStore();
	private readonly hostObservers = new MutableDisposable<DisposableLike>();
	private readonly scheduledSync = new MutableDisposable<DisposableLike>();
	private browserViewHostElement: HTMLElement | null = null;
	private lastSnapshot: WebContentLayoutSnapshot | null = null;
	private layoutPhase: WebContentLayoutPhase = 'hidden';
	private measuringSnapshot: WebContentLayoutSnapshot | null = null;

	constructor(private readonly options: BrowserViewSurfaceSynchronizerOptions) {
		this.browserViewHostElement = this.options.getHostElement();
		this.disposables.add(this.hostObservers);
		this.disposables.add(this.scheduledSync);
		this.disposables.add(this.options.onDidChangeRetentionLimit(() => this.syncRetentionLimit()));
		this.disposables.add(this.options.onDidChangeHostElement(() => this.syncFromPartDom()));
		this.disposables.add(
			addDisposableListener(this.options.targetWindow, 'resize', () => this.scheduleSync()),
		);

		this.syncRetentionLimit();
		this.resetObserver();
		this.scheduleSync();
	}

	dispose() {
		this.disposables.dispose();
		this.applySurfaceState(false, 'hidden', null);
	}

	private syncRetentionLimit() {
		this.options.webContentApi.setRetentionLimit(this.options.getRetentionLimit());
	}

	private scheduleSync() {
		if (this.scheduledSync.value) {
			return;
		}

		let frameId = 0;
		const frameDisposable = toDisposable(() => {
			this.options.targetWindow.cancelAnimationFrame(frameId);
		});
		this.scheduledSync.value = frameDisposable;
		frameId = this.options.targetWindow.requestAnimationFrame(() => {
			if (this.scheduledSync.value === frameDisposable) {
				this.scheduledSync.clearAndLeak();
			}

			const nextSnapshot = readBrowserViewLayout(this.browserViewHostElement);

			if (!nextSnapshot.visible) {
				this.layoutPhase = 'hidden';
				this.measuringSnapshot = null;
				this.applySurfaceState(false, 'hidden', null);
				this.lastSnapshot = nextSnapshot;
				return;
			}

			if (this.layoutPhase === 'hidden') {
				this.layoutPhase = 'measuring';
				this.measuringSnapshot = nextSnapshot;
				this.applySurfaceState(true, 'measuring', nextSnapshot.bounds);
				this.scheduleSync();
				return;
			}

			if (this.layoutPhase === 'measuring') {
				if (areLayoutSnapshotsEqual(this.measuringSnapshot, nextSnapshot)) {
					this.layoutPhase = 'visible';
					this.measuringSnapshot = null;
					this.applySurfaceState(true, 'visible', nextSnapshot.bounds);
					this.lastSnapshot = nextSnapshot;
					return;
				}

				this.measuringSnapshot = nextSnapshot;
				this.applySurfaceState(true, 'measuring', nextSnapshot.bounds);
				this.scheduleSync();
				return;
			}

			if (!areLayoutSnapshotsEqual(this.lastSnapshot, nextSnapshot)) {
				this.applySurfaceState(true, 'visible', nextSnapshot.bounds);
			}
			this.lastSnapshot = nextSnapshot;
		});
	}

	private resetObserver() {
		this.hostObservers.clear();

		if (!this.browserViewHostElement) {
			return;
		}

		const mutationObserver = new MutationObserver(() => {
			this.layoutPhase = 'hidden';
			this.measuringSnapshot = null;
			this.scheduleSync();
		});
		mutationObserver.observe(this.browserViewHostElement, {
			attributes: true,
			attributeFilter: ['data-webcontent-active'],
		});
		const observerDisposables: DisposableLike[] = [
			toDisposable(() => {
				mutationObserver.disconnect();
			}),
		];

		if (typeof ResizeObserver !== 'undefined') {
			const resizeObserver = new ResizeObserver(() => this.scheduleSync());
			resizeObserver.observe(this.browserViewHostElement);
			observerDisposables.push(
				toDisposable(() => {
					resizeObserver.disconnect();
				}),
			);
		}

		this.hostObservers.value = combinedDisposable(...observerDisposables);
	}

	private syncFromPartDom() {
		const nextBrowserViewHostElement = this.options.getHostElement();
		if (nextBrowserViewHostElement !== this.browserViewHostElement) {
			this.browserViewHostElement = nextBrowserViewHostElement;
			this.layoutPhase = 'hidden';
			this.measuringSnapshot = null;
			this.resetObserver();
		}

		this.scheduleSync();
	}

	private applySurfaceState(
		visible: boolean,
		phase: WebContentLayoutPhase,
		bounds: WebContentBounds | null,
	) {
		this.options.webContentApi.setBounds(bounds);
		this.options.webContentApi.setVisible(visible);
		this.options.webContentApi.setLayoutPhase(phase);
	}
}
