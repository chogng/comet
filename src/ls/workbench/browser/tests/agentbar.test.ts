import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import { HorizontalScrollbar } from 'ls/base/browser/ui/scrollbar/horizontalScrollbar';
import type { AgentChatWidgetProps } from 'ls/workbench/contrib/agentChat/browser/agentChatWidget';

let cleanupDomEnvironment: (() => void) | null = null;
let createAgentChatWidget: typeof import('ls/workbench/contrib/agentChat/browser/agentChatWidget').createAgentChatWidget;
let createAgentBarPartView: typeof import('ls/workbench/browser/parts/agentbar/agentbarPart').createAgentBarPartView;
let SidebarTopbarActionsView: typeof import('ls/workbench/browser/parts/sidebar/sidebarTopbarActions').SidebarTopbarActionsView;

function createProps(): AgentChatWidgetProps {
  return {
    labels: {
      assistantAnswerTitle: 'Answer',
      assistantEvidenceTitle: 'Evidence',
      assistantPatchApply: 'Apply patch',
      assistantPatchApplied: 'Applied',
      assistantPatchRequiresExecutor: 'Custom executor required',
      assistantNewConversation: 'New chat',
      assistantHistory: 'History',
      assistantMore: 'More',
      assistantShowSecondarySidebar: 'Show secondary sidebar',
      assistantHideSecondarySidebar: 'Hide secondary sidebar',
      assistantQuestion: 'Question',
      assistantQuestionPlaceholder: 'Ask something',
      assistantVoice: 'Voice',
      assistantImage: 'Image',
      assistantSend: 'Send',
      assistantSendBusy: 'Asking...',
      assistantRerankOn: 'Rerank on',
      assistantRerankOff: 'Rerank off',
    },
    isKnowledgeBaseModeEnabled: true,
    messages: [],
    question: '',
    onQuestionChange: () => {},
    isAsking: false,
    errorMessage: null,
    onAsk: () => {},
    onApplyPatch: () => {},
    availableArticleCount: 1,
    conversations: [
      {
        id: 'conversation-1',
        title: 'Conversation 1',
        autoTitleIndex: null,
        question: '',
        result: null,
        messages: [],
        isAsking: false,
        errorMessage: null,
      },
    ],
    activeConversationId: 'conversation-1',
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
    ],
    activeLlmModelOptionValue: 'auto',
    onCreateConversation: () => {},
    onActivateConversation: () => {},
    onCloseConversation: () => {},
    onCloseAgentBar: () => {},
    onSelectLlmModel: () => {},
    onOpenModelSettings: () => {},
  };
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createAgentChatWidget } = await import('ls/workbench/contrib/agentChat/browser/agentChatWidget'));
  ({ createAgentBarPartView } = await import('ls/workbench/browser/parts/agentbar/agentbarPart'));
  ({ SidebarTopbarActionsView } = await import('ls/workbench/browser/parts/sidebar/sidebarTopbarActions'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('agent bar action buttons expose labels and shared hover', async () => {
  const agentBar = createAgentChatWidget(createProps());
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.sidebar-action-bar .sidebar-action-btn'),
    );
    assert.equal(actionButtons.length, 4);
    assert.deepEqual(
      actionButtons.map((button) => button.getAttribute('aria-label')),
      ['New chat', 'History', 'More', 'Show secondary sidebar'],
    );

    const historyButton = actionButtons[1];
    assert(historyButton instanceof HTMLButtonElement);
    assert.equal(historyButton.getAttribute('aria-haspopup'), 'menu');

    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }),
    );
    historyButton.dispatchEvent(new Event('focus', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.ls-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'History');
  } finally {
    agentBar.dispose();
  }
});

test('agent bar topbar exposes a primary sidebar toggle when the primary sidebar is hidden', () => {
  let toggleCount = 0;
  const topbarActionsView = new SidebarTopbarActionsView({
    isPrimarySidebarVisible: false,
    primarySidebarToggleLabel: 'Show primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {
      toggleCount += 1;
    },
  });
  const agentBar = createAgentBarPartView({
    ...createProps(),
    isPrimarySidebarVisible: false,
    topbarActionsElement: topbarActionsView.getElement(),
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const toggleButton = element.querySelector(
      '.agentbar-topbar .sidebar-topbar-toggle-btn',
    );
    assert(toggleButton instanceof HTMLButtonElement);
    assert.equal(
      toggleButton.getAttribute('aria-label'),
      'Show primary sidebar',
    );

    toggleButton.click();
    assert.equal(toggleCount, 1);
  } finally {
    agentBar.dispose();
    topbarActionsView.dispose();
  }
});

test('agent bar topbar exposes an address bar action', () => {
  const topbarActionsView = new SidebarTopbarActionsView({
    isPrimarySidebarVisible: false,
    primarySidebarToggleLabel: 'Show primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  });
  const agentBar = createAgentBarPartView({
    ...createProps(),
    isPrimarySidebarVisible: false,
    topbarActionsElement: topbarActionsView.getElement(),
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const searchButton = element.querySelector(
      '.agentbar-topbar .sidebar-topbar-search-btn',
    );
    assert(searchButton instanceof HTMLButtonElement);
    assert.equal(searchButton.getAttribute('aria-label'), 'Address bar');
  } finally {
    agentBar.dispose();
    topbarActionsView.dispose();
  }
});

test('agent bar more action uses dropdown action view item', async () => {
  let createConversationCount = 0;
  const agentBar = createAgentChatWidget({
    ...createProps(),
    onCreateConversation: () => {
      createConversationCount += 1;
    },
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.sidebar-action-bar .sidebar-action-btn'),
    );
    const moreButton = actionButtons[2];
    assert(moreButton instanceof HTMLButtonElement);

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector('.actionbar-context-view .dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-topbar-more');
    assert.equal(moreButton.getAttribute('aria-expanded'), 'true');

    const newChatItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('New chat'),
    );
    assert(newChatItem instanceof HTMLElement);
    newChatItem.click();
    await delay(0);

    assert.equal(createConversationCount, 1);
    assert.equal(moreButton.getAttribute('aria-expanded'), 'false');
  } finally {
    agentBar.dispose();
  }
});

test('agent bar history action supports search and empty states', async () => {
  let activatedConversationId = '';
  const agentBar = createAgentChatWidget({
    ...createProps(),
    conversations: [
      {
        id: 'conversation-1',
        title: 'Conversation 1',
        autoTitleIndex: null,
        question: '',
        result: null,
        messages: [],
        isAsking: false,
        errorMessage: null,
      },
      {
        id: 'conversation-2',
        title: 'Conversation 2',
        autoTitleIndex: null,
        question: '',
        result: null,
        messages: [{ id: 'm1', role: 'user', content: 'hello' }],
        isAsking: false,
        errorMessage: null,
      },
    ],
    onActivateConversation: (conversationId) => {
      activatedConversationId = conversationId;
    },
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.sidebar-action-bar .sidebar-action-btn'),
    );
    const historyButton = actionButtons[1];
    assert(historyButton instanceof HTMLButtonElement);

    historyButton.click();
    await delay(0);

    const menu = document.body.querySelector('.actionbar-context-view .dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-topbar-history');
    assert.equal(historyButton.getAttribute('aria-expanded'), 'true');
    const searchInput = menu.querySelector('.ls-menu-header .agentbar-history-search-input .input');
    assert(searchInput instanceof HTMLInputElement);
    assert.equal(menu.firstElementChild?.classList.contains('ls-menu-header'), true);

    searchInput.value = 'conversation 2';
    searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await delay(0);

    const historyItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Conversation 2'),
    );
    assert(historyItem instanceof HTMLElement);
    historyItem.click();
    await delay(0);

    assert.equal(activatedConversationId, 'conversation-2');
    assert.equal(historyButton.getAttribute('aria-expanded'), 'false');

    historyButton.click();
    await delay(0);
    const reopenedMenu = document.body.querySelector('.actionbar-context-view .dropdown-menu');
    assert(reopenedMenu instanceof HTMLElement);
    const reopenedSearchInput = reopenedMenu.querySelector(
      '.ls-menu-header .agentbar-history-search-input .input',
    );
    assert(reopenedSearchInput instanceof HTMLInputElement);
    reopenedSearchInput.value = 'not-found';
    reopenedSearchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await delay(0);
    const emptyState = Array.from(reopenedMenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('no matching agents'),
    );
    assert(emptyState instanceof HTMLElement);
    assert.equal(emptyState.textContent?.trim(), 'no matching agents');
  } finally {
    agentBar.dispose();
  }
});

test('agent bar history action shows no matching agents when there is no history', async () => {
  const agentBar = createAgentChatWidget({
    ...createProps(),
    conversations: [],
    activeConversationId: '',
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.sidebar-action-bar .sidebar-action-btn'),
    );
    const historyButton = actionButtons[1];
    assert(historyButton instanceof HTMLButtonElement);

    historyButton.click();
    await delay(0);

    const menu = document.body.querySelector('.actionbar-context-view .dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-topbar-history');
    const emptyState = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('no matching agents'),
    );
    assert(emptyState instanceof HTMLElement);
    assert.equal(emptyState.textContent?.trim(), 'no matching agents');
  } finally {
    agentBar.dispose();
  }
});

test('composer toolbar uses actionbar icon controls', () => {
  let askCount = 0;
  let selectedModelValue: string | null = null;
  let openedModelSettings = 0;
  const agentBar = createAgentChatWidget({
    ...createProps(),
    question: 'Explain this selection',
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { value: 'openai:gpt-5.4:medium', label: 'GPT-5.4 · medium' },
    ],
    onAsk: () => {
      askCount += 1;
    },
    onSelectLlmModel: (value) => {
      selectedModelValue = value;
    },
    onOpenModelSettings: () => {
      openedModelSettings += 1;
    },
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const toolButtons = Array.from(
      element.querySelectorAll(
        '.agentbar-composer-actions .agentbar-composer-tool-action',
      ),
    );
    assert.equal(toolButtons.length, 1);
    assert.deepEqual(
      toolButtons.map((button) => button.getAttribute('aria-label')),
      ['Image'],
    );

    const sendButton = element.querySelector(
      '.agentbar-composer-actions .agentbar-composer-send-action',
    );
    assert(sendButton instanceof HTMLButtonElement);
    assert.equal(sendButton.getAttribute('aria-label'), 'Send');
    assert.equal(sendButton.disabled, false);

    sendButton.click();
    assert.equal(askCount, 1);

    const dropdownButton = element.querySelector('.agentbar-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
    dropdownButton.click();

    const menu = document.body.querySelector('.actionbar-context-view .dropdown-menu[data-menu="agentbar-model-menu"]');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-model-menu');

    const autoMode = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Auto Max mode'),
    );
    assert(autoMode instanceof HTMLElement);
    assert.equal(autoMode.classList.contains('selected'), true);

    const option = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('GPT-5.4 · medium'),
    );
    assert(option instanceof HTMLElement);
    option.click();

    assert.equal(selectedModelValue, 'openai:gpt-5.4:medium');

    dropdownButton.click();
    const reopenedMenu = document.body.querySelector('.actionbar-context-view .dropdown-menu[data-menu="agentbar-model-menu"]');
    assert(reopenedMenu instanceof HTMLElement);
    const addModels = Array.from(
      reopenedMenu.querySelectorAll('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Add models'));
    assert(addModels instanceof HTMLElement);
    addModels.click();

    assert.equal(openedModelSettings, 1);
  } finally {
    agentBar.dispose();
  }
});

test('agent bar model menu supports search filtering', async () => {
  const agentBar = createAgentChatWidget({
    ...createProps(),
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { value: 'openai:gpt-5.4:medium', label: 'GPT-5.4 · medium' },
    ],
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const dropdownButton = element.querySelector('.agentbar-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
    dropdownButton.click();
    await delay(0);

    const menu = document.body.querySelector('.actionbar-context-view .dropdown-menu[data-menu="agentbar-model-menu"]');
    assert(menu instanceof HTMLElement);
    const searchInput = menu.querySelector('.ls-menu-header .agentbar-model-menu-search-input .input');
    assert(searchInput instanceof HTMLInputElement);

    searchInput.value = 'gpt';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(0);

    const menuItemLabels = Array.from(
      menu.querySelectorAll('.dropdown-menu-item .dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(menuItemLabels, ['GPT-5.4 · medium']);
  } finally {
    agentBar.dispose();
  }
});

test('horizontal scrollbar handles wheel events from the strip content', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb);

  try {
    scrollbar.renderNow();
    await delay(0);

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 48,
    });
    strip.dispatchEvent(event);

    assert.equal(strip.scrollLeft, 48);
    assert.equal(event.defaultPrevented, true);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});

test('horizontal scrollbar applies mouse wheel sensitivity', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb, {
    mouseWheelScrollSensitivity: 2,
  });

  try {
    scrollbar.renderNow();
    await delay(0);

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 24,
    });
    strip.dispatchEvent(event);

    assert.equal(strip.scrollLeft, 48);
    assert.equal(event.defaultPrevented, true);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});

test('horizontal scrollbar can avoid consuming mouse wheel events', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb, {
    consumeMouseWheelIfScrollbarIsNeeded: false,
  });

  try {
    scrollbar.renderNow();
    await delay(0);
    strip.scrollLeft = 200;

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 24,
    });
    strip.dispatchEvent(event);

    assert.equal(strip.scrollLeft, 200);
    assert.equal(event.defaultPrevented, false);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});

test('horizontal scrollbar can use smooth mouse wheel scrolling', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  let smoothScrollCall:
    | {
        left?: number;
        behavior?: string;
      }
    | null = null;
  strip.scrollTo = ((options: ScrollToOptions) => {
    smoothScrollCall = {
      left: options.left,
      behavior: options.behavior,
    };
    if (typeof options.left === 'number') {
      strip.scrollLeft = options.left;
    }
  }) as typeof strip.scrollTo;

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb, {
    mouseWheelSmoothScroll: true,
  });

  try {
    scrollbar.renderNow();
    await delay(0);

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 24,
    });
    strip.dispatchEvent(event);

    assert.deepEqual(smoothScrollCall, {
      left: 24,
      behavior: 'smooth',
    });
    assert.equal(event.defaultPrevented, true);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});

test('horizontal scrollbar converts vertical wheel to horizontal when shift is held', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb);

  try {
    scrollbar.renderNow();
    await delay(0);

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 24,
      shiftKey: true,
    });
    strip.dispatchEvent(event);

    assert.equal(strip.scrollLeft, 24);
    assert.equal(event.defaultPrevented, true);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});

test('horizontal scrollbar converts vertical wheel to horizontal when scrollYToX is enabled', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 320,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb, {
    scrollYToX: true,
  });

  try {
    scrollbar.renderNow();
    await delay(0);

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 24,
    });
    strip.dispatchEvent(event);

    assert.equal(strip.scrollLeft, 24);
    assert.equal(event.defaultPrevented, true);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});

test('horizontal scrollbar applies fast scroll sensitivity when alt is held', async () => {
  const host = document.createElement('div');
  const strip = document.createElement('div');
  const track = document.createElement('div');
  const thumb = document.createElement('div');
  host.append(strip, track);
  track.append(thumb);
  document.body.append(host);

  Object.defineProperty(strip, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(strip, 'scrollWidth', {
    configurable: true,
    value: 500,
  });
  Object.defineProperty(track, 'clientWidth', {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(track, 'clientHeight', {
    configurable: true,
    value: 4,
  });

  const scrollbar = new HorizontalScrollbar(host, strip, track, thumb, {
    fastScrollSensitivity: 4,
  });

  try {
    scrollbar.renderNow();
    await delay(0);

    const event = new window.WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 10,
      altKey: true,
      shiftKey: true,
    });
    strip.dispatchEvent(event);

    assert.equal(strip.scrollLeft, 40);
    assert.equal(event.defaultPrevented, true);
  } finally {
    scrollbar.dispose();
    host.remove();
  }
});
