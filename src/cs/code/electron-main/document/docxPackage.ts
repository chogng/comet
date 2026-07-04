export type ZipEntry = {
  name: string;
  data: Buffer;
};

export type DocxContentTypeDefault = {
  extension: string;
  contentType: string;
};

export type DocxContentTypeOverride = {
  partName: string;
  contentType: string;
};

export type DocxRelationship = {
  id: string;
  type: string;
  target: string;
};

const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildContentTypesXml({
  defaults = [],
  overrides = [],
}: {
  defaults?: readonly DocxContentTypeDefault[];
  overrides?: readonly DocxContentTypeOverride[];
} = {}) {
  const defaultEntries = [
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    ...defaults.map(
      (entry) =>
        `<Default Extension="${escapeXml(entry.extension)}" ContentType="${escapeXml(entry.contentType)}"/>`,
    ),
  ];

  const overrideEntries = [
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    ...overrides.map(
      (entry) =>
        `<Override PartName="${escapeXml(entry.partName)}" ContentType="${escapeXml(entry.contentType)}"/>`,
    ),
  ];

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    ...defaultEntries,
    ...overrideEntries,
    '</Types>',
  ].join('');
}

export function buildRelationshipsXml(relationships: readonly DocxRelationship[]) {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...relationships.map(
      (entry) =>
        `<Relationship Id="${escapeXml(entry.id)}" Type="${escapeXml(entry.type)}" Target="${escapeXml(entry.target)}"/>`,
    ),
    '</Relationships>',
  ].join('');
}

export function buildRootRelationshipsXml() {
  return buildRelationshipsXml([
    {
      id: 'rId1',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
      target: 'word/document.xml',
    },
    {
      id: 'rId2',
      type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
      target: 'docProps/core.xml',
    },
    {
      id: 'rId3',
      type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
      target: 'docProps/app.xml',
    },
  ]);
}

export function buildAppPropertiesXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    '<Application>Comet Studio</Application>',
    '</Properties>',
  ].join('');
}

export function buildCorePropertiesXml({
  title,
  exportedAt,
}: {
  title: string;
  exportedAt: Date;
}) {
  const timestamp = escapeXml(exportedAt.toISOString());
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `<dc:title>${escapeXml(title)}</dc:title>`,
    '<dc:creator>Comet Studio</dc:creator>',
    '<cp:lastModifiedBy>Comet Studio</cp:lastModifiedBy>',
    `<dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created>`,
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified>`,
    '</cp:coreProperties>',
  ].join('');
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

export function buildZip(entries: readonly ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const timestamp = toDosDateTime(new Date());
  let offset = 0;

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name.replace(/\\/g, '/'));
    const dataBuffer = entry.data;
    const entryCrc = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(timestamp.time, 10);
    localHeader.writeUInt16LE(timestamp.date, 12);
    localHeader.writeUInt32LE(entryCrc, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(timestamp.time, 12);
    centralHeader.writeUInt16LE(timestamp.date, 14);
    centralHeader.writeUInt32LE(entryCrc, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(offset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, endOfCentralDirectory]);
}

export function buildDocxBuffer({
  documentXml,
  coreTitle,
  exportedAt = new Date(),
  contentTypeDefaults = [],
  contentTypeOverrides = [],
  wordRelationships = [],
  extraEntries = [],
}: {
  documentXml: string;
  coreTitle: string;
  exportedAt?: Date;
  contentTypeDefaults?: readonly DocxContentTypeDefault[];
  contentTypeOverrides?: readonly DocxContentTypeOverride[];
  wordRelationships?: readonly DocxRelationship[];
  extraEntries?: readonly ZipEntry[];
}) {
  const entries: ZipEntry[] = [
    {
      name: '[Content_Types].xml',
      data: Buffer.from(
        buildContentTypesXml({
          defaults: contentTypeDefaults,
          overrides: contentTypeOverrides,
        }),
        'utf8',
      ),
    },
    {
      name: '_rels/.rels',
      data: Buffer.from(buildRootRelationshipsXml(), 'utf8'),
    },
    {
      name: 'docProps/app.xml',
      data: Buffer.from(buildAppPropertiesXml(), 'utf8'),
    },
    {
      name: 'docProps/core.xml',
      data: Buffer.from(buildCorePropertiesXml({ title: coreTitle, exportedAt }), 'utf8'),
    },
    {
      name: 'word/document.xml',
      data: Buffer.from(documentXml, 'utf8'),
    },
  ];

  if (wordRelationships.length > 0) {
    entries.push({
      name: 'word/_rels/document.xml.rels',
      data: Buffer.from(buildRelationshipsXml(wordRelationships), 'utf8'),
    });
  }

  entries.push(...extraEntries);
  return buildZip(entries);
}

export function normalizeDocxPath(filePath: string) {
  return filePath.toLowerCase().endsWith('.docx') ? filePath : `${filePath}.docx`;
}
