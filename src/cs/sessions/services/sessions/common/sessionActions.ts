/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IChat,
	ISession,
	ISessionCapabilities,
} from 'cs/sessions/services/sessions/common/session';

/** Identifies one Chat action's exact originating Session and Chat. */
export interface ISessionChatActionContext {
	readonly session: ISession;
	readonly chat: IChat;
}

/** Identifies one exact Turn within an addressed Session Chat. */
export interface ISessionChatTurnActionContext extends ISessionChatActionContext {
	readonly turnId: string;
}

/** Returns whether the Session catalog has room for another Chat. */
export function hasAvailableChatCapacity(
	capabilities: ISessionCapabilities,
	chatCount: number,
): boolean {
	return capabilities.maximumChatCount === undefined
		|| chatCount < capabilities.maximumChatCount;
}

/** Returns whether the user can create a peer Chat in the Session. */
export function isCreateChatAvailable(
	capabilities: ISessionCapabilities,
	chatCount: number,
): boolean {
	return capabilities.supportsCreateChat
		&& hasAvailableChatCapacity(capabilities, chatCount);
}

/** Returns whether the user can fork a Chat in the Session. */
export function isForkChatAvailable(
	capabilities: ISessionCapabilities,
	chatCount: number,
): boolean {
	return capabilities.supportsFork
		&& hasAvailableChatCapacity(capabilities, chatCount);
}
