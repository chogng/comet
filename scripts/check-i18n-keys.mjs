import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const enPath = path.join(rootDir, 'build/lib/locales/en.ts');
const zhPath = path.join(rootDir, 'build/lib/locales/zh.ts');

function extractKeys(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return [...content.matchAll(/^\s{2}([a-zA-Z0-9_]+):/gm)].map((match) => match[1]);
}

function diff(base, compare) {
  return base.filter((item) => !compare.includes(item));
}

const enKeys = extractKeys(enPath);
const zhKeys = extractKeys(zhPath);

const enOnly = diff(enKeys, zhKeys);
const zhOnly = diff(zhKeys, enKeys);

if (enOnly.length === 0 && zhOnly.length === 0) {
  console.log(`i18n keys aligned: en=${enKeys.length}, zh=${zhKeys.length}`);
  process.exit(0);
}

console.error('i18n key mismatch detected.');
if (enOnly.length) {
  console.error(`Only in en.ts (${enOnly.length}): ${enOnly.join(', ')}`);
}
if (zhOnly.length) {
  console.error(`Only in zh.ts (${zhOnly.length}): ${zhOnly.join(', ')}`);
}
process.exit(1);
