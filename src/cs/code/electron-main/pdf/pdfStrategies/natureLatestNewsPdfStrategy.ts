import { isLikelyNatureLatestNewsArticleUrl, tryDownloadNatureLatestNewsPdf } from 'cs/code/electron-main/pdf/natureLatestNewsPdf';
import type { PdfDownloadStrategy } from 'cs/code/electron-main/pdf/pdfStrategies/pdfStrategyTypes';

export const natureLatestNewsPdfStrategy: PdfDownloadStrategy = {
  id: 'nature-latest-news-pdf',
  priority: 'preferred',
  matches(request) {
    if (typeof request.webContentHtmlSnapshot === 'string' && request.webContentHtmlSnapshot.trim()) {
      return request.naturePdfCandidateUrls.length > 0;
    }

    return isLikelyNatureLatestNewsArticleUrl(request.pageUrl);
  },
  async download(request) {
    return await tryDownloadNatureLatestNewsPdf(request);
  },
};
