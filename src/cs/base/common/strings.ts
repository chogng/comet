export function cleanText(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanNullable(value: unknown) {
  const normalized = cleanText(value);
  return normalized ? normalized : null;
}

export function uniq(values: string[]) {
  return [...new Set(values)];
}

export function pickFirstNonEmpty(values: unknown[]) {
  for (const value of values) {
    const normalized = cleanText(value);
    if (normalized) {
      return normalized;
    }
  }

  return '';
}

export function escape(html: string): string {
	return html.replace(/[<>&]/g, match => {
		switch (match) {
			case '<':
				return '&lt;';
			case '>':
				return '&gt;';
			case '&':
				return '&amp;';
			default:
				return match;
		}
	});
}

export function ltrim(haystack: string, needle: string): string {
	if (!haystack || !needle) {
		return haystack;
	}

	const needleLength = needle.length;
	let offset = 0;
	if (needleLength === 1) {
		const ch = needle.charCodeAt(0);
		while (offset < haystack.length && haystack.charCodeAt(offset) === ch) {
			offset++;
		}
		return haystack.substring(offset);
	}

	while (haystack.startsWith(needle, offset)) {
		offset += needleLength;
	}

	return haystack.substring(offset);
}

export function rtrim(haystack: string, needle: string): string {
	if (!haystack || !needle) {
		return haystack;
	}

	const needleLength = needle.length;
	const haystackLength = haystack.length;

	if (needleLength === 1) {
		let end = haystackLength;
		const ch = needle.charCodeAt(0);
		while (end > 0 && haystack.charCodeAt(end - 1) === ch) {
			end--;
		}
		return haystack.substring(0, end);
	}

	let offset = haystackLength;
	while (offset > 0 && haystack.endsWith(needle, offset)) {
		offset -= needleLength;
	}

	return haystack.substring(0, offset);
}

export function compare(a: string, b: string): number {
	if (a < b) {
		return -1;
	} else if (a > b) {
		return 1;
	}
	return 0;
}

export function compareSubstring(a: string, b: string, aStart: number = 0, aEnd: number = a.length, bStart: number = 0, bEnd: number = b.length): number {
	for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
		const codeA = a.charCodeAt(aStart);
		const codeB = b.charCodeAt(bStart);
		if (codeA < codeB) {
			return -1;
		} else if (codeA > codeB) {
			return 1;
		}
	}

	const aLength = aEnd - aStart;
	const bLength = bEnd - bStart;
	if (aLength < bLength) {
		return -1;
	} else if (aLength > bLength) {
		return 1;
	}
	return 0;
}

export function compareIgnoreCase(a: string, b: string): number {
	return compareSubstringIgnoreCase(a, b, 0, a.length, 0, b.length);
}

export function compareSubstringIgnoreCase(a: string, b: string, aStart: number = 0, aEnd: number = a.length, bStart: number = 0, bEnd: number = b.length): number {
	for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {
		let codeA = a.charCodeAt(aStart);
		let codeB = b.charCodeAt(bStart);

		if (codeA === codeB) {
			continue;
		}

		if (codeA >= 128 || codeB >= 128) {
			return compareSubstring(a.toLowerCase(), b.toLowerCase(), aStart, aEnd, bStart, bEnd);
		}

		if (isLowerAsciiLetter(codeA)) {
			codeA -= 32;
		}
		if (isLowerAsciiLetter(codeB)) {
			codeB -= 32;
		}

		const diff = codeA - codeB;
		if (diff !== 0) {
			return diff;
		}
	}

	const aLength = aEnd - aStart;
	const bLength = bEnd - bStart;
	if (aLength < bLength) {
		return -1;
	} else if (aLength > bLength) {
		return 1;
	}
	return 0;
}

export function isLowerAsciiLetter(code: number): boolean {
	return code >= 97 && code <= 122;
}

export function equalsIgnoreCase(a: string, b: string): boolean {
	return a.length === b.length && compareSubstringIgnoreCase(a, b) === 0;
}

export function startsWithIgnoreCase(str: string, candidate: string): boolean {
	const length = candidate.length;
	return length <= str.length && compareSubstringIgnoreCase(str, candidate, 0, length) === 0;
}

export function isHighSurrogate(charCode: number): boolean {
	return 0xD800 <= charCode && charCode <= 0xDBFF;
}

export function isLowSurrogate(charCode: number): boolean {
	return 0xDC00 <= charCode && charCode <= 0xDFFF;
}

export function computeCodePoint(highSurrogate: number, lowSurrogate: number): number {
	return ((highSurrogate - 0xD800) << 10) + (lowSurrogate - 0xDC00) + 0x10000;
}
