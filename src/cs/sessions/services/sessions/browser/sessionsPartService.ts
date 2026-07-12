/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
	IActiveSession,
	IVisibleSessionSlot,
} from 'cs/sessions/services/sessions/common/sessionsView';

/** Identifies the mounted Sessions slot that received user focus. */
export type ISessionsPartFocusTarget =
	| { readonly kind: 'new-session' }
	| { readonly kind: 'session'; readonly session: IActiveSession };

export const ISessionsPartService = createDecorator<ISessionsPartService>('sessionsPartService');

/** Narrow bridge used to reconcile and focus the mounted Sessions Part. */
export interface ISessionsPartService {
	readonly _serviceBrand: undefined;
	readonly onDidFocusSlot: Event<ISessionsPartFocusTarget>;
	updateVisibleSessions(
		visibleSessions: readonly IVisibleSessionSlot[],
		activeSession: IActiveSession | undefined,
	): void;
	focusSession(session: IActiveSession | undefined): void;
}
