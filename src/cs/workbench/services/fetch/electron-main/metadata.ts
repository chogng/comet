export {
  extractAuthors,
  extractDoi,
  extractPublishedDate,
  extractArticleType,
  extractAbstract,
  extractDescription,
  extractTitle,
  extractFigures as extractNatureFigures,
} from 'cs/workbench/services/fetch/electron-main/normalize';
export { extractStructuredDataItems, type StructuredDataRecord } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
export {
  extractNatureFigureCaptions,
  extractNatureMainText,
  extractNatureReferenceTexts,
  extractNatureHeaderAuthors,
  extractNatureAbstract,
  isNatureArticlePage,
} from 'cs/workbench/services/fetch/electron-main/sites/nature';
