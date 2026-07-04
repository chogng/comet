import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { HorizontalScrollbar } from 'cs/base/browser/ui/scrollbar/horizontalScrollbar';
import type { RagAnswerResult } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';

let cleanupDomEnvironment: (() => void) | null = null;
let createChatWidget: typeof import('cs/workbench/contrib/chat/browser/widget/chatWidget').createChatWidget;
let createChatViewPane: typeof import('cs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane').createChatViewPane;

function createProps(): ChatWidgetProps {
  return {
    isKnowledgeBaseModeEnabled: true,
    messages: [],
    question: '',
    onQuestionChange: () => {},
    isAsking: false,
    errorMessage: null,
    onAsk: () => {},
    onApplyPatch: () => {},
    articleQuickSources: [],
    isArticleSourceFetching: false,
    onFetchArticleSource: () => {},
    showArticleBatchActions: false,
    onDownloadAllArticles: () => {},
    onExportArticleSummaries: () => {},
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
    activeLlmModelLabel: 'GLM-4.7-Flash',
    isMaxContextWindowEnabled: false,
    activeLlmModelSupportsMaxContextWindow: false,
    onCreateConversation: () => {},
    onActivateConversation: () => {},
    onCloseConversation: () => {},
    onCloseAgentBar: () => {},
    onToggleAutoModelRouting: () => {},
    onSelectLlmModel: () => {},
    onToggleMaxContextWindow: () => {},
    onOpenModelSettings: () => {},
  };
}

function createResult(overrides: Partial<RagAnswerResult> = {}): RagAnswerResult {
  return {
    answer: 'Answer',
    evidence: [],
    provider: 'moark',
    llmProvider: 'glm',
    llmModel: 'test-model',
    embeddingModel: 'test-embedding',
    rerankerModel: 'test-reranker',
    rerankApplied: false,
    ...overrides,
  };
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createChatWidget } = await import('cs/workbench/contrib/chat/browser/widget/chatWidget'));
  ({ createChatViewPane } = await import('cs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('agent bar comet-hover-action buttons expose labels and shared hover', async () => {
  const agentBar = createChatWidget(createProps());
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.comet-sidebar-action-bar .comet-sidebar-action-btn'),
    );
    assert.equal(actionButtons.length, 3);
    assert.deepEqual(
      actionButtons.map((button) => button.getAttribute('aria-label')),
      ['New chat', 'History', 'More'],
    );

    const historyButton = actionButtons[1];
    assert(historyButton instanceof HTMLButtonElement);
    assert.equal(historyButton.getAttribute('aria-haspopup'), 'menu');

    document.dispatchEvent(
      new window.KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }),
    );
    historyButton.dispatchEvent(new Event('focus', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'History');
  } finally {
    agentBar.dispose();
  }
});

test('agent chat thread uses the shared scrollable transcript container', () => {
  const agentBar = createChatWidget({
    ...createProps(),
    messages: [
      { id: 'user-1', role: 'user', content: 'Explain this result' },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'The result is evidence-backed.',
        result: createResult(),
      },
    ],
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const threadWidget = element.querySelector('.comet-agentbar-thread-widget');
    assert(threadWidget instanceof HTMLElement);
    const scrollableRoot = threadWidget.querySelector(
      '.comet-scrollable-element-root.comet-agentbar-thread-scrollable',
    );
    assert(scrollableRoot instanceof HTMLElement);
    const thread = scrollableRoot.querySelector('.comet-agentbar-thread.comet-scrollable-content');
    assert(thread instanceof HTMLElement);
    assert.equal(thread.querySelectorAll('.comet-agentbar-message').length, 2);
  } finally {
    agentBar.dispose();
  }
});

test('agent chat thread follows new content only when scrolled to the comet-is-bottom', () => {
  const firstMessages: ChatWidgetProps['messages'] = [
    { id: 'user-1', role: 'user', content: 'First question' },
  ];
  const secondMessages: ChatWidgetProps['messages'] = [
    ...firstMessages,
    {
      id: 'assistant-1',
      role: 'assistant',
      content: 'First answer',
      result: createResult(),
    },
  ];
  const agentBar = createChatWidget({
    ...createProps(),
    messages: firstMessages,
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const thread = element.querySelector('.comet-agentbar-thread');
    assert(thread instanceof HTMLElement);
    Object.defineProperty(thread, 'clientHeight', {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(thread, 'scrollHeight', {
      configurable: true,
      get: () => thread.childElementCount > firstMessages.length ? 420 : 300,
    });
    Object.defineProperty(thread, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 200,
    });

    agentBar.setProps({
      ...createProps(),
      messages: secondMessages,
    });

    assert.equal(thread.scrollTop, 320);

    thread.scrollTop = 20;
    agentBar.setProps({
      ...createProps(),
      messages: [
        ...secondMessages,
        { id: 'user-2', role: 'user', content: 'Second question' },
      ],
    });

    assert.equal(thread.scrollTop, 20);
    assert.equal(
      element.querySelector('.comet-agentbar-thread-widget')?.classList.contains('comet-show-scroll-down'),
      true,
    );
  } finally {
    agentBar.dispose();
  }
});

function createHeaderActionsElement() {
  const host = document.createElement('div');
  host.className = 'comet-header-actions-host';
  const actionbar = document.createElement('div');
  actionbar.className = 'comet-header-actions comet-actionbar comet-is-horizontal';
  const actions = document.createElement('div');
  actions.className = 'comet-actionbar-actions-container';
  const button = document.createElement('button');
  button.className = 'comet-actionbar-action comet-titlebar-primary-sidebar-toggle-btn';
  button.setAttribute('aria-label', 'Header comet-hover-action');
  actions.append(button);
  actionbar.append(actions);
  host.append(actionbar);
  return host;
}

test('agent bar header mounts the provided leading comet-hover-actions element', () => {
  let toggleCount = 0;
  const headerActionsElement = createHeaderActionsElement();
  headerActionsElement
    .querySelector('.comet-titlebar-primary-sidebar-toggle-btn')
    ?.addEventListener('click', () => {
      toggleCount += 1;
  });
  const agentBar = createChatViewPane({
    ...createProps(),
    isPrimarySidebarVisible: false,
    headerActionsElement,
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const toggleButton = element.querySelector(
      '.comet-agentbar-header .comet-titlebar-primary-sidebar-toggle-btn',
    );
    assert(toggleButton instanceof HTMLButtonElement);
    assert.equal(toggleButton.getAttribute('aria-label'), 'Header comet-hover-action');

    toggleButton.click();
    assert.equal(toggleCount, 1);
  } finally {
    agentBar.dispose();
  }
});

test('agent bar more comet-hover-action uses dropdown comet-hover-action view item', async () => {
  let createConversationCount = 0;
  const agentBar = createChatWidget({
    ...createProps(),
    onCreateConversation: () => {
      createConversationCount += 1;
    },
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.comet-sidebar-action-bar .comet-sidebar-action-btn'),
    );
    const moreButton = actionButtons[2];
    assert(moreButton instanceof HTMLButtonElement);

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-header-more');
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

test('agent bar history comet-hover-action supports search and empty states', async () => {
  let activatedConversationId = '';
  const agentBar = createChatWidget({
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
      element.querySelectorAll('.comet-sidebar-action-bar .comet-sidebar-action-btn'),
    );
    const historyButton = actionButtons[1];
    assert(historyButton instanceof HTMLButtonElement);

    historyButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-header-history');
    assert.equal(historyButton.getAttribute('aria-expanded'), 'true');
    const searchInput = menu.querySelector('.cs-menu-header .comet-agentbar-history-search-input .comet-input');
    assert(searchInput instanceof HTMLInputElement);
    assert.equal(menu.firstElementChild?.classList.contains('cs-menu-header'), true);

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
    const reopenedMenu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu');
    assert(reopenedMenu instanceof HTMLElement);
    const reopenedSearchInput = reopenedMenu.querySelector(
      '.cs-menu-header .comet-agentbar-history-search-input .comet-input',
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

test('agent bar history comet-hover-action shows no matching agents when there is no history', async () => {
  const agentBar = createChatWidget({
    ...createProps(),
    conversations: [],
    activeConversationId: '',
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const actionButtons = Array.from(
      element.querySelectorAll('.comet-sidebar-action-bar .comet-sidebar-action-btn'),
    );
    const historyButton = actionButtons[1];
    assert(historyButton instanceof HTMLButtonElement);

    historyButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'agentbar-header-history');
    const emptyState = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('no matching agents'),
    );
    assert(emptyState instanceof HTMLElement);
    assert.equal(emptyState.textContent?.trim(), 'no matching agents');
  } finally {
    agentBar.dispose();
  }
});

test('composer toolbar uses comet-actionbar comet-hover-action-icon controls', () => {
  let askCount = 0;
  let autoModelRoutingToggleCount = 0;
  let selectedModelValue: string | null = null;
  let maxContextWindowToggleCount = 0;
  let openedModelSettings = 0;
  const agentBar = createChatWidget({
    ...createProps(),
    question: 'Explain this selection',
    activeLlmModelOptionValue: 'glm:glm-4.7-flash',
    activeLlmModelSupportsMaxContextWindow: true,
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { value: 'openai:gpt-5.4:medium', label: 'GPT-5.4 · medium' },
      { value: 'openai:gpt-5.4:medium:priority', label: 'GPT-5.4 · medium · fast' },
    ],
    onAsk: () => {
      askCount += 1;
    },
    onToggleAutoModelRouting: () => {
      autoModelRoutingToggleCount += 1;
    },
    onSelectLlmModel: (value) => {
      selectedModelValue = value;
    },
    onToggleMaxContextWindow: () => {
      maxContextWindowToggleCount += 1;
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
        '.comet-chat-composer-actions .comet-chat-composer-tool-action',
      ),
    );
    assert.equal(toolButtons.length, 1);
    assert.deepEqual(
      toolButtons.map((button) => button.getAttribute('aria-label')),
      ['Image'],
    );

    const sendButton = element.querySelector(
      '.comet-chat-composer-actions .comet-chat-composer-send-action',
    );
    assert(sendButton instanceof HTMLButtonElement);
    assert.equal(sendButton.getAttribute('aria-label'), 'Send');
    assert.equal(sendButton.disabled, false);

    sendButton.click();
    assert.equal(askCount, 1);

    const dropdownButton = element.querySelector('.comet-chat-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-label')?.textContent,
      'GLM-4.7-Flash',
    );
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-icon'),
      null,
    );
    dropdownButton.click();

    const menu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'chat-model-menu');

    const autoMode = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) =>
        node.querySelector('.dropdown-menu-item-content')?.textContent?.trim()
        === 'Auto',
    );
    assert(autoMode instanceof HTMLElement);
    assert.equal(autoMode.classList.contains('selected'), false);
    assert.equal(autoMode.querySelector('.lx-icon'), null);
    assert(autoMode.querySelector('.dropdown-menu-item-switch') instanceof HTMLElement);
    assert.equal(autoMode.querySelector('.dropdown-menu-item-description'), null);
    autoMode.click();
    assert.equal(autoModelRoutingToggleCount, 1);
    assert.equal(dropdownButton.getAttribute('aria-expanded'), 'true');
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-label')?.textContent,
      'Auto',
    );

    const autoMenu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(autoMenu instanceof HTMLElement);
    assert.deepEqual(
      Array.from(autoMenu.querySelectorAll('.dropdown-menu-item .dropdown-menu-item-content'))
        .map((node) => node.textContent?.trim()),
      ['Auto'],
    );

    const autoToggle = Array.from(autoMenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) =>
        node.querySelector('.dropdown-menu-item-content')?.textContent?.trim()
        === 'Auto',
    );
    assert(autoToggle instanceof HTMLElement);
    autoToggle.click();
    assert.equal(autoModelRoutingToggleCount, 2);

    const switchMenu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(switchMenu instanceof HTMLElement);
    assert.equal(dropdownButton.getAttribute('aria-expanded'), 'true');
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-label')?.textContent,
      'GLM-4.7-Flash',
    );

    const maxMode = Array.from(switchMenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) =>
        node.querySelector('.dropdown-menu-item-content')?.textContent?.trim()
        === 'Max mode',
    );
    assert(maxMode instanceof HTMLElement);
    assert.equal(maxMode.querySelector('.lx-icon'), null);
    assert(maxMode.querySelector('.dropdown-menu-item-switch') instanceof HTMLElement);
    maxMode.click();
    assert.equal(maxContextWindowToggleCount, 1);
    assert.equal(dropdownButton.getAttribute('aria-expanded'), 'true');

    const modelMenu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(modelMenu instanceof HTMLElement);
    const option = Array.from(modelMenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('GPT-5.4'),
    );
    assert(option instanceof HTMLElement);
    option.click();

    const submenu = document.body.querySelector('.comet-actionbar-context-view .cs-menu-submenu');
    assert(submenu instanceof HTMLElement);
    const useModel = Array.from(submenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Use model'),
    );
    assert(useModel instanceof HTMLElement);
    useModel.click();

    assert.equal(selectedModelValue, 'openai:gpt-5.4:medium');

    dropdownButton.click();
    const runtimeMenu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(runtimeMenu instanceof HTMLElement);
    const runtimeOption = Array.from(runtimeMenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('GPT-5.4'),
    );
    assert(runtimeOption instanceof HTMLElement);
    runtimeOption.click();
    const runtimeSubmenu = document.body.querySelector('.comet-actionbar-context-view .cs-menu-submenu');
    assert(runtimeSubmenu instanceof HTMLElement);
    const fastOn = Array.from(runtimeSubmenu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Fast: On'),
    );
    assert(fastOn instanceof HTMLElement);
    fastOn.click();

    assert.equal(selectedModelValue, 'openai:gpt-5.4:medium:priority');

    dropdownButton.click();
    const reopenedMenu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
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

test('composer article quick comet-hover-action opens source menu and runs selected source', async () => {
  let selectedSourceUrl = '';
  const agentBar = createChatWidget({
    ...createProps(),
    articleQuickSources: [
      {
        id: 'science',
        url: 'https://www.science.org/toc/science/current',
        journalTitle: 'Science',
        preferredExtractorId: 'science-current-news-in-depth-research-articles',
      },
    ],
    onFetchArticleSource: (source) => {
      selectedSourceUrl = source.url;
    },
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const quickButtons = Array.from(
      element.querySelectorAll('.comet-chat-composer-quick-action'),
    );
    assert.deepEqual(
      quickButtons.map((button) => button.textContent?.trim()),
      ['Write', 'Learn', 'Code', 'Article'],
    );

    const articleButton = quickButtons[3];
    assert(articleButton instanceof HTMLButtonElement);
    articleButton.click();
    await delay(0);

    const menu = element.querySelector('.comet-chat-composer-article-menu');
    assert(menu instanceof HTMLElement);
    const sourceButton = menu.querySelector('.comet-chat-composer-article-source');
    assert(sourceButton instanceof HTMLButtonElement);
    assert.equal(sourceButton.textContent, 'Science');
    sourceButton.click();

    assert.equal(selectedSourceUrl, 'https://www.science.org/toc/science/current');
    assert.equal(element.querySelector('.comet-chat-composer-article-menu'), null);
  } finally {
    agentBar.dispose();
  }
});

test('composer input toolbar hosts article batch actions', async () => {
  let downloadAllCount = 0;
  let exportSummariesCount = 0;
  const agentBar = createChatWidget({
    ...createProps(),
    showArticleBatchActions: true,
    onDownloadAllArticles: () => {
      downloadAllCount += 1;
    },
    onExportArticleSummaries: () => {
      exportSummariesCount += 1;
    },
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const quickButtons = Array.from(
      element.querySelectorAll('.comet-chat-composer-quick-action'),
    );
    assert.deepEqual(
      quickButtons.map((button) => button.textContent?.trim()),
      ['Write', 'Learn', 'Code', 'Article'],
    );
    const inputToolbar = element.querySelector('.comet-chat-composer-input-toolbar');
    const composer = element.querySelector('.comet-chat-composer');
    assert(inputToolbar instanceof HTMLElement);
    assert(composer instanceof HTMLElement);
    assert.equal(inputToolbar.nextElementSibling, composer);

    const inputToolbarButtons = Array.from(
      inputToolbar.querySelectorAll('.comet-chat-composer-input-toolbar-action'),
    );
    assert.deepEqual(
      inputToolbarButtons.map((button) => button.textContent?.trim()),
      ['下载全部', '翻译并导出摘要'],
    );
    assert.deepEqual(
      inputToolbarButtons.map((button) => button.classList.contains('comet-is-text')),
      [true, true],
    );

    const downloadAllButton = inputToolbarButtons[0];
    const exportSummariesButton = inputToolbarButtons[1];
    assert(downloadAllButton instanceof HTMLButtonElement);
    assert(exportSummariesButton instanceof HTMLButtonElement);
    downloadAllButton.click();
    exportSummariesButton.click();
    await delay(0);

    assert.equal(downloadAllCount, 1);
    assert.equal(exportSummariesCount, 1);
  } finally {
    agentBar.dispose();
  }
});

test('agent chat renders fetched article linked text and emits open link requests', async () => {
  let openedSourceUrl = '';
  const agentBar = createChatWidget({
    ...createProps(),
    messages: [
      {
        id: 'article-1',
        role: 'assistant',
        content: 'Science\n- [Example article](https://www.science.org/doi/example) - Science | 2026-07-03 | Research Article',
        includeInAgentHistory: false,
      },
    ],
  });
  agentBar.onDidRequestOpenLink(request => {
    openedSourceUrl = request.href;
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const markdown = element.querySelector('.comet-agentbar-answer > .rendered-markdown');
    assert(markdown instanceof HTMLElement);
    assert.equal(
      markdown.textContent?.replace(/\s+/g, ' ').trim(),
      'Science Example article - Science | 2026-07-03 | Research Article',
    );

    const link = markdown.querySelector('a[data-href]');
    assert(link instanceof HTMLElement);
    assert.equal(link.textContent, 'Example article');
    link.click();
    assert.equal(openedSourceUrl, 'https://www.science.org/doi/example');
  } finally {
    agentBar.dispose();
  }
});

test('agent bar model trigger and menu collapse to Auto while automatic routing is enabled', async () => {
  const agentBar = createChatWidget(createProps());
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const dropdownButton = element.querySelector('.comet-chat-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-label')?.textContent,
      'Auto',
    );

    dropdownButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(menu instanceof HTMLElement);

    const menuItemLabels = Array.from(
      menu.querySelectorAll('.dropdown-menu-item .dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(menuItemLabels, ['Auto']);

    const autoDescription = menu.querySelector('.dropdown-menu-item-description');
    assert(autoDescription instanceof HTMLElement);
    assert.equal(
      autoDescription.textContent,
      'Balanced quality and speed, recommended for most tasks',
    );
    assert(menu.querySelector('.dropdown-menu-item-switch.checked') instanceof HTMLElement);
  } finally {
    agentBar.dispose();
  }
});

test('agent bar model menu supports search filtering', async () => {
  const agentBar = createChatWidget({
    ...createProps(),
    activeLlmModelOptionValue: 'glm:glm-4.7-flash',
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { value: 'openai:gpt-5.4:medium', label: 'GPT-5.4 · medium' },
    ],
  });
  const element = agentBar.getElement();
  document.body.append(element);

  try {
    const dropdownButton = element.querySelector('.comet-chat-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
    dropdownButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-actionbar-context-view .dropdown-menu[data-menu="chat-model-menu"]');
    assert(menu instanceof HTMLElement);
    const searchInput = menu.querySelector('.cs-menu-header .comet-chat-model-menu-search-input .comet-input');
    assert(searchInput instanceof HTMLInputElement);

    searchInput.value = 'gpt';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(0);

    const menuItemLabels = Array.from(
      menu.querySelectorAll('.dropdown-menu-item .dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(menuItemLabels, ['GPT-5.4']);
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
