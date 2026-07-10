/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'cs/base/common/network';
import { URI } from 'cs/base/common/uri';

/**
 * Helper for creating and parsing URIs for browser views.
 * Examples:
 * - tab A: actual URL: https://example.com
 * - tab A: inner URI: vscode-browser:/tab-a
 */

export namespace BrowserViewUri {
	export const scheme = Schemas.vscodeBrowser;
	
	/**
	 * Creates a resource URI for a browser view with the given ID.
	 */
	export function forId(id: string): URI {
		return URI.from({ scheme, path: `/${id}` });
	}

	/**
	 * Parses a resource URI and extracts the browser view ID if it's a valid browser view URI.
	 */
	export function parse(resource: URI): { id: string } | undefined {
		if (resource.scheme !== scheme) {
			return undefined;
		}
		
		// Remove leading slash if present
		const id = resource.path.startsWith('/') ? resource.path.slice(1) : resource.path;
		if (!id) {
			return undefined;
		}

		return { id };
	}

	/**
	 * Extracts the browser view ID from a resource URI if it's a valid browser view URI. 
	 */
	export function getId(resource: URI): string | undefined {
		return parse(resource)?.id;
	}
}
