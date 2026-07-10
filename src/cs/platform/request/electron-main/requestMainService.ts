/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type BrowserRequestSession = {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	partition: string;
};

const browserRequestPromises = new Map<string, Promise<BrowserRequestSession | null>>();
const unsupportedBrowserRequestPartitions = new Set<string>();

async function resolveBrowserRequestSession(partition: string) {
	if (!partition || unsupportedBrowserRequestPartitions.has(partition)) {
		return null;
	}

	if (!browserRequestPromises.has(partition)) {
		browserRequestPromises.set(partition, (async () => {
			try {
				const electronModule = (await import('electron')) as {
					app?: { isReady?: () => boolean };
					session?: {
						fromPartition?: (
							targetPartition: string,
						) => {
							fetch?: (url: string, init: RequestInit) => Promise<Response>;
						};
					};
				};
				const electronApp = electronModule.app;
				const electronSession = electronModule.session;
				if (!electronApp || typeof electronApp.isReady !== 'function') {
					unsupportedBrowserRequestPartitions.add(partition);
					return null;
				}
				if (!electronApp.isReady()) {
					return null;
				}
				if (!electronSession || typeof electronSession.fromPartition !== 'function') {
					unsupportedBrowserRequestPartitions.add(partition);
					return null;
				}

				const chromiumSession = electronSession.fromPartition(partition);
				if (!chromiumSession || typeof chromiumSession.fetch !== 'function') {
					unsupportedBrowserRequestPartitions.add(partition);
					return null;
				}

				return {
					fetch: (url, init) => chromiumSession.fetch!(url, init),
					partition,
				} satisfies BrowserRequestSession;
			} catch {
				unsupportedBrowserRequestPartitions.add(partition);
				return null;
			}
		})());
	}

	const resolved = await browserRequestPromises.get(partition)!;
	if (!resolved && !unsupportedBrowserRequestPartitions.has(partition)) {
		browserRequestPromises.delete(partition);
	}

	return resolved;
}

export async function requestWithBrowserSession({
	url,
	signal,
	headers,
	partition,
}: {
	url: string;
	signal: AbortSignal;
	headers?: RequestInit['headers'];
	partition: string;
}) {
	const browserRequestSession = await resolveBrowserRequestSession(partition);
	if (!browserRequestSession) {
		throw new Error(`Browser request session is unavailable for partition ${partition}`);
	}

	return browserRequestSession.fetch(url, {
		signal,
		headers,
	});
}
