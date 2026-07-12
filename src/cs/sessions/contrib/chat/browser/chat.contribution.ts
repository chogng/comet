/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import {
	IChatViewFactory,
	type IAddressedChatView,
	type IChatViewFactory as IChatViewFactoryContract,
	type INewSessionChatView,
} from 'cs/sessions/services/chatView/browser/chatViewFactory';
import {
	AddressedChatView,
	NewSessionChatView,
} from 'cs/sessions/contrib/chat/browser/chatView';

/** Creates the concrete Workbench Chat integration hosted by Sessions core. */
export class ChatViewFactory implements IChatViewFactoryContract {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {}

	createNewSessionView(): INewSessionChatView {
		return this.instantiationService.createInstance(NewSessionChatView);
	}

	createChatView(): IAddressedChatView {
		return this.instantiationService.createInstance(AddressedChatView);
	}
}

registerSingleton(IChatViewFactory, ChatViewFactory, InstantiationType.Delayed);
