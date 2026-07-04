/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ThemeIcon } from './themables.js';

const iconsRegex = new RegExp(`\\$\\(${ThemeIcon.iconNameExpression}(?:${ThemeIcon.iconModifierExpression})?\\)`, 'g');
const escapeIconsRegex = new RegExp(`(\\\\)?${iconsRegex.source}`, 'g');

export function escapeIcons(text: string): string {
	return text.replace(escapeIconsRegex, (match, escaped: string | undefined) => escaped ? match : `\\${match}`);
}

const markdownEscapedIconsRegex = new RegExp(`\\\\${iconsRegex.source}`, 'g');

export function markdownEscapeEscapedIcons(text: string): string {
	return text.replace(markdownEscapedIconsRegex, match => `\\${match}`);
}
