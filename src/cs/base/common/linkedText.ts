/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ILink {
	readonly label: string;
	readonly href: string;
	readonly title?: string;
}

export type LinkedTextNode = string | ILink;

export class LinkedText {
	private stringValue: string | undefined;

	constructor(readonly nodes: LinkedTextNode[]) {}

	toString(): string {
		this.stringValue ??= this.nodes.map(node => typeof node === 'string' ? node : node.label).join('');
		return this.stringValue;
	}
}

const linkRegex = /\[(?<label>[^\]]+)\]\((?<href>(?:https?:\/\/|command:|file:)[^\)\s]+)(?: (?<quote>["'])(?<title>.+?)(\k<quote>))?\)/gi;

export function parseLinkedText(text: string): LinkedText {
	const result: LinkedTextNode[] = [];
	let index = 0;
	let match: RegExpExecArray | null;

	while ((match = linkRegex.exec(text)) !== null) {
		if (match.index - index > 0) {
			result.push(text.substring(index, match.index));
		}

		const { label, href, title } = match.groups!;
		if (title) {
			result.push({ label, href, title });
		} else {
			result.push({ label, href });
		}

		index = match.index + match[0].length;
	}

	if (index < text.length) {
		result.push(text.substring(index));
	}

	return new LinkedText(result);
}
