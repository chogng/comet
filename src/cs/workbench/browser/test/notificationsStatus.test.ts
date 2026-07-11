/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { Severity } from 'cs/platform/notification/common/notification';
import {
  NotificationsModel,
} from 'cs/workbench/common/notifications';

test('notifications status stays hidden until there is status content', async () => {
  const dom = installDomTestEnvironment();
  const { NotificationsStatus } = await import(
    'cs/workbench/browser/parts/notifications/notificationsStatus'
  );
  const { NotificationsCenter } = await import(
    'cs/workbench/browser/parts/notifications/notificationsCenter'
  );
  const { NotificationsToasts } = await import(
    'cs/workbench/browser/parts/notifications/notificationsToasts'
  );
  const model = new NotificationsModel();
  const container = document.createElement('div');
  const center = new NotificationsCenter(container, model);
  const status = new NotificationsStatus(container, model, center);

  try {
    const element = status.getElement();
    const button = element.querySelector('.comet-notifications-status-button');
    assert(button instanceof HTMLButtonElement);

    assert.equal(element.classList.contains('comet-is-hidden'), true);

    const notification = model.addNotification({
      severity: Severity.Info,
      message: 'Saved',
    });

    assert.equal(element.classList.contains('comet-is-hidden'), false);
    assert.equal(button.textContent, 'Notifications (1)');

    button.click();
    assert.equal(center.isVisible, true);

    const centerElement = center.getElement();
    assert.equal(
      centerElement.querySelector('.comet-notifications-center-header-title')?.textContent,
      'Notifications',
    );
    const clearButton = centerElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear All Notifications"]',
    );
    const hideButton = centerElement.querySelector<HTMLButtonElement>(
      'button[aria-label="Hide Notifications"]',
    );
    assert(clearButton);
    assert(hideButton);
    assert.equal(clearButton.textContent, '');
    assert.equal(hideButton.textContent, '');

    clearButton.click();
    assert.equal(notification.isClosed, true);
    assert.equal(center.isVisible, false);
    assert.equal(element.classList.contains('comet-is-hidden'), true);

    const statusMessage = model.showStatusMessage('Indexing');
    const messageElement = element.querySelector('.comet-notifications-status-message');
    assert(messageElement instanceof window.HTMLSpanElement);

    assert.equal(element.classList.contains('comet-is-hidden'), false);
    assert.equal(messageElement.textContent, 'Indexing');

    statusMessage.close();
    assert.equal(element.classList.contains('comet-is-hidden'), true);

    const toasts = new NotificationsToasts(container, model);
    const stickyNotifications = Array.from({ length: 4 }, (_, index) =>
      model.addNotification({
        severity: Severity.Info,
        message: `Sticky ${index + 1}`,
        sticky: true,
      }),
    );
    try {
      assert.equal(toasts.getElement().childElementCount, 3);
      assert.equal(stickyNotifications[0]?.isVisible, false);
      assert.equal(stickyNotifications.slice(1).every(item => item.isVisible), true);
    } finally {
      toasts.dispose();
    }
    assert.equal(stickyNotifications.every(item => !item.isVisible), true);
  } finally {
    status.dispose();
    center.dispose();
    model.dispose();
    dom.cleanup();
  }
});
