/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export interface IMatch {
	readonly start: number;
	readonly end: number;
}

export function matchesPrefix(word: string, target: string): IMatch[] | null {
	if (target.toLocaleLowerCase().startsWith(word.toLocaleLowerCase())) {
		return [{ start: 0, end: word.length }];
	}

	return null;
}

export function matchesFuzzy2(word: string, target: string): IMatch[] | null {
	const normalizedWord = word.toLocaleLowerCase();
	const normalizedTarget = target.toLocaleLowerCase();
	let cursor = 0;
	const matches: IMatch[] = [];

	for (const char of normalizedWord) {
		const index = normalizedTarget.indexOf(char, cursor);
		if (index === -1) {
			return null;
		}

		matches.push({ start: index, end: index + 1 });
		cursor = index + 1;
	}

	return matches;
}
