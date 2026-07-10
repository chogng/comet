/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getDomNodePagePosition, type IDomNodePagePosition } from 'cs/base/browser/dom';
import { Emitter, type Event } from 'cs/base/common/event';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';

export enum BrowserOverlayType {
	Menu = 'menu',
	QuickInput = 'quickInput',
	Hover = 'hover',
	Dialog = 'dialog',
	Notification = 'notification',
	Unknown = 'unknown',
}

type OverlayDefinition = {
	readonly className: string;
	readonly type: BrowserOverlayType;
};

type TrackedOverlay = {
	readonly element: HTMLElement;
	readonly type: BrowserOverlayType;
};

const OVERLAY_DEFINITIONS: readonly OverlayDefinition[] = [
	{ className: 'comet-menu-submenu', type: BrowserOverlayType.Menu },
	{ className: 'comet-quick-input-widget', type: BrowserOverlayType.QuickInput },
	{ className: 'comet-hover-card', type: BrowserOverlayType.Hover },
	{ className: 'comet-dialog-modal-block', type: BrowserOverlayType.Dialog },
	{ className: 'comet-notifications-center', type: BrowserOverlayType.Notification },
	{ className: 'comet-notifications-toasts', type: BrowserOverlayType.Notification },
	{ className: 'comet-context-view', type: BrowserOverlayType.Unknown },
];

export interface IBrowserOverlayInfo {
	readonly type: BrowserOverlayType;
	readonly rect: IDomNodePagePosition;
}

function getOverlappingRectangleCenterPoint(
	left: IDomNodePagePosition,
	right: IDomNodePagePosition,
) {
	const overlapLeft = Math.max(left.left, right.left);
	const overlapTop = Math.max(left.top, right.top);
	const overlapRight = Math.min(left.left + left.width, right.left + right.width);
	const overlapBottom = Math.min(left.top + left.height, right.top + right.height);

	if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
		return null;
	}

	return {
		x: overlapLeft + (overlapRight - overlapLeft) / 2,
		y: overlapTop + (overlapBottom - overlapTop) / 2,
	};
}

export class BrowserOverlayManager {
	private readonly disposables = new DisposableStore();
	private readonly overlayCollections = new Map<string, { type: BrowserOverlayType; collection: HTMLCollectionOf<Element> }>();
	private readonly onDidChangeOverlayStateEmitter = new Emitter<void>();

	readonly onDidChangeOverlayState: Event<void> = this.onDidChangeOverlayStateEmitter.event;

	constructor(private readonly targetWindow: Window) {
		for (const overlayDefinition of OVERLAY_DEFINITIONS) {
			this.overlayCollections.set(overlayDefinition.className, {
				type: overlayDefinition.type,
				collection: this.targetWindow.document.getElementsByClassName(overlayDefinition.className),
			});
		}

		const MutationObserverConstructor = (this.targetWindow as Window & {
			readonly MutationObserver: typeof MutationObserver;
		}).MutationObserver;
		const observer = new MutationObserverConstructor(() => {
			this.onDidChangeOverlayStateEmitter.fire();
		});
		observer.observe(this.targetWindow.document.body, {
			attributes: true,
			attributeFilter: ['class', 'style'],
			childList: true,
			subtree: true,
		});
		this.disposables.add(toDisposable(() => observer.disconnect()));
		this.disposables.add(this.onDidChangeOverlayStateEmitter);
	}

	dispose() {
		this.disposables.dispose();
	}

	getOverlappingOverlays(element: HTMLElement): IBrowserOverlayInfo[] {
		const elementRect = getDomNodePagePosition(element);
		const overlappingOverlays: IBrowserOverlayInfo[] = [];

		for (const overlay of this.overlays()) {
			if (overlay.element.contains(element)) {
				continue;
			}

			const overlayRect = getDomNodePagePosition(overlay.element);
			const overlapCenter = getOverlappingRectangleCenterPoint(elementRect, overlayRect);
			if (!overlapCenter) {
				continue;
			}

			const elementAtPoint = this.getTopmostElementAt(
				overlapCenter.x - this.targetWindow.scrollX,
				overlapCenter.y - this.targetWindow.scrollY,
			);
			if (elementAtPoint && overlay.element.contains(elementAtPoint)) {
				overlappingOverlays.push({
					type: overlay.type,
					rect: overlayRect,
				});
			}
		}

		return overlappingOverlays;
	}

	private *overlays(): Iterable<TrackedOverlay> {
		for (const entry of this.overlayCollections.values()) {
			for (const element of entry.collection) {
				yield {
					element: element as HTMLElement,
					type: entry.type,
				};
			}
		}
	}

	private getTopmostElementAt(clientX: number, clientY: number): Element | null {
		return this.targetWindow.document.elementFromPoint(clientX, clientY);
	}
}
