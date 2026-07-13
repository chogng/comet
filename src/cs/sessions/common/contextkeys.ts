/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'cs/platform/contextkey/common/contextkey';

export const SessionsContextKeys = {
	sidebarVisible: new RawContextKey<boolean>('sessions.sidebarVisible', true),
	editorCollapsed: new RawContextKey<boolean>('sessions.editorCollapsed', true),
	sessionHeaderHasSession: new RawContextKey<boolean>('sessions.sessionHeaderHasSession', false),
	sessionHeaderCanCreateChat: new RawContextKey<boolean>('sessions.sessionHeaderCanCreateChat', false),
	sessionHeaderSupportsRename: new RawContextKey<boolean>('sessions.sessionHeaderSupportsRename', false),
	sessionHeaderSupportsDelete: new RawContextKey<boolean>('sessions.sessionHeaderSupportsDelete', false),
	chatHeaderSupportsDelete: new RawContextKey<boolean>('sessions.chatHeaderSupportsDelete', false),
	chatTurnCanFork: new RawContextKey<boolean>('sessions.chatTurnCanFork', false),
	activeChatFullyInteractive: new RawContextKey<boolean>('sessions.activeChatFullyInteractive', false),
} as const;
