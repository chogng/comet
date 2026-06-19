import type { DisposableLike } from 'ls/base/common/lifecycle';

export type Disposable = DisposableLike;
export type WorkbenchContribution = DisposableLike;
export type WorkbenchContributionFactory = () =>
  | WorkbenchContribution
  | void;

const workbenchContributionFactories: WorkbenchContributionFactory[] = [];
const activeWorkbenchContributions: WorkbenchContribution[] = [];
let workbenchContributionsStarted = false;

export function registerWorkbenchContribution(
  contributionFactory: WorkbenchContributionFactory,
) {
  workbenchContributionFactories.push(contributionFactory);

  if (!workbenchContributionsStarted) {
    return;
  }

  const contribution = contributionFactory();
  if (contribution) {
    activeWorkbenchContributions.push(contribution);
  }
}

export function startWorkbenchContributions() {
  if (workbenchContributionsStarted) {
    return;
  }

  workbenchContributionsStarted = true;

  for (const contributionFactory of workbenchContributionFactories) {
    const contribution = contributionFactory();
    if (contribution) {
      activeWorkbenchContributions.push(contribution);
    }
  }
}

export function stopWorkbenchContributions() {
  while (activeWorkbenchContributions.length > 0) {
    activeWorkbenchContributions.pop()?.dispose();
  }

  workbenchContributionsStarted = false;
}
