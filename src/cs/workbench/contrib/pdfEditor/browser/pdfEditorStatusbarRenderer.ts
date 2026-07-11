/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { StatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';
import { renderCommonStatusbarMode } from 'cs/workbench/browser/parts/statusbar/renderers/common';

export const renderPdfStatusbarMode: StatusbarModeRenderer = (status, context) => {
  renderCommonStatusbarMode(status, context);
};
