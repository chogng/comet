/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { normalizeUrl } from 'cs/base/common/url';
import {
	getWebContentDocumentSnapshot,
	getWebContentState,
} from 'cs/platform/browserView/electron-main/browserViewMainService';

function normalizeComparableUrl(value: string) {
	try {
		const url = new URL(normalizeUrl(value));
		url.hash = '';
		if (url.pathname !== '/') {
			url.pathname = url.pathname.replace(/\/+$/, '') || '/';
		}
		return url.toString();
	} catch {
		return '';
	}
}

export async function resolveActiveWebContentSnapshotHtml(payload: { pageUrl?: string }) {
	const requestedUrl = normalizeComparableUrl(payload.pageUrl ?? '');
	const activeTargetId = getWebContentState().activeTargetId;
	if (!requestedUrl || !activeTargetId) {
		return null;
	}

	const snapshot = await getWebContentDocumentSnapshot(activeTargetId, {
		timeoutMs: 1500,
	});
	if (
		!snapshot ||
		normalizeComparableUrl(snapshot.url) !== requestedUrl
	) {
		return null;
	}

	return snapshot.html;
}
