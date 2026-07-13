/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from 'cs/base/common/lifecycle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { IChat, ISession } from 'cs/sessions/services/sessions/common/session';

/** Common lifecycle and layout surface for a Chat view hosted by Sessions. */
export interface ISessionsChatView extends IDisposable {
	getElement(): HTMLElement;
	layout(width: number, height: number): void;
	focus(): void;
}

/** Renders the explicit new-Session slot or its provider-owned draft. */
export interface INewSessionChatView extends ISessionsChatView {
	setDraft(session: ISession | undefined, chat: IChat | undefined): void;
}

/** Renders one explicitly addressed Chat in a committed Session. */
export interface IAddressedChatView extends ISessionsChatView {
	setChat(session: ISession, chat: IChat): void;
}

export const IChatViewFactory = createDecorator<IChatViewFactory>('chatViewFactory');

/** Contribution boundary between the Sessions Part and concrete Chat UI. */
export interface IChatViewFactory {
	readonly _serviceBrand: undefined;
	createNewSessionView(): INewSessionChatView;
	createChatView(): IAddressedChatView;
}
