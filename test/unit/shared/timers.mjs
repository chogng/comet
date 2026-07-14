export function delay(milliseconds, value) {
	return new Promise(resolve => globalThis.setTimeout(() => resolve(value), milliseconds));
}

export const setTimeout = delay;

export default { setTimeout, delay };
