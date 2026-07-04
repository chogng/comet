/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ThemeColor {
	id: string;
}

export namespace ThemeColor {
	export function isThemeColor(obj: unknown): obj is ThemeColor {
		return !!obj && typeof obj === 'object' && typeof (obj as ThemeColor).id === 'string';
	}
}

export interface ThemeIcon {
	readonly id: string;
	readonly color?: ThemeColor;
}

export namespace ThemeIcon {
	export const iconNameExpression = '[A-Za-z0-9-]+';
	export const iconModifierExpression = '~[A-Za-z]+';
	export const iconNameCharacter = '[A-Za-z0-9~-]';

	const themeIconIdRegex = new RegExp(`^(${iconNameExpression})(${iconModifierExpression})?$`);

	export function asClassNameArray(icon: ThemeIcon): string[] {
		const match = themeIconIdRegex.exec(icon.id);
		if (!match) {
			return ['codicon', 'codicon-error'];
		}

		const [, id, modifier] = match;
		const classNames = ['codicon', `codicon-${id}`];
		if (modifier) {
			classNames.push(`codicon-modifier-${modifier.substring(1)}`);
		}
		return classNames;
	}
}
