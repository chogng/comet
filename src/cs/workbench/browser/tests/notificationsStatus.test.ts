import assert from 'node:assert/strict';
import test from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { Severity } from 'cs/platform/notification/common/notification';
import type { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import {
  NotificationsStatus,
} from 'cs/workbench/browser/parts/notifications/notificationsStatus';
import {
  NotificationsModel,
} from 'cs/workbench/common/notifications';

test('notifications status stays hidden until there is status content', () => {
  const dom = installDomTestEnvironment();
  const model = new NotificationsModel();
  const container = document.createElement('div');
  let toggleCount = 0;
  const center = {
    toggle() {
      toggleCount += 1;
    },
  } as NotificationsCenter;
  const status = new NotificationsStatus(container, model, center);

  try {
    const element = status.getElement();
    const button = element.querySelector('.notifications-status-button');
    assert(button instanceof HTMLButtonElement);

    assert.equal(element.classList.contains('is-hidden'), true);

    const notification = model.addNotification({
      severity: Severity.Info,
      message: 'Saved',
    });

    assert.equal(element.classList.contains('is-hidden'), false);
    assert.equal(button.textContent, 'Notifications (1)');

    button.click();
    assert.equal(toggleCount, 1);

    notification.close();
    assert.equal(element.classList.contains('is-hidden'), true);

    const statusMessage = model.showStatusMessage('Indexing');
    const messageElement = element.querySelector('.notifications-status-message');
    assert(messageElement instanceof window.HTMLSpanElement);

    assert.equal(element.classList.contains('is-hidden'), false);
    assert.equal(messageElement.textContent, 'Indexing');

    statusMessage.close();
    assert.equal(element.classList.contains('is-hidden'), true);
  } finally {
    status.dispose();
    model.dispose();
    dom.cleanup();
  }
});
