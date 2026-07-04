/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class IdGenerator {
	private lastId = 0;

	constructor(private readonly prefix: string) {}

	nextId(): string {
		return this.prefix + (++this.lastId);
	}
}

export const defaultGenerator = new IdGenerator('id#');
