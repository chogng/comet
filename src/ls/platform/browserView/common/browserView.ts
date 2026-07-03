/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface WebContentBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type WebContentLayoutPhase = 'hidden' | 'measuring' | 'visible';
export type WebContentOwnership = 'active' | 'inactive';

export interface WebContentState {
	targetId: string | null;
	activeTargetId: string | null;
	ownership: WebContentOwnership;
	layoutPhase: WebContentLayoutPhase;
	url: string;
	pageTitle?: string;
	faviconUrl?: string;
	canGoBack: boolean;
	canGoForward: boolean;
	isLoading: boolean;
	visible: boolean;
}

export interface WebContentSelectionRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface WebContentSelectionSnapshot {
	text: string;
	rects: WebContentSelectionRect[];
}

export type WebContentNavigationMode = 'browser' | 'strict';

export interface WebContentTargetPayload {
	targetId?: string | null;
}

export interface WebContentNavigatePayload extends WebContentTargetPayload {
	url: string;
	mode?: WebContentNavigationMode;
}
