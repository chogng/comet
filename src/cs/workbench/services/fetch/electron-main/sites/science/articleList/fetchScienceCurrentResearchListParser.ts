/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseScienceCard, normalizeScienceHeading, resolveScienceTocRoot, scienceCardSelector, scienceSectionHeadingSelector, scienceSectionSelector, scienceSubsectionHeadingSelector } from 'cs/workbench/services/fetch/electron-main/sites/science/articleList/fetchScienceArticleListShared';
import type { FetchArticleListParser, FetchArticleListParserContext } from 'cs/workbench/services/fetch/electron-main/sites/types';

const targets = [
	{ section: 'news', subsection: 'in depth', sourceArticleType: 'In Depth', articleKind: 'feature' as const },
	{ section: 'research', subsection: 'research articles', sourceArticleType: 'Research Articles', articleKind: 'researchArticle' as const },
] as const;

function collectTargetCards(context: FetchArticleListParserContext) {
	const toc = resolveScienceTocRoot(context);
	if (!toc) return undefined;
	const collected = new Map<string, Parameters<FetchArticleListParserContext['$']>[0][]>();
	for (const section of context.$(toc.root).children(scienceSectionSelector).toArray()) {
		const sectionHeading = normalizeScienceHeading(
			context.$(section).children(scienceSectionHeadingSelector).first().text(),
		);
		let key = '';
		for (const child of context.$(section).children().toArray()) {
			const current = context.$(child);
			if (current.is(scienceSubsectionHeadingSelector)) {
				const subsectionHeading = normalizeScienceHeading(current.text());
				const target = targets.find(item => item.section === sectionHeading && item.subsection === subsectionHeading);
				key = target ? `${target.section}::${target.subsection}` : '';
				if (key && !collected.has(key)) collected.set(key, []);
				continue;
			}
			if (key && current.is(scienceCardSelector)) {
				collected.get(key)?.push(child);
			}
		}
	}
	return targets.every(target => collected.get(`${target.section}::${target.subsection}`)?.length)
		? { toc, collected }
		: undefined;
}

export const fetchScienceCurrentResearchListParser: FetchArticleListParser = {
	id: 'science.currentResearchList.v1',
	match(context) {
		const result = collectTargetCards(context);
		if (!result) return undefined;
		return {
			parserId: this.id,
			evidence: [
				{ kind: 'scienceTocRoot', selector: result.toc.selector },
				{ kind: 'scienceTargetSubsections', value: targets.map(target => `${target.section}/${target.subsection}`).join(',') },
			],
		};
	},
	parse(context) {
		const result = collectTargetCards(context);
		if (!result) return { candidates: [] };
		const candidates = targets.flatMap(target => (
			result.collected.get(`${target.section}::${target.subsection}`) ?? []
		).map(card => parseScienceCard(
			context,
			card,
			target.sourceArticleType,
			target.articleKind,
		)).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined));
		return {
			candidates,
			diagnostics: {
				targets: targets.map(target => ({ ...target })),
				candidateCount: candidates.length,
			},
		};
	},
};
