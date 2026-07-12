/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import {
  getWorkbenchPartDomNode,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';

let cleanupDomEnvironment: (() => void) | null = null;
let ViewPartView: typeof import('cs/workbench/browser/parts/views/viewPartView').ViewPartView;

const props = {
  browserUrl: 'https://example.com/article',
  electronRuntime: true,
  webContentRuntime: true,
  labels: {
    emptyState: 'Empty',
    contentUnavailable: 'Unavailable',
    overlayPauseHeading: 'Paused',
    overlayPauseDetail: 'Dismiss',
  },
};

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ ViewPartView } = await import('cs/workbench/browser/parts/views/viewPartView'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('ViewPartView only clears global part registrations that it currently owns', () => {
  const firstView = new ViewPartView(props);
  const secondView = new ViewPartView(props);

  try {
    const secondViewInternal = secondView as unknown as {
      webContentHost: HTMLElement;
    };

    assert.equal(
      getWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost),
      secondViewInternal.webContentHost,
    );

    firstView.dispose();

    assert.equal(
      getWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost),
      secondViewInternal.webContentHost,
    );
  } finally {
    firstView.dispose();
    secondView.dispose();
  }

  assert.equal(getWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost), null);
});
