/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import { SessionView } from 'cs/sessions/browser/parts/sessions/sessionView';
import { CollapsedEditorTitlebarActionsView } from 'cs/sessions/browser/parts/sessions/collapsedEditorTitlebarActions';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import {
	ISessionsPartService,
	type ISessionsPartFocusTarget,
} from 'cs/sessions/services/sessions/browser/sessionsPartService';
import {
	type IActiveSession,
	type IVisibleSessionSlot,
	isNewSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';

import 'cs/sessions/browser/parts/sessions/media/sessionsPart.css';

interface ISessionSlotRecord {
	readonly slot: IVisibleSessionSlot;
	readonly view: SessionView;
	readonly disposables: DisposableStore;
}

/** Mounted passive Sessions Part and the concrete Part-service implementation. */
export class SessionsPart extends Disposable implements ISessionsPartService {
	declare readonly _serviceBrand: undefined;
	readonly id = SESSION_PART_IDS.sessions;

	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-sessions-part');
	private readonly titlebarElement = $<HTMLElementTagNameMap['header']>('header.comet-session-titlebar');
	private readonly titlebarLeadingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-titlebar-leading');
	private readonly titlebarTrailingElement = $<HTMLElementTagNameMap['div']>('div.comet-session-titlebar-trailing');
	private readonly windowControlsSpacerElement = $<HTMLElementTagNameMap['div']>('div.comet-titlebar-window-controls-spacer');
	private readonly gridElement = $<HTMLElementTagNameMap['div']>('div.comet-sessions-grid');
	private readonly collapsedEditorActionsView: CollapsedEditorTitlebarActionsView;
	private readonly records = new Map<IVisibleSessionSlot, ISessionSlotRecord>();
	private visibleSlots: readonly IVisibleSessionSlot[] = [];
	private layoutWidth = 0;
	private layoutHeight = 0;

	private readonly focusSlotEmitter = this._register(new Emitter<ISessionsPartFocusTarget>());
	readonly onDidFocusSlot: Event<ISessionsPartFocusTarget> = this.focusSlotEmitter.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.collapsedEditorActionsView = this._register(
			this.instantiationService.createInstance(CollapsedEditorTitlebarActionsView),
		);
		this._register(this.layoutService.onDidChangeLayoutState(this.renderCollapsedEditorActions, this));
		this.titlebarElement.append(
			this.titlebarLeadingElement,
			this.titlebarTrailingElement,
			this.windowControlsSpacerElement,
		);
		this.element.append(this.titlebarElement, this.gridElement);
		this.renderCollapsedEditorActions();
	}

	getElement(): HTMLElement {
		return this.element;
	}

	updateVisibleSessions(
		visibleSessions: readonly IVisibleSessionSlot[],
		activeSession: IActiveSession | undefined,
	): void {
		this.assertState(visibleSessions, activeSession);
		const retained = new Set<IVisibleSessionSlot>();
		for (const slot of visibleSessions) {
			retained.add(slot);
			const record = this.records.get(slot) ?? this.createRecord(slot);
			record.view.setActive(isNewSessionSlot(slot) ? activeSession === undefined : slot === activeSession);
			this.gridElement.append(record.view.getElement());
		}
		for (const [slot, record] of this.records) {
			if (!retained.has(slot)) {
				this.records.delete(slot);
				record.disposables.dispose();
			}
		}
		this.visibleSlots = [...visibleSessions];
		this.gridElement.style.setProperty('--comet-visible-session-count', String(visibleSessions.length));
		this.layout(this.layoutWidth, this.layoutHeight);
	}

	focusSession(session: IActiveSession | undefined): void {
		const slot = session ?? this.visibleSlots.find(isNewSessionSlot);
		if (!slot || !this.visibleSlots.includes(slot)) {
			throw new Error(session
				? `Cannot focus unmounted Session '${session.sessionId}'.`
				: 'Cannot focus an unmounted new-Session slot.');
		}
		this.records.get(slot)!.view.focus();
	}

	layout(width: number, height: number): void {
		if (!Number.isFinite(width) || width < 0 || !Number.isFinite(height) || height < 0) {
			throw new Error('Sessions Part layout requires finite non-negative dimensions.');
		}
		this.layoutWidth = width;
		this.layoutHeight = height;
		const contentHeight = Math.max(0, height - 40);
		const slotWidth = this.visibleSlots.length > 0 ? width / this.visibleSlots.length : 0;
		for (const slot of this.visibleSlots) {
			this.records.get(slot)!.view.layout(slotWidth, contentHeight);
		}
	}

	override dispose(): void {
		for (const record of this.records.values()) {
			record.disposables.dispose();
		}
		this.records.clear();
		this.visibleSlots = [];
		this.element.replaceChildren();
		super.dispose();
	}

	private createRecord(slot: IVisibleSessionSlot): ISessionSlotRecord {
		const disposables = new DisposableStore();
		const view = disposables.add(this.instantiationService.createInstance(SessionView, slot));
		disposables.add(addDisposableListener(view.getElement(), EventType.FOCUS_IN, () => {
			if (!this.records.has(slot)) {
				return;
			}
			this.focusSlotEmitter.fire(isNewSessionSlot(slot)
				? { kind: 'new-session' }
				: { kind: 'session', session: slot });
		}));
		const record = { slot, view, disposables };
		this.records.set(slot, record);
		return record;
	}

	private readonly renderCollapsedEditorActions = (): void => {
		const actionsElement = this.collapsedEditorActionsView.getElement();
		const isMounted = actionsElement.parentElement === this.titlebarTrailingElement;
		const shouldMount = this.layoutService.getLayoutState().isEditorCollapsed;
		if (isMounted === shouldMount) {
			return;
		}
		this.titlebarTrailingElement.replaceChildren(...(
			shouldMount
				? [actionsElement]
				: []
		));
	};

	private assertState(
		visibleSessions: readonly IVisibleSessionSlot[],
		activeSession: IActiveSession | undefined,
	): void {
		if (visibleSessions.length === 0) {
			throw new Error('The Sessions Part requires at least one visible slot.');
		}
		if (new Set(visibleSessions).size !== visibleSessions.length) {
			throw new Error('The Sessions Part cannot mount a visible slot more than once.');
		}
		const newSessionSlots = visibleSessions.filter(isNewSessionSlot);
		if (newSessionSlots.length > 1) {
			throw new Error('The Sessions Part cannot mount multiple new-Session slots.');
		}
		if (activeSession ? !visibleSessions.includes(activeSession) : newSessionSlots.length !== 1) {
			throw new Error('The Sessions Part active target must be one of its visible slots.');
		}
	}
}

registerSingleton(ISessionsPartService, SessionsPart, InstantiationType.Delayed);
