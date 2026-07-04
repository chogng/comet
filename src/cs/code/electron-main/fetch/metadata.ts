export {
  extractAuthors,
  extractDoi,
  extractPublishedDate,
  extractArticleType,
  extractAbstract,
  extractDescription,
  extractTitle,
  extractFigures as extractNatureFigures,
} from 'cs/code/electron-main/fetch/normalize';
export { extractStructuredDataItems, type StructuredDataRecord } from 'cs/code/electron-main/fetch/rawMetadata';
export {
  extractNatureFigureCaptions,
  extractNatureMainText,
  extractNatureReferenceTexts,
  extractNatureHeaderAuthors,
  extractNatureAbstract,
  isNatureArticlePage,
} from 'cs/code/electron-main/fetch/sites/nature';
