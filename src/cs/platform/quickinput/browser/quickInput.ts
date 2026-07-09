/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/quickInput.css';

import { RawContextKey } from 'cs/platform/contextkey/common/contextkey';
import type { QuickInputType } from 'cs/platform/quickinput/common/quickInput';

export const inQuickInputContext = 'inQuickInput';
export const endOfQuickInputBoxContext = 'endOfQuickInputBox';
export const quickInputTypeContextKeyValue = 'quickInputType';
export const quickInputAlignmentContextKeyValue = 'quickInputAlignment';

export const InQuickInputContextKey = new RawContextKey<boolean>(inQuickInputContext, false);
export const EndOfQuickInputBoxContextKey = new RawContextKey<boolean>(endOfQuickInputBoxContext, false);
export const QuickInputTypeContextKey = new RawContextKey<QuickInputType | undefined>(quickInputTypeContextKeyValue, undefined);
export const QuickInputAlignmentContextKey = new RawContextKey<'top' | 'center' | undefined>(quickInputAlignmentContextKeyValue, 'top');
