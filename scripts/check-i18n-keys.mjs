import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const enPath = path.join(rootDir, 'build/lib/locales/en.json');
const zhPath = path.join(rootDir, 'build/lib/locales/zh.json');
const sourceDirs = [
	path.join(rootDir, 'src'),
];

function extractKeys(filePath) {
	return Object.keys(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function diff(base, compare) {
	return base.filter(item => !compare.includes(item));
}

function collectFiles(directory) {
	const entries = fs.readdirSync(directory, { withFileTypes: true });
	return entries.flatMap(entry => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory() && entry.name === 'tests') {
			return [];
		}

		if (entry.isDirectory()) {
			return collectFiles(entryPath);
		}

		return entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [entryPath] : [];
	});
}

function extractLocalizeKeys(filePath) {
	const content = fs.readFileSync(filePath, 'utf8');
	if (!/from\s+['"](?:ls|language)\/nls['"]/.test(content)) {
		return [];
	}

	return [...content.matchAll(/\blocalize2?\(\s*(?:\{\s*key:\s*)?['"]([^'"]+)['"]/g)]
		.map(match => match[1]);
}

const enKeys = extractKeys(enPath);
const zhKeys = extractKeys(zhPath);
const localeKeys = new Set([...enKeys, ...zhKeys]);
const sourceKeys = [
	...new Set(sourceDirs.flatMap(collectFiles).flatMap(extractLocalizeKeys)),
];

const enOnly = diff(enKeys, zhKeys);
const zhOnly = diff(zhKeys, enKeys);
const sourceOnly = diff(sourceKeys, [...localeKeys]);

if (enOnly.length === 0 && zhOnly.length === 0 && sourceOnly.length === 0) {
	console.log(`i18n keys aligned: en=${enKeys.length}, zh=${zhKeys.length}`);
	process.exit(0);
}

console.error('i18n key mismatch detected.');
if (enOnly.length) {
	console.error(`Only in en.json (${enOnly.length}): ${enOnly.join(', ')}`);
}
if (zhOnly.length) {
	console.error(`Only in zh.json (${zhOnly.length}): ${zhOnly.join(', ')}`);
}
if (sourceOnly.length) {
	console.error(`Missing from locale JSON (${sourceOnly.length}): ${sourceOnly.join(', ')}`);
}
process.exit(1);
