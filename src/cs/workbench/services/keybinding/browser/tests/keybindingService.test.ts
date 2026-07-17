/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { KeyCode, KeyMod } from 'cs/base/common/keyCodes';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import {
	commandService,
	commandsRegistry,
	setCommandServiceInstantiationService,
} from 'cs/platform/commands/common/commands';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import {
	KeybindingWeight,
	KeybindingsRegistry,
} from 'cs/platform/keybinding/common/keybindingsRegistry';
import { createWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import type { BrowserWorkbenchKeybindingService } from 'cs/workbench/services/keybinding/browser/keybindingService';

test('BrowserWorkbenchKeybindingService dispatches registered keybinding commands', async () => {
	const dom = installDomTestEnvironment();
	const { BrowserWorkbenchKeybindingService } = await import(
		'cs/workbench/services/keybinding/browser/keybindingService'
	);
	const instantiationService = new InstantiationService(
		new ServiceCollection(),
		true,
	);
	const commandServiceInstantiationService =
		setCommandServiceInstantiationService(instantiationService);
	let result: string | undefined;
	const commandRegistration = commandsRegistry.registerCommand(
		'test.keybindingDispatch',
		() => {
			result = 'handled';
			return result;
		},
	);
	const keybindingRegistration = KeybindingsRegistry.registerKeybindingRule({
		id: 'test.keybindingDispatch',
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.F12,
	});
	const keybindingService = new BrowserWorkbenchKeybindingService(
		createWorkbenchCommandService(commandService),
	);

	try {
		const event = new KeyboardEvent('keydown', {
			key: 'F12',
			keyCode: 123,
			ctrlKey: true,
			shiftKey: true,
			altKey: true,
			bubbles: true,
			cancelable: true,
		} as KeyboardEventInit);

		document.dispatchEvent(event);

		assert.equal(result, 'handled');
		assert.equal(event.defaultPrevented, true);
	} finally {
		keybindingService.dispose();
		keybindingRegistration.dispose();
		commandRegistration.dispose();
		commandServiceInstantiationService.dispose();
		instantiationService.dispose();
		dom.cleanup();
	}
});

test('BrowserWorkbenchKeybindingService enables hold mode for the dispatching command', async () => {
	const dom = installDomTestEnvironment();
	const { BrowserWorkbenchKeybindingService } = await import(
		'cs/workbench/services/keybinding/browser/keybindingService'
	);
	const instantiationService = new InstantiationService(
		new ServiceCollection(),
		true,
	);
	const commandServiceInstantiationService =
		setCommandServiceInstantiationService(instantiationService);
	let holdMode: Promise<void> | undefined;
	let keybindingService: BrowserWorkbenchKeybindingService | undefined;
	const commandRegistration = commandsRegistry.registerCommand(
		'test.keybindingHold',
		() => {
			holdMode = keybindingService?.enableKeybindingHoldMode(
				'test.keybindingHold',
			);
		},
	);
	const keybindingRegistration = KeybindingsRegistry.registerKeybindingRule({
		id: 'test.keybindingHold',
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.F11,
	});
	keybindingService = new BrowserWorkbenchKeybindingService(
		createWorkbenchCommandService(commandService),
	);

	try {
		const keydown = new KeyboardEvent('keydown', {
			key: 'F11',
			keyCode: 122,
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		} as KeyboardEventInit);

		document.dispatchEvent(keydown);
		assert.ok(holdMode);

		document.dispatchEvent(new KeyboardEvent('keyup', {
			key: 'F11',
			keyCode: 122,
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		} as KeyboardEventInit));
		await holdMode;
	} finally {
		keybindingService.dispose();
		keybindingRegistration.dispose();
		commandRegistration.dispose();
		commandServiceInstantiationService.dispose();
		instantiationService.dispose();
		dom.cleanup();
	}
});
