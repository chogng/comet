import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptFilePath = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(scriptFilePath));
const fixtureDir = process.env.LS_PDF_FIXTURE_DIR
  ? path.resolve(process.env.LS_PDF_FIXTURE_DIR)
  : path.join(rootDir, '.tmp', 'pdf-fixtures');

function escapePdfText(value) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function createPdfBuffer({ width = 612, height = 792, lines }) {
  const content = [
    'BT',
    '/F1 14 Tf',
    ...lines.map((line, index) => {
      const x = line.x ?? 72;
      const y = line.y ?? height - 72 - index * 18;
      return `1 0 0 1 ${x} ${y} Tm (${escapePdfText(line.text)}) Tj`;
    }),
    'ET',
    '',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}endstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

const fixtures = [
  {
    fileName: 'selection-smoke.pdf',
    expectedText: 'Literature Studio PDF smoke',
    lines: [{ text: 'Literature Studio PDF smoke', x: 72, y: 720 }],
  },
  {
    fileName: 'selection-two-column.pdf',
    expectedText: 'Left column alpha beta Right column gamma delta',
    lines: [
      { text: 'Left column alpha beta', x: 72, y: 720 },
      { text: 'Right column gamma delta', x: 320, y: 720, leading: 0 },
    ],
  },
  {
    fileName: 'selection-tight-lines.pdf',
    expectedText: 'Tight line one Tight line two',
    lines: [
      { text: 'Tight line one', x: 72, y: 720 },
      { text: 'Tight line two', x: 72, y: 708, leading: 12 },
    ],
  },
];

await mkdir(fixtureDir, { recursive: true });

const manifest = [];
for (const fixture of fixtures) {
  const filePath = path.join(fixtureDir, fixture.fileName);
  await writeFile(filePath, createPdfBuffer(fixture));
  manifest.push({
    fileName: fixture.fileName,
    filePath,
    expectedText: fixture.expectedText,
  });
}

await writeFile(
  path.join(fixtureDir, 'manifest.json'),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    fixtures: manifest,
  }, null, 2)}\n`,
);

console.log(`Wrote ${fixtures.length} PDF fixtures to ${fixtureDir}`);
