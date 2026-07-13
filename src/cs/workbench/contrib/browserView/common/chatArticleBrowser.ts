/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { ArticleId } from 'cs/workbench/services/fetch/common/fetch';

/** Exact typed Article action emitted by one addressed Chat presentation item. */
export interface IChatArticleBrowserTarget {
	readonly chatResource: URI;
	readonly articleId: ArticleId;
	readonly uri: URI;
}

export const IChatArticleBrowserService =
	createDecorator<IChatArticleBrowserService>('chatArticleBrowserService');

/** Opens an Article from one addressed Chat in the target's Browser environment. */
export interface IChatArticleBrowserService {
	readonly _serviceBrand: undefined;
	open(target: IChatArticleBrowserTarget): Promise<void>;
}

export function assertChatArticleBrowserTarget(
	target: IChatArticleBrowserTarget,
): void {
	if (!URI.isUri(target.chatResource) || !URI.isUri(target.uri)) {
		throw new TypeError('An Article Browser action requires Chat and Article URI values.');
	}
	if (typeof target.articleId !== 'string' || !target.articleId.trim()) {
		throw new TypeError('An Article Browser action requires a non-empty Article ID.');
	}
	if (target.uri.scheme !== 'http' && target.uri.scheme !== 'https') {
		throw new TypeError(`Article '${target.articleId}' requires a canonical HTTP(S) URI.`);
	}
}
