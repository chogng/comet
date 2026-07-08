/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from './charCode.js';
import * as strings from './strings.js';

export interface IFilter {
	(word: string, wordToMatchAgainst: string): IMatch[] | null;
}

export interface IMatch {
	start: number;
	end: number;
}

export const matchesStrictPrefix: IFilter = _matchesPrefix.bind(undefined, false);
export const matchesPrefix: IFilter = _matchesPrefix.bind(undefined, true);

function _matchesPrefix(ignoreCase: boolean, word: string, wordToMatchAgainst: string): IMatch[] | null {
	if (!wordToMatchAgainst || wordToMatchAgainst.length < word.length) {
		return null;
	}

	const matches = ignoreCase ? strings.startsWithIgnoreCase(wordToMatchAgainst, word) : wordToMatchAgainst.indexOf(word) === 0;
	if (!matches) {
		return null;
	}

	return word.length > 0 ? [{ start: 0, end: word.length }] : [];
}

export function isUpper(code: number): boolean {
	return CharCode.A <= code && code <= CharCode.Z;
}

function isSeparatorAtPos(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) {
		return false;
	}

	switch (value.codePointAt(index)) {
		case CharCode.Underline:
		case CharCode.Dash:
		case CharCode.Period:
		case CharCode.Space:
		case CharCode.Slash:
		case CharCode.Backslash:
		case CharCode.SingleQuote:
		case CharCode.DoubleQuote:
		case CharCode.Colon:
		case CharCode.DollarSign:
		case CharCode.LessThan:
		case CharCode.GreaterThan:
		case CharCode.OpenParen:
		case CharCode.CloseParen:
		case CharCode.OpenSquareBracket:
		case CharCode.CloseSquareBracket:
		case CharCode.OpenCurlyBrace:
		case CharCode.CloseCurlyBrace:
			return true;
		default:
			return false;
	}
}

function isWhitespaceAtPos(value: string, index: number): boolean {
	if (index < 0 || index >= value.length) {
		return false;
	}

	switch (value.charCodeAt(index)) {
		case CharCode.Space:
		case CharCode.Tab:
			return true;
		default:
			return false;
	}
}

function isUpperCaseAtPos(pos: number, word: string, wordLow: string): boolean {
	return word[pos] !== wordLow[pos];
}

export type FuzzyScore = [score: number, wordStart: number, ...matches: number[]];

export namespace FuzzyScore {
	export const Default: FuzzyScore = [-100, 0];

	export function isDefault(score?: FuzzyScore): score is [-100, 0] {
		return !score || (score.length === 2 && score[0] === -100 && score[1] === 0);
	}
}

export abstract class FuzzyScoreOptions {
	static default = { boostFullMatch: true, firstMatchCanBeWeak: false };

	constructor(
		readonly firstMatchCanBeWeak: boolean,
		readonly boostFullMatch: boolean,
	) { }
}

export interface FuzzyScorer {
	(pattern: string, lowPattern: string, patternPos: number, word: string, lowWord: string, wordPos: number, options?: FuzzyScoreOptions): FuzzyScore | undefined;
}

const maxLen = 128;

function initTable() {
	const table: number[][] = [];
	const row: number[] = [];
	for (let i = 0; i <= maxLen; i++) {
		row[i] = 0;
	}
	for (let i = 0; i <= maxLen; i++) {
		table.push(row.slice(0));
	}
	return table;
}

function initArr(maxLength: number) {
	const row: number[] = [];
	for (let i = 0; i <= maxLength; i++) {
		row[i] = 0;
	}
	return row;
}

const minWordMatchPos = initArr(2 * maxLen);
const maxWordMatchPos = initArr(2 * maxLen);
const diag = initTable();
const table = initTable();
const arrows = initTable() as Arrow[][];

const enum Arrow {
	Diag = 1,
	Left = 2,
	LeftLeft = 3,
}

export function isPatternInWord(patternLow: string, patternPos: number, patternLen: number, wordLow: string, wordPos: number, wordLen: number, fillMinWordPosArr = false): boolean {
	while (patternPos < patternLen && wordPos < wordLen) {
		if (patternLow[patternPos] === wordLow[wordPos]) {
			if (fillMinWordPosArr) {
				minWordMatchPos[patternPos] = wordPos;
			}
			patternPos += 1;
		}
		wordPos += 1;
	}
	return patternPos === patternLen;
}

export function fuzzyScore(pattern: string, patternLow: string, patternStart: number, word: string, wordLow: string, wordStart: number, options: FuzzyScoreOptions = FuzzyScoreOptions.default): FuzzyScore | undefined {
	const patternLen = pattern.length > maxLen ? maxLen : pattern.length;
	const wordLen = word.length > maxLen ? maxLen : word.length;

	if (patternStart >= patternLen || wordStart >= wordLen || (patternLen - patternStart) > (wordLen - wordStart)) {
		return undefined;
	}

	if (!isPatternInWord(patternLow, patternStart, patternLen, wordLow, wordStart, wordLen, true)) {
		return undefined;
	}

	fillInMaxWordMatchPos(patternLen, wordLen, patternStart, wordStart, patternLow, wordLow);

	let row = 1;
	let column = 1;
	let patternPos = patternStart;
	let wordPos = wordStart;
	const hasStrongFirstMatch = [false];

	for (row = 1, patternPos = patternStart; patternPos < patternLen; row++, patternPos++) {
		const minMatchPos = minWordMatchPos[patternPos];
		const maxMatchPos = maxWordMatchPos[patternPos];
		const nextMaxMatchPos = patternPos + 1 < patternLen ? maxWordMatchPos[patternPos + 1] : wordLen;

		for (column = minMatchPos - wordStart + 1, wordPos = minMatchPos; wordPos < nextMaxMatchPos; column++, wordPos++) {
			let score = Number.MIN_SAFE_INTEGER;
			let canComeDiag = false;

			if (wordPos <= maxMatchPos) {
				score = doScore(
					pattern, patternLow, patternPos, patternStart,
					word, wordLow, wordPos, wordLen, wordStart,
					diag[row - 1][column - 1] === 0,
					hasStrongFirstMatch,
				);
			}

			let diagScore = 0;
			if (score !== Number.MIN_SAFE_INTEGER) {
				canComeDiag = true;
				diagScore = score + table[row - 1][column - 1];
			}

			const canComeLeft = wordPos > minMatchPos;
			const leftScore = canComeLeft ? table[row][column - 1] + (diag[row][column - 1] > 0 ? -5 : 0) : 0;
			const canComeLeftLeft = wordPos > minMatchPos + 1 && diag[row][column - 1] > 0;
			const leftLeftScore = canComeLeftLeft ? table[row][column - 2] + (diag[row][column - 2] > 0 ? -5 : 0) : 0;

			if (canComeLeftLeft && (!canComeLeft || leftLeftScore >= leftScore) && (!canComeDiag || leftLeftScore >= diagScore)) {
				table[row][column] = leftLeftScore;
				arrows[row][column] = Arrow.LeftLeft;
				diag[row][column] = 0;
			} else if (canComeLeft && (!canComeDiag || leftScore >= diagScore)) {
				table[row][column] = leftScore;
				arrows[row][column] = Arrow.Left;
				diag[row][column] = 0;
			} else if (canComeDiag) {
				table[row][column] = diagScore;
				arrows[row][column] = Arrow.Diag;
				diag[row][column] = diag[row - 1][column - 1] + 1;
			} else {
				throw new Error('not possible');
			}
		}
	}

	if (!hasStrongFirstMatch[0] && !options.firstMatchCanBeWeak) {
		return undefined;
	}

	row--;
	column--;

	const result: FuzzyScore = [table[row][column], wordStart];
	let backwardsDiagLength = 0;
	let maxMatchColumn = 0;

	while (row >= 1) {
		let diagColumn = column;
		do {
			const arrow = arrows[row][diagColumn];
			if (arrow === Arrow.LeftLeft) {
				diagColumn -= 2;
			} else if (arrow === Arrow.Left) {
				diagColumn -= 1;
			} else {
				break;
			}
		} while (diagColumn >= 1);

		if (
			backwardsDiagLength > 1
			&& patternLow[patternStart + row - 1] === wordLow[wordStart + column - 1]
			&& !isUpperCaseAtPos(diagColumn + wordStart - 1, word, wordLow)
			&& backwardsDiagLength + 1 > diag[row][diagColumn]
		) {
			diagColumn = column;
		}

		backwardsDiagLength = diagColumn === column ? backwardsDiagLength + 1 : 1;
		if (!maxMatchColumn) {
			maxMatchColumn = diagColumn;
		}

		row--;
		column = diagColumn - 1;
		result.push(column);
	}

	if (wordLen - wordStart === patternLen && options.boostFullMatch) {
		result[0] += 2;
	}

	result[0] -= maxMatchColumn - patternLen;
	return result;
}

function fillInMaxWordMatchPos(patternLen: number, wordLen: number, patternStart: number, wordStart: number, patternLow: string, wordLow: string) {
	let patternPos = patternLen - 1;
	let wordPos = wordLen - 1;
	while (patternPos >= patternStart && wordPos >= wordStart) {
		if (patternLow[patternPos] === wordLow[wordPos]) {
			maxWordMatchPos[patternPos] = wordPos;
			patternPos--;
		}
		wordPos--;
	}
}

function doScore(
	pattern: string, patternLow: string, patternPos: number, patternStart: number,
	word: string, wordLow: string, wordPos: number, wordLen: number, wordStart: number,
	newMatchStart: boolean,
	outFirstMatchStrong: boolean[],
): number {
	if (patternLow[patternPos] !== wordLow[wordPos]) {
		return Number.MIN_SAFE_INTEGER;
	}

	let score = 1;
	let isGapLocation = false;
	if (wordPos === patternPos - patternStart) {
		score = pattern[patternPos] === word[wordPos] ? 7 : 5;
	} else if (isUpperCaseAtPos(wordPos, word, wordLow) && (wordPos === 0 || !isUpperCaseAtPos(wordPos - 1, word, wordLow))) {
		score = pattern[patternPos] === word[wordPos] ? 7 : 5;
		isGapLocation = true;
	} else if (isSeparatorAtPos(wordLow, wordPos) && (wordPos === 0 || !isSeparatorAtPos(wordLow, wordPos - 1))) {
		score = 5;
	} else if (isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1)) {
		score = 5;
		isGapLocation = true;
	}

	if (score > 1 && patternPos === patternStart) {
		outFirstMatchStrong[0] = true;
	}

	if (!isGapLocation) {
		isGapLocation = isUpperCaseAtPos(wordPos, word, wordLow) || isSeparatorAtPos(wordLow, wordPos - 1) || isWhitespaceAtPos(wordLow, wordPos - 1);
	}

	if (patternPos === patternStart) {
		if (wordPos > wordStart) {
			score -= isGapLocation ? 3 : 5;
		}
	} else if (newMatchStart) {
		score += isGapLocation ? 2 : 0;
	} else {
		score += isGapLocation ? 0 : 1;
	}

	if (wordPos + 1 === wordLen) {
		score -= isGapLocation ? 3 : 5;
	}

	return score;
}

export function createMatches(score: undefined | FuzzyScore): IMatch[] {
	if (typeof score === 'undefined') {
		return [];
	}

	const res: IMatch[] = [];
	const wordPos = score[1];
	for (let i = score.length - 1; i > 1; i--) {
		const pos = score[i] + wordPos;
		const last = res[res.length - 1];
		if (last && last.end === pos) {
			last.end = pos + 1;
		} else {
			res.push({ start: pos, end: pos + 1 });
		}
	}
	return res;
}

export function matchesFuzzy2(pattern: string, word: string): IMatch[] | null {
	const score = fuzzyScore(pattern, pattern.toLowerCase(), 0, word, word.toLowerCase(), 0, { firstMatchCanBeWeak: true, boostFullMatch: true });
	return score ? createMatches(score) : null;
}
