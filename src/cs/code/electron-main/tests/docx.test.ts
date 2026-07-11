import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ArticleSummaryExportInput } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { exportArticlesToDocxFile } from 'cs/code/electron-main/document/docx';
import { buildDocxBuffer } from 'cs/code/electron-main/document/docxPackage';

function createArticle(title: string): ArticleSummaryExportInput {
	return {
		title,
		authors: [],
		abstract: 'Abstract',
		journalTitle: 'Example Journal',
		publishedAt: '2026-07-04',
	};
}

function readStoredZipEntry(buffer: Buffer, entryName: string) {
	let offset = 0;
	while (offset + 30 <= buffer.length) {
		const signature = buffer.readUInt32LE(offset);
		if (signature !== 0x04034b50) {
			break;
		}

		const compressionMethod = buffer.readUInt16LE(offset + 8);
		const compressedSize = buffer.readUInt32LE(offset + 18);
		const fileNameLength = buffer.readUInt16LE(offset + 26);
		const extraFieldLength = buffer.readUInt16LE(offset + 28);
		const fileNameStart = offset + 30;
		const fileNameEnd = fileNameStart + fileNameLength;
		const dataStart = fileNameEnd + extraFieldLength;
		const dataEnd = dataStart + compressedSize;
		const fileName = buffer.subarray(fileNameStart, fileNameEnd).toString('utf8');

		if (fileName === entryName) {
			assert.equal(compressionMethod, 0);
			return buffer.subarray(dataStart, dataEnd).toString('utf8');
		}

		offset = dataEnd;
	}

	return null;
}

test('article docx export numbers summaries with export order', async () => {
	const directory = await mkdtemp(path.join(tmpdir(), 'comet-docx-test-'));
	const filePath = path.join(directory, 'articles.docx');

	try {
		await exportArticlesToDocxFile({
			articles: [
				createArticle('First article'),
				createArticle('Second article'),
			],
			filePath,
			locale: 'en',
		});

		const documentXml = readStoredZipEntry(await readFile(filePath), 'word/document.xml');

		assert(documentXml);
		assert.match(documentXml, /<w:t>1\. First article<\/w:t>/);
		assert.match(documentXml, /<w:t>2\. Second article<\/w:t>/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('docx package stores relationship parts in OpenXML relationship directories', () => {
	const buffer = buildDocxBuffer({
		documentXml: [
			'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
			'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
			'<w:body><w:p><w:r><w:t>Example</w:t></w:r></w:p></w:body>',
			'</w:document>',
		].join(''),
		coreTitle: 'Example',
		wordRelationships: [{
			id: 'rId1',
			type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
			target: 'media/image1.png',
		}],
	});

	assert(readStoredZipEntry(buffer, '_rels/.rels'));
	assert(readStoredZipEntry(buffer, 'word/_rels/document.xml.rels'));
	assert.equal(readStoredZipEntry(buffer, '_recs/.rels'), null);
	assert.equal(readStoredZipEntry(buffer, 'word/_recs/document.xml.rels'), null);
});
