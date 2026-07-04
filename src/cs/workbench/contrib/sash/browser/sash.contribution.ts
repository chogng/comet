import {
  initializeGlobalSashStyles,
} from 'cs/base/browser/ui/sash/sash';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';

export function createWorkbenchSashContribution() {
  initializeGlobalSashStyles();

  return {
    dispose: () => {},
  };
}

registerWorkbenchContribution(createWorkbenchSashContribution);
