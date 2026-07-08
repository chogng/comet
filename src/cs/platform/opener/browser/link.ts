/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode, EventHelper, type EventLike } from 'cs/base/browser/dom';
import { DomEmitter } from 'cs/base/browser/event';
import { StandardKeyboardEvent } from 'cs/base/browser/keyboardEvent';
import { EventType as TouchEventType, Gesture } from 'cs/base/browser/touch';
import { Event } from 'cs/base/common/event';
import { KeyCode } from 'cs/base/common/keyCodes';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { HoverInput, IHoverDelegate } from 'cs/base/browser/ui/hover/hover';
import { IHoverService } from 'cs/platform/hover/browser/hover';
import { IOpenerService } from 'cs/platform/opener/common/opener';

import 'cs/platform/opener/browser/link.css';

export interface ILinkDescriptor {
	readonly label: string | HTMLElement;
	readonly href: string;
	readonly title?: HoverInput;
	readonly tabIndex?: number;
}

export interface ILinkOptions {
	readonly opener?: (href: string) => void;
	readonly hoverDelegate?: IHoverDelegate;
}

export class Link extends Disposable {
	private readonly element: HTMLAnchorElement;
	private hover: IDisposable | undefined;
	private currentLink: ILinkDescriptor;
	private isEnabled = true;

	get enabled(): boolean {
		return this.isEnabled;
	}

	set enabled(enabled: boolean) {
		this.element.setAttribute('aria-disabled', String(!enabled));
		this.element.tabIndex = enabled ? 0 : -1;
		this.element.style.pointerEvents = enabled ? 'auto' : 'none';
		this.element.style.opacity = enabled ? '1' : '0.4';
		this.element.style.cursor = enabled ? 'pointer' : 'default';
		this.isEnabled = enabled;
	}

	set link(link: ILinkDescriptor) {
		if (typeof link.label === 'string') {
			this.element.textContent = link.label;
		} else {
			clearNode(this.element);
			this.element.appendChild(link.label);
		}

		this.element.href = link.href;
		if (typeof link.tabIndex !== 'undefined') {
			this.element.tabIndex = link.tabIndex;
		}

		this.setTooltip(link.title);
		this.currentLink = link;
	}

	constructor(
		container: HTMLElement,
		link: ILinkDescriptor,
		options: ILinkOptions = {},
		@IHoverService private readonly hoverService: IHoverService,
		@IOpenerService openerService: IOpenerService,
	) {
		super();

		this.currentLink = link;
		this.element = append(container, $('a.monaco-link', {
			tabIndex: link.tabIndex ?? 0,
			href: link.href,
		}, link.label));
		this.element.setAttribute('role', 'button');
		this.setTooltip(link.title, options.hoverDelegate);

		const onClick = this._register(new DomEmitter(this.element, 'click'));
		const onKeyDown = this._register(new DomEmitter(this.element, 'keydown'));
		const onKeyActivate = Event.chain(onKeyDown.event, $ =>
			$.map(e => new StandardKeyboardEvent(e))
				.filter(e => e.keyCode === KeyCode.Enter || e.keyCode === KeyCode.Space),
		);
		const onTap = this._register(new DomEmitter(this.element, TouchEventType.Tap)).event;
		this._register(Gesture.addTarget(this.element));

		this._register(Event.any<EventLike>(onClick.event, onKeyActivate, onTap)(event => {
			if (!this.enabled) {
				return;
			}

			EventHelper.stop(event, true);
			if (options.opener) {
				options.opener(this.currentLink.href);
				return;
			}

			void openerService.open(this.currentLink.href, { allowCommands: true, fromUserGesture: true });
		}));

		this.enabled = true;
	}

	private setTooltip(title: HoverInput | undefined, hoverDelegate?: IHoverDelegate): void {
		this.hover?.dispose();
		this.hover = undefined;
		if (!title) {
			return;
		}

		const handle = hoverDelegate
			? hoverDelegate.createHover(this.element, title)
			: this.hoverService.applyHover(this.element, title);
		this.hover = handle;
	}
}
