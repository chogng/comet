/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const ISessionsSettingsOverlayService = createDecorator<ISessionsSettingsOverlayService>(
	'sessionsSettingsOverlayService',
);

export interface ISessionsSettingsOverlayService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeVisibility: Event<boolean>;
	isVisible(): boolean;
	setVisible(visible: boolean): void;
	toggleVisibility(): void;
}

export class SessionsSettingsOverlayService extends Disposable implements ISessionsSettingsOverlayService {
	declare readonly _serviceBrand: undefined;

	private readonly changeVisibilityEmitter = this._register(new Emitter<boolean>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeVisibility = this.changeVisibilityEmitter.event;

	private visible = false;

	isVisible(): boolean {
		return this.visible;
	}

	setVisible(visible: boolean): void {
		if (this.visible === visible) {
			return;
		}

		this.visible = visible;
		this.changeVisibilityEmitter.fire(visible);
	}

	toggleVisibility(): void {
		this.setVisible(!this.visible);
	}
}

registerSingleton(
	ISessionsSettingsOverlayService,
	SessionsSettingsOverlayService,
	InstantiationType.Delayed,
);
