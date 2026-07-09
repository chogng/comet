/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from 'cs/base/common/keyCodes';
import { KeybindingsRegistry, KeybindingWeight } from 'cs/platform/keybinding/common/keybindingsRegistry';
import { IQuickInputService, QuickPickFocus } from 'cs/platform/quickinput/common/quickInput';

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'quickInput.accept',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Enter,
	handler: accessor => accessor.get(IQuickInputService).accept(),
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'quickInput.hide',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Escape,
	handler: accessor => {
		void accessor.get(IQuickInputService).cancel();
	},
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'quickInput.next',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.DownArrow,
	handler: accessor => accessor.get(IQuickInputService).navigate(true),
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'quickInput.previous',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.UpArrow,
	handler: accessor => accessor.get(IQuickInputService).navigate(false),
});

export { QuickPickFocus };
