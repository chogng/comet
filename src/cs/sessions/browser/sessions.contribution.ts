/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { disposeSessionsWorkbench } from 'cs/sessions/browser/sessionsWorkbench';

registerWorkbenchContribution(() => ({
	dispose: disposeSessionsWorkbench,
}));
