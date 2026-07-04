import type { PdfDownloadResult } from 'cs/base/parts/sandbox/common/sandboxTypes';

export type PdfDownloadContext = {
  pageUrl: string;
  requestedDownloadUrl: string | null;
  doi: string | null;
  articleTitle: string;
  journalTitle: string;
  downloadDir: string;
  webContentHtmlSnapshot: string | null;
  abortSignal?: AbortSignal;
  sciencePdfCandidateUrls: string[];
  naturePdfCandidateUrls: string[];
};

export type PdfDownloadStrategyPriority = 'exclusive' | 'preferred' | 'fallback';

export interface PdfDownloadStrategy {
  id: string;
  priority: PdfDownloadStrategyPriority;
  matches(request: PdfDownloadContext): boolean;
  download(request: PdfDownloadContext): Promise<PdfDownloadResult | null>;
}

