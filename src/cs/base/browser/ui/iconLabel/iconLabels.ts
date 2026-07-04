/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../dom.js';
import { ThemeIcon } from '../../../common/themables.js';

const labelWithIconsRegex = new RegExp(`(\\\\)?\\$\\((${ThemeIcon.iconNameExpression}(?:${ThemeIcon.iconModifierExpression})?)\\)`, 'g');

export function renderLabelWithIcons(text: string): Array<HTMLSpanElement | string> {
	const elements = new Array<HTMLSpanElement | string>();
	let textStart = 0;
	let match: RegExpExecArray | null;

	while ((match = labelWithIconsRegex.exec(text)) !== null) {
		if (textStart < match.index) {
			elements.push(text.substring(textStart, match.index));
		}

		textStart = match.index + match[0].length;
		const [, escaped, codicon] = match;
		elements.push(escaped ? `$(${codicon})` : renderIcon({ id: codicon }));
	}

	if (textStart < text.length) {
		elements.push(text.substring(textStart));
	}

	return elements;
}

export function renderIcon(icon: ThemeIcon): HTMLSpanElement {
	const node = dom.$('span');
	node.classList.add(...ThemeIcon.asClassNameArray(icon));
	return node;
}
