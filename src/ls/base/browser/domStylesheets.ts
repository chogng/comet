/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, toDisposable } from 'ls/base/common/lifecycle';

export function createStyleSheet(
	container: HTMLElement = document.head,
	beforeAppend?: (style: HTMLStyleElement) => void,
	disposableStore?: DisposableStore,
): HTMLStyleElement {
	const style = document.createElement('style');
	style.type = 'text/css';
	style.media = 'screen';
	beforeAppend?.(style);
	container.append(style);
	disposableStore?.add(toDisposable(() => style.remove()));
	return style;
}
