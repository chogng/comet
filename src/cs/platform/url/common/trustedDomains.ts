/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isLocalhostAuthority(authority: string): boolean {
	const host = authority.split(':', 1)[0]?.toLowerCase();
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}
