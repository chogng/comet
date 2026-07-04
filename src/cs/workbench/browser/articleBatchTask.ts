/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type ArticleBatchTaskPhase = 'running' | 'cancelling';

export type ArticleBatchTaskProgress = {
	phase: ArticleBatchTaskPhase;
	current: number;
	total: number;
};
