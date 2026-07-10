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

// These transparent layers capture input for context views but are not the visible overlay.
const CONTEXT_VIEW_BLOCKER_CLASSES = ['context-view-block', 'context-view-pointerBlock'];

/** Describes a visible overlay that overlaps a browser host. */
export interface IBrowserOverlayInfo {
	readonly type: BrowserOverlayType;
	readonly rect: IDomNodePagePosition;
}

function isContextViewBlocker(element: Element): boolean {
	return CONTEXT_VIEW_BLOCKER_CLASSES.some(className => element.classList.contains(className));
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

/** Tracks Comet overlays and reports when they obscure a browser host. */
export class BrowserOverlayManager {
	private readonly disposables = new DisposableStore();
	private readonly overlayCollections = new Map<string, { type: BrowserOverlayType; collection: HTMLCollectionOf<Element> }>();
	private readonly shadowRootHostCollection: HTMLCollectionOf<Element>;
	private readonly shadowRootObservers = new WeakMap<ShadowRoot, MutationObserver>();
	private readonly onDidChangeOverlayStateEmitter = new Emitter<void>();

	/** Fires when overlay DOM, geometry, or visibility may have changed. */
	readonly onDidChangeOverlayState: Event<void> = this.onDidChangeOverlayStateEmitter.event;

	constructor(private readonly targetWindow: Window) {
		for (const overlayDefinition of OVERLAY_DEFINITIONS) {
			this.overlayCollections.set(overlayDefinition.className, {
				type: overlayDefinition.type,
				collection: this.targetWindow.document.getElementsByClassName(overlayDefinition.className),
			});
		}
		this.shadowRootHostCollection = this.targetWindow.document.getElementsByClassName('shadow-root-host');

		const MutationObserverConstructor = (this.targetWindow as Window & {
			readonly MutationObserver: typeof MutationObserver;
		}).MutationObserver;
		const observer = new MutationObserverConstructor(() => {
			this.updateShadowRootObservers();
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
		this.updateShadowRootObservers();
	}

	dispose() {
		for (const hostElement of this.shadowRootHostCollection) {
			const shadowRoot = (hostElement as HTMLElement).shadowRoot;
			const observer = shadowRoot ? this.shadowRootObservers.get(shadowRoot) : undefined;
			observer?.disconnect();
		}
		this.disposables.dispose();
	}

	/** Returns overlays whose visible rectangles cover part of the given element. */
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

		// Overlay classes inside open Shadow Roots are invisible to document collections.
		for (const hostElement of this.shadowRootHostCollection) {
			const shadowRoot = hostElement.shadowRoot;
			if (!shadowRoot) {
				continue;
			}

			for (const overlayDefinition of OVERLAY_DEFINITIONS) {
				for (const element of shadowRoot.querySelectorAll(`.${overlayDefinition.className}`)) {
					yield {
						element: element as HTMLElement,
						type: overlayDefinition.type,
					};
				}
			}
		}
	}

	private getTopmostElementAt(clientX: number, clientY: number): Element | null {
		const topmostAt = (root: Document | ShadowRoot): Element | null => {
			const elementAtPoint = root.elementFromPoint(clientX, clientY);
			if (elementAtPoint && !isContextViewBlocker(elementAtPoint)) {
				return elementAtPoint;
			}

			// A blocker can be topmost while the overlay beneath it is the visible obstruction.
			const elementsFromPoint = root.elementsFromPoint(clientX, clientY);
			return elementsFromPoint.find(element => !isContextViewBlocker(element)) ?? null;
		};

		const elementAtPoint = topmostAt(this.targetWindow.document);
		if (elementAtPoint?.shadowRoot) {
			return topmostAt(elementAtPoint.shadowRoot);
		}
		return elementAtPoint;
	}

	private updateShadowRootObservers() {
		// Shadow roots need their own observer because document mutations do not cross the boundary.
		for (const hostElement of this.shadowRootHostCollection) {
			const shadowRoot = hostElement.shadowRoot;
			if (!shadowRoot || this.shadowRootObservers.has(shadowRoot)) {
				continue;
			}

			const MutationObserverConstructor = (this.targetWindow as Window & {
				readonly MutationObserver: typeof MutationObserver;
			}).MutationObserver;
			const observer = new MutationObserverConstructor(() => {
				this.onDidChangeOverlayStateEmitter.fire();
			});
			observer.observe(shadowRoot, {
				attributes: true,
				attributeFilter: ['class', 'style'],
				childList: true,
				subtree: true,
			});
			this.shadowRootObservers.set(shadowRoot, observer);
		}
	}
}
