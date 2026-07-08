/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function compareAnything(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	const prefixCompare = compareByPrefix(one, other, lookFor);
	if (prefixCompare) {
		return prefixCompare;
	}

	const elementASuffixMatch = elementAName.endsWith(lookFor);
	const elementBSuffixMatch = elementBName.endsWith(lookFor);
	if (elementASuffixMatch !== elementBSuffixMatch) {
		return elementASuffixMatch ? -1 : 1;
	}

	const fileNameCompare = compareFileNames(elementAName, elementBName);
	if (fileNameCompare !== 0) {
		return fileNameCompare;
	}

	return elementAName.localeCompare(elementBName);
}

export function compareByPrefix(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	const elementAPrefixMatch = elementAName.startsWith(lookFor);
	const elementBPrefixMatch = elementBName.startsWith(lookFor);
	if (elementAPrefixMatch !== elementBPrefixMatch) {
		return elementAPrefixMatch ? -1 : 1;
	}

	if (elementAPrefixMatch && elementBPrefixMatch) {
		if (elementAName.length < elementBName.length) {
			return -1;
		}

		if (elementAName.length > elementBName.length) {
			return 1;
		}
	}

	return 0;
}

function compareFileNames(one: string, other: string): number {
	return one.localeCompare(other, undefined, { numeric: true, sensitivity: 'base' }) || one.localeCompare(other);
}
