/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ILogService } from 'cs/platform/log/common/log';
import type { IElement, IWindowDriver } from 'cs/workbench/services/driver/common/driver';
import {
	ILifecycleService,
	LifecyclePhase,
} from 'cs/workbench/services/lifecycle/common/lifecycle';

type WindowWithDriver = Window & {
	driver?: IWindowDriver;
};

export class BrowserWindowDriver implements IWindowDriver {
	constructor(
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILogService private readonly logService: ILogService,
	) {}

	async getElements(selector: string, recursive: boolean): Promise<IElement[]> {
		const elements = document.querySelectorAll(selector);
		return Array.from(elements, element => this.serializeElement(element, recursive));
	}

	async getElementXY(
		selector: string,
		xOffset?: number,
		yOffset?: number,
	): Promise<{ x: number; y: number }> {
		const element = document.querySelector(selector);
		if (!(element instanceof HTMLElement)) {
			throw new Error(`Element not found: ${selector}`);
		}

		const rect = element.getBoundingClientRect();
		return {
			x: Math.round(rect.left + (xOffset ?? rect.width / 2)),
			y: Math.round(rect.top + (yOffset ?? rect.height / 2)),
		};
	}

	async whenWorkbenchRestored(): Promise<void> {
		this.logService.info('[driver] Waiting for the restored lifecycle phase.');
		await this.lifecycleService.when(LifecyclePhase.Restored);
		this.logService.info('[driver] Restored lifecycle phase reached.');
	}

	private serializeElement(element: Element, recursive: boolean): IElement {
		const attributes: { [name: string]: string } = {};
		for (const attribute of Array.from(element.attributes)) {
			attributes[attribute.name] = attribute.value;
		}

		const rect = element.getBoundingClientRect();
		return {
			tagName: element.tagName,
			className: typeof element.className === 'string' ? element.className : '',
			textContent: element.textContent ?? '',
			attributes,
			children: recursive
				? Array.from(element.children, child => this.serializeElement(child, true))
				: [],
			top: Math.round(rect.top),
			left: Math.round(rect.left),
		};
	}
}

export function registerWindowDriver(
	instantiationService: IInstantiationService,
): IDisposable {
	const targetWindow = window as WindowWithDriver;
	if (targetWindow.driver) {
		throw new Error('The workbench window driver is already registered.');
	}

	const driver = instantiationService.createInstance(BrowserWindowDriver);
	targetWindow.driver = driver;

	return toDisposable(() => {
		if (targetWindow.driver === driver) {
			delete targetWindow.driver;
		}
	});
}
