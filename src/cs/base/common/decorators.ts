/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

export function memoize(
	_target: unknown,
	key: string,
	descriptor: PropertyDescriptor,
): void {
	const fn = descriptor.get;
	if (typeof fn !== 'function') {
		throw new Error('memoize can only decorate getters');
	}

	descriptor.get = function memoizedGetter() {
		const value = fn.call(this);
		Object.defineProperty(this, key, {
			configurable: true,
			enumerable: false,
			value,
		});
		return value;
	};
}
