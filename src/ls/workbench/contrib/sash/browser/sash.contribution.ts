import {
  initializeGlobalSashStyles,
} from 'ls/base/browser/ui/sash/sash';
import { registerWorkbenchContribution } from 'ls/workbench/common/contributions';

export function createWorkbenchSashContribution() {
  initializeGlobalSashStyles();

  return {
    dispose: () => {},
  };
}

registerWorkbenchContribution(createWorkbenchSashContribution);
