/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';

export interface IScopedAccessibilityProgressSignalDelegate extends IDisposable { }

let progressAccessibilitySignalSchedulerFactory: (msDelayTime: number, msLoopTime?: number) => IScopedAccessibilityProgressSignalDelegate = () => Disposable.None;

export function setProgressAccessibilitySignalScheduler(progressAccessibilitySignalScheduler: (msDelayTime: number, msLoopTime?: number) => IScopedAccessibilityProgressSignalDelegate): void {
	progressAccessibilitySignalSchedulerFactory = progressAccessibilitySignalScheduler;
}

export function getProgressAccessibilitySignalScheduler(msDelayTime: number, msLoopTime?: number): IScopedAccessibilityProgressSignalDelegate {
	return progressAccessibilitySignalSchedulerFactory(msDelayTime, msLoopTime);
}
