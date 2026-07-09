/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'cs/base/common/network';
import { URI } from 'cs/base/common/uri';

export namespace BrowserViewUri {
	export const scheme = Schemas.vscodeBrowser;

	export function forId(id: string): URI {
		return URI.from({ scheme, path: `/${id}` });
	}

	export function parse(resource: URI): { id: string } | undefined {
		if (resource.scheme !== scheme) {
			return undefined;
		}

		const id = resource.path.startsWith('/') ? resource.path.slice(1) : resource.path;
		if (!id) {
			return undefined;
		}

		return { id };
	}

	export function getId(resource: URI): string | undefined {
		return parse(resource)?.id;
	}
}
