/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';

let browserTabKeepAliveLimit = defaultBrowserTabKeepAliveLimit;
const onDidChangeWorkbenchWebContentRetentionEmitter = new EventEmitter<void>();

export function subscribeWorkbenchWebContentRetention(listener: () => void) {
  return onDidChangeWorkbenchWebContentRetentionEmitter.event(listener);
}

export function getWorkbenchBrowserTabKeepAliveLimit() {
  return browserTabKeepAliveLimit;
}

export function setWorkbenchBrowserTabKeepAliveLimit(value: unknown) {
  const nextValue = normalizeBrowserTabKeepAliveLimit(
    value,
    browserTabKeepAliveLimit,
  );
  if (nextValue === browserTabKeepAliveLimit) {
    return;
  }

  browserTabKeepAliveLimit = nextValue;
  onDidChangeWorkbenchWebContentRetentionEmitter.fire();
}

export function resetWorkbenchBrowserTabKeepAliveLimit() {
  setWorkbenchBrowserTabKeepAliveLimit(defaultBrowserTabKeepAliveLimit);
}
