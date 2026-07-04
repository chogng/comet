import { resolveDefaultJournalTitleFromSourceUrl } from 'cs/workbench/services/config/configSchema';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';

type ResolveNextJournalTitleOnUrlChangeParams = {
  currentJournalTitle: string;
  previousUrl: string;
  nextUrl: string;
  sourceTable?: ReadonlyArray<BatchSource>;
};

export function resolveNextJournalTitleOnUrlChange({
  currentJournalTitle,
  previousUrl,
  nextUrl,
  sourceTable,
}: ResolveNextJournalTitleOnUrlChangeParams): string {
  const previousDefaultJournalTitle = resolveDefaultJournalTitleFromSourceUrl(previousUrl, sourceTable);
  const nextDefaultJournalTitle = resolveDefaultJournalTitleFromSourceUrl(nextUrl, sourceTable);
  const currentJournalTitleTrimmed = currentJournalTitle.trim();
  const shouldReplaceJournalTitle =
    !currentJournalTitleTrimmed || currentJournalTitleTrimmed === previousDefaultJournalTitle;

  return shouldReplaceJournalTitle ? nextDefaultJournalTitle : currentJournalTitle;
}
