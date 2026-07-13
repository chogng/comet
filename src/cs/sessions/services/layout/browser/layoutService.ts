/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import {
	IStorageService,
	StorageScope,
	StorageTarget,
} from 'cs/platform/storage/common/storage';
import {
	ISessionsLayoutPolicy,
	type ISessionsLayoutState,
	type ISessionsLayoutViewport,
} from 'cs/sessions/services/layout/browser/layoutPolicy';

export type SessionsLayoutMode = ISessionsLayoutState['mode'];

export interface ISessionsPartSizes {
	readonly sidebarSize?: number;
	readonly editorSize?: number;
}

export interface ISessionsHorizontalPartGeometry {
	readonly visible: boolean;
	readonly width: number;
}

export interface ISessionsLayoutGeometry {
	readonly titlebarHeight: number;
	readonly statusbarHeight: number;
	readonly sidebar: ISessionsHorizontalPartGeometry;
	readonly sessions: ISessionsHorizontalPartGeometry;
	readonly editor: ISessionsHorizontalPartGeometry;
}

export type ISessionsContentLayoutGeometry = Pick<
	ISessionsLayoutGeometry,
	'sidebar' | 'sessions' | 'editor'
>;

export const ISessionsLayoutService = createDecorator<ISessionsLayoutService>('sessionsLayoutService');

export interface ISessionsLayoutService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeLayoutState: Event<ISessionsLayoutState>;
	readonly onDidChangeLayoutGeometry: Event<ISessionsLayoutGeometry>;
	getLayoutState(): ISessionsLayoutState;
	getLayoutGeometry(): ISessionsLayoutGeometry | undefined;
	setViewport(width: number, height: number): void;
	setLayoutGeometry(geometry: ISessionsLayoutGeometry): void;
	applyStartupLayoutMode(mode: SessionsLayoutMode): boolean;
	applyLayoutMode(mode: SessionsLayoutMode): void;
	setPartSizes(sizes: ISessionsPartSizes): void;
	setSidebarVisible(visible: boolean): void;
	setSidebarSize(size: number): void;
	toggleSidebarVisibility(): void;
	setEditorCollapsed(collapsed: boolean, expandedEditorSize?: number): void;
	toggleEditorCollapsed(expandedEditorSize?: number): void;
}

interface IStoredSessionsLayoutState {
	readonly version: 1;
	readonly state: ISessionsLayoutState;
}

const SessionsLayoutStorageKey = 'sessions.layoutState';
const InitialViewport: ISessionsLayoutViewport = { width: 0, height: 0 };

function isFiniteSize(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function validateLayoutState(value: unknown): asserts value is ISessionsLayoutState {
	if (typeof value !== 'object' || value === null) {
		throw new Error('Invalid Sessions layout state.');
	}

	const state = value as Record<string, unknown>;
	if ((state.mode !== 'agent' && state.mode !== 'flow')
		|| typeof state.isSidebarVisible !== 'boolean'
		|| !isFiniteSize(state.sidebarSize)
		|| typeof state.isEditorCollapsed !== 'boolean'
		|| !isFiniteSize(state.expandedEditorSize)) {
		throw new Error('Invalid Sessions layout state.');
	}
}

function isEqualLayoutState(
	left: ISessionsLayoutState,
	right: ISessionsLayoutState,
): boolean {
	return left.mode === right.mode
		&& left.isSidebarVisible === right.isSidebarVisible
		&& left.sidebarSize === right.sidebarSize
		&& left.isEditorCollapsed === right.isEditorCollapsed
		&& left.expandedEditorSize === right.expandedEditorSize;
}

function freezeLayoutState(state: ISessionsLayoutState): ISessionsLayoutState {
	return Object.freeze({ ...state });
}

function isEqualLayoutGeometry(
	left: ISessionsLayoutGeometry,
	right: ISessionsLayoutGeometry,
): boolean {
	return left.titlebarHeight === right.titlebarHeight
		&& left.statusbarHeight === right.statusbarHeight
		&& left.sidebar.visible === right.sidebar.visible
		&& left.sidebar.width === right.sidebar.width
		&& left.sessions.visible === right.sessions.visible
		&& left.sessions.width === right.sessions.width
		&& left.editor.visible === right.editor.visible
		&& left.editor.width === right.editor.width;
}

function validateLayoutGeometry(geometry: ISessionsLayoutGeometry): void {
	if (!isFiniteSize(geometry.titlebarHeight)
		|| !isFiniteSize(geometry.statusbarHeight)
		|| !isFiniteSize(geometry.sidebar.width)
		|| !isFiniteSize(geometry.sessions.width)
		|| !isFiniteSize(geometry.editor.width)) {
		throw new Error('Sessions layout geometry must contain finite non-negative dimensions.');
	}
	if (typeof geometry.sidebar.visible !== 'boolean'
		|| geometry.sessions.visible !== true
		|| typeof geometry.editor.visible !== 'boolean') {
		throw new Error('Sessions layout geometry must contain valid Part visibility.');
	}
}

function freezeLayoutGeometry(geometry: ISessionsLayoutGeometry): ISessionsLayoutGeometry {
	return Object.freeze({
		...geometry,
		sidebar: Object.freeze({ ...geometry.sidebar }),
		sessions: Object.freeze({ ...geometry.sessions }),
		editor: Object.freeze({ ...geometry.editor }),
	});
}

export class SessionsLayoutService extends Disposable implements ISessionsLayoutService {
	declare readonly _serviceBrand: undefined;

	private readonly changeEmitter = this._register(new Emitter<ISessionsLayoutState>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeLayoutState = this.changeEmitter.event;
	private readonly geometryChangeEmitter = this._register(new Emitter<ISessionsLayoutGeometry>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeLayoutGeometry = this.geometryChangeEmitter.event;

	private viewport = InitialViewport;
	private state: ISessionsLayoutState;
	private geometry: ISessionsLayoutGeometry | undefined;
	private startupLayoutEligible: boolean;

	constructor(
		@ISessionsLayoutPolicy private readonly layoutPolicy: ISessionsLayoutPolicy,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		const storedState = this.storageService.get(
			SessionsLayoutStorageKey,
			StorageScope.APPLICATION,
		);
		this.startupLayoutEligible = storedState === undefined;
		this.state = this.loadState(storedState);
	}

	getLayoutState(): ISessionsLayoutState {
		return this.state;
	}

	getLayoutGeometry(): ISessionsLayoutGeometry | undefined {
		return this.geometry;
	}

	setViewport(width: number, height: number): void {
		if (!isFiniteSize(width) || !isFiniteSize(height)) {
			throw new Error('Sessions layout viewport dimensions must be finite non-negative numbers.');
		}

		this.viewport = { width, height };
		this.commit(this.state);
	}

	setLayoutGeometry(geometry: ISessionsLayoutGeometry): void {
		validateLayoutGeometry(geometry);
		if (this.geometry && isEqualLayoutGeometry(this.geometry, geometry)) {
			return;
		}

		this.geometry = freezeLayoutGeometry(geometry);
		this.geometryChangeEmitter.fire(this.geometry);
	}

	applyStartupLayoutMode(mode: SessionsLayoutMode): boolean {
		if (!this.startupLayoutEligible) {
			return false;
		}

		const changed = this.commitLayoutMode(mode);
		this.startupLayoutEligible = false;
		return changed;
	}

	applyLayoutMode(mode: SessionsLayoutMode): void {
		this.commitAuthoritative(() => this.commitLayoutMode(mode));
	}

	private commitLayoutMode(mode: SessionsLayoutMode): boolean {
		switch (mode) {
			case 'agent':
				return this.commit({
					...this.state,
					mode: 'agent',
					isSidebarVisible: true,
					isEditorCollapsed: true,
				});
			case 'flow':
				return this.commit({
					...this.state,
					mode: 'flow',
					isSidebarVisible: true,
					isEditorCollapsed: false,
				});
		}
	}

	setPartSizes(sizes: ISessionsPartSizes): void {
		this.commitAuthoritative(() => this.commit({
			...this.state,
			sidebarSize: sizes.sidebarSize ?? this.state.sidebarSize,
			expandedEditorSize: sizes.editorSize ?? this.state.expandedEditorSize,
		}));
	}

	setSidebarVisible(visible: boolean): void {
		this.commitAuthoritative(() => this.commit({ ...this.state, isSidebarVisible: visible }));
	}

	setSidebarSize(size: number): void {
		this.commitAuthoritative(() => this.commit({ ...this.state, sidebarSize: size }));
	}

	toggleSidebarVisibility(): void {
		this.setSidebarVisible(!this.state.isSidebarVisible);
	}

	setEditorCollapsed(collapsed: boolean, expandedEditorSize?: number): void {
		this.commitAuthoritative(() => this.commit({
			...this.state,
			isEditorCollapsed: collapsed,
			expandedEditorSize: expandedEditorSize ?? this.state.expandedEditorSize,
		}));
	}

	toggleEditorCollapsed(expandedEditorSize?: number): void {
		this.setEditorCollapsed(!this.state.isEditorCollapsed, expandedEditorSize);
	}

	private loadState(stored: string | undefined): ISessionsLayoutState {
		const state = stored === undefined
			? this.layoutPolicy.createInitialState()
			: this.deserializeStoredState(stored);
		validateLayoutState(state);
		const arranged = this.layoutPolicy.arrange(this.viewport, state);
		validateLayoutState(arranged);
		return freezeLayoutState(arranged);
	}

	private deserializeStoredState(serialized: string): ISessionsLayoutState {
		let value: unknown;
		try {
			value = JSON.parse(serialized);
		} catch {
			throw new Error('Invalid persisted Sessions layout state.');
		}
		if (typeof value !== 'object' || value === null) {
			throw new Error('Invalid persisted Sessions layout state.');
		}
		const stored = value as Record<string, unknown>;
		if (stored.version !== 1) {
			throw new Error('Invalid persisted Sessions layout state.');
		}
		validateLayoutState(stored.state);
		return stored.state;
	}

	private commitAuthoritative(commit: () => boolean): void {
		commit();
		this.startupLayoutEligible = false;
	}

	private commit(candidate: ISessionsLayoutState): boolean {
		validateLayoutState(candidate);
		const arranged = this.layoutPolicy.arrange(this.viewport, candidate);
		validateLayoutState(arranged);
		if (isEqualLayoutState(this.state, arranged)) {
			return false;
		}

		const nextState = freezeLayoutState(arranged);
		this.storageService.store(
			SessionsLayoutStorageKey,
			{ version: 1, state: nextState } satisfies IStoredSessionsLayoutState,
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
		this.state = nextState;
		this.changeEmitter.fire(nextState);
		return true;
	}
}

registerSingleton(ISessionsLayoutService, SessionsLayoutService, InstantiationType.Delayed);
