/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MenuId } from 'cs/platform/actions/common/actions';

export const SessionsMenuIds = {
	sessionHeader: MenuId.for('SessionsSessionHeader'),
	chatHeader: MenuId.for('SessionsChatHeader'),
	chatTurn: MenuId.for('SessionsChatTurn'),
} as const;
