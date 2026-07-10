/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanText } from 'cs/base/common/strings';
import { normalizeScienceHeading, parseScienceCard, resolveScienceTocRoot, scienceCardSelector, scienceSectionHeadingSelector, scienceSectionSelector } from 'cs/workbench/services/fetch/electron-main/sites/science/articleList/fetchScienceArticleListShared';
import type { FetchArticleListParser, FetchArticleListParserContext } from 'cs/workbench/services/fetch/electron-main/sites/types';

const targetHeading = 'physical and materials sciences';

function resolveTargetSection(context: FetchArticleListParserContext) {
	const toc = resolveScienceTocRoot(context);
	if (!toc) return undefined;
	const matched = context.$(toc.root).children(scienceSectionSelector).toArray().filter(section => {
		const heading = normalizeScienceHeading(
			context.$(section).find(scienceSectionHeadingSelector).first().text(),
		);
		return heading === targetHeading;
	});
	if (matched.length !== 1) return undefined;
	const cards = context.$(matched[0]).find(scienceCardSelector).toArray();
	return cards.length > 0 ? { toc, section: matched[0], cards } : undefined;
}

export const fetchScienceAdvancesPhysicalMaterialsListParser: FetchArticleListParser = {
	id: 'science.advancesPhysicalMaterialsList.v1',
	match(context) {
		const result = resolveTargetSection(context);
		return result ? {
			parserId: this.id,
			evidence: [
				{ kind: 'scienceTocRoot', selector: result.toc.selector },
				{ kind: 'scienceSectionHeading', selector: scienceSectionHeadingSelector, value: targetHeading },
			],
		} : undefined;
	},
	parse(context) {
		const result = resolveTargetSection(context);
		if (!result) return { candidates: [] };
		const candidates = result.cards.map(card => parseScienceCard(
			context,
			card,
			'Physical and Materials Sciences',
			'researchArticle',
		)).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
		return {
			candidates,
			diagnostics: {
				targetHeading,
				candidateCount: candidates.length,
				sectionTitle: cleanText(context.$(result.section).find(scienceSectionHeadingSelector).first().text()),
			},
		};
	},
};
