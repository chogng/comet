import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPdfFeatureFlagDefinition,
  isPdfFeatureFlagEnabled,
  pdfFeatureFlags,
} from 'ls/workbench/services/pdf/featureFlags';

test('PDF feature flags define roadmap gates without enabling parser/RAG by default', () => {
  assert.equal(pdfFeatureFlags.length, 7);
  assert.equal(isPdfFeatureFlagEnabled('pdf.selection.v2'), true);
  assert.equal(isPdfFeatureFlagEnabled('pdf.annotation.anchorV2'), true);
  assert.equal(isPdfFeatureFlagEnabled('pdf.parser.pdfiumLite'), false);
  assert.equal(isPdfFeatureFlagEnabled('pdf.rag.indexPdf'), false);
  assert.equal(isPdfFeatureFlagEnabled('pdf.parser.pdfiumLite', {
    'pdf.parser.pdfiumLite': true,
  }), true);
  assert.equal(getPdfFeatureFlagDefinition('pdf.externalArtifactImport')?.stage, 'dev-only');
});
