/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IObservable } from 'cs/base/common/observable';
import type { IChat, ISession } from 'cs/sessions/services/sessions/common/session';

/** Identifies the non-Session slot shown by the Sessions Part. */
export const enum VisibleSessionSlotKind {
	NewSession = 'new-session',
}

/** The explicit empty slot used to compose a new Session. */
export interface INewSessionSlot {
	readonly kind: VisibleSessionSlotKind.NewSession;
}

export const NewSessionSlot: INewSessionSlot = Object.freeze({
	kind: VisibleSessionSlotKind.NewSession,
});

/** Adds view-owned Chat selection and stickiness to one visible Session. */
export interface IActiveSession extends ISession {
	readonly activeChat: IObservable<IChat | undefined>;
	readonly openChats: IObservable<readonly IChat[]>;
	readonly closedChats: IObservable<readonly IChat[]>;
	readonly visibleChatTabs: IObservable<readonly IChat[]>;
	readonly sticky: IObservable<boolean>;
}

export type IVisibleSessionSlot = IActiveSession | INewSessionSlot;

export function isNewSessionSlot(slot: IVisibleSessionSlot): slot is INewSessionSlot {
	return slot === NewSessionSlot;
}
