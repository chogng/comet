import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { HorizontalScrollbar as HorizontalScrollbarType } from 'cs/base/browser/ui/scrollbar/horizontalScrollbar';
import type { IRenderedMarkdown, MarkdownRenderOptions } from 'cs/base/browser/markdownRenderer';
import type { IMarkdownString } from 'cs/base/common/htmlContent';
import type { RagAnswerResult } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { ChatWidgetProps } from 'cs/workbench/contrib/chat/browser/chat';
import type { IMarkdownRendererService } from 'cs/platform/markdown/browser/markdownRenderer';

let cleanupDomEnvironment: (() => void) | null = null;
let ChatWidget: typeof import('cs/workbench/contrib/chat/browser/widget/chatWidget').ChatWidget;
let ChatViewPane: typeof import('cs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane').ChatViewPane;
let getWorkbenchInstantiationService: typeof import('cs/workbench/services/instantiation/browser/workbenchInstantiationService').getWorkbenchInstantiationService;
let registerWorkbenchService: typeof import('cs/workbench/services/instantiation/browser/workbenchInstantiationService').registerWorkbenchService;
let IMarkdownRendererServiceId: typeof import('cs/platform/markdown/browser/markdownRenderer').IMarkdownRendererService;
let HorizontalScrollbar: typeof HorizontalScrollbarType;
let renderMarkdown: typeof import('cs/base/browser/markdownRenderer').renderMarkdown;

function createMarkdownRendererService(
  onOpenLink: (href: string) => void = () => {},
): IMarkdownRendererService {
  return {
    _serviceBrand: undefined,
    render(
      markdown: IMarkdownString,
      options?: MarkdownRenderOptions,
      outElement?: HTMLElement,
    ): IRenderedMarkdown {
      const resolvedOptions = { ...options };
      if (!resolvedOptions.actionHandler) {
        resolvedOptions.actionHandler = href => onOpenLink(href);
      }
      const rendered = renderMarkdown(markdown, resolvedOptions, outElement);
      rendered.element.classList.add('rendered-markdown');
      return rendered;
    },
  };
}

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
    downloadAllProgress: null,
    translationExportProgress: null,
    onDownloadAllArticles: () => {},
    onExportArticleSummaries: () => {},
    isArticleSelected: () => false,
    onToggleArticleSelected: () => {},
    availableArticleCount: 1,
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
    ],
    activeLlmModelOptionValue: 'auto',
    activeLlmModelLabel: 'GLM-4.7-Flash',
    isMaxContextWindowEnabled: false,
    activeLlmModelSupportsMaxContextWindow: false,
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

function createChatWidget(
  props: ChatWidgetProps,
  markdownRendererService: IMarkdownRendererService = createMarkdownRendererService(),
) {
  registerWorkbenchService(IMarkdownRendererServiceId, markdownRendererService);
  return getWorkbenchInstantiationService().createInstance(ChatWidget, props);
}

function createChatViewPane(
  props: import('cs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane').ChatViewPaneProps,
) {
  return getWorkbenchInstantiationService().createInstance(ChatViewPane, props);
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  await import('cs/platform/contextview/browser/contextViewService');
  ({ IMarkdownRendererService: IMarkdownRendererServiceId } = await import('cs/platform/markdown/browser/markdownRenderer'));
  ({ getWorkbenchInstantiationService, registerWorkbenchService } = await import('cs/workbench/services/instantiation/browser/workbenchInstantiationService'));
  ({ HorizontalScrollbar } = await import('cs/base/browser/ui/scrollbar/horizontalScrollbar'));
  ({ renderMarkdown } = await import('cs/base/browser/markdownRenderer'));
  ({ ChatWidget } = await import('cs/workbench/contrib/chat/browser/widget/chatWidget'));
  ({ ChatViewPane } = await import('cs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('chat widget does not render chat tabs header actions', () => {
  const chatSurface = createChatWidget(createProps());
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    assert.equal(element.querySelector('.comet-chat-tabs-header'), null);
    assert.equal(
      element.querySelector('.comet-sidebar-action-bar .comet-sidebar-action-btn'),
      null,
    );
  } finally {
    chatSurface.dispose();
  }
});

test('chat thread uses the shared scrollable transcript container', () => {
  const chatSurface = createChatWidget({
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
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    const threadWidget = element.querySelector('.comet-chat-thread-widget');
    assert(threadWidget instanceof HTMLElement);
    const scrollableRoot = threadWidget.querySelector(
      '.comet-scrollable-element-root.comet-chat-thread-scrollable',
    );
    assert(scrollableRoot instanceof HTMLElement);
    const thread = scrollableRoot.querySelector('.comet-chat-thread.comet-scrollable-content');
    assert(thread instanceof HTMLElement);
    assert.equal(thread.querySelectorAll('.comet-chat-message').length, 2);
  } finally {
    chatSurface.dispose();
  }
});

test('session chat view uses compact layout for fetched article batches only', () => {
  const articleMessage: ChatWidgetProps['messages'][number] = {
    id: 'article-1',
    role: 'assistant',
    content: 'Science\n- [Example article](https://www.science.org/doi/example) - 2026-07-03 | Research Article',
    includeInAgentHistory: false,
  };
  const chatWidget = createChatWidget({
    ...createProps(),
    messages: [articleMessage],
  });
  const element = chatWidget.getElement();
  document.body.append(element);

  try {
    const articleBody = element.querySelector('.comet-session-chat-view-body');
    assert(articleBody instanceof HTMLElement);
    assert.equal(articleBody.classList.contains('comet-is-article-batch-state'), true);

    chatWidget.setProps({
      ...createProps(),
      messages: [
        articleMessage,
        { id: 'user-1', role: 'user', content: 'Summarize this.' },
      ],
    });

    const conversationBody = element.querySelector('.comet-session-chat-view-body');
    assert(conversationBody instanceof HTMLElement);
    assert.equal(conversationBody.classList.contains('comet-is-article-batch-state'), false);
  } finally {
    chatWidget.dispose();
  }
});

test('chat thread follows new content only when scrolled to the comet-is-bottom', () => {
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
  const chatSurface = createChatWidget({
    ...createProps(),
    messages: firstMessages,
  });
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    const thread = element.querySelector('.comet-chat-thread');
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

    chatSurface.setProps({
      ...createProps(),
      messages: secondMessages,
    });

    assert.equal(thread.scrollTop, 320);

    thread.scrollTop = 20;
    chatSurface.setProps({
      ...createProps(),
      messages: [
        ...secondMessages,
        { id: 'user-2', role: 'user', content: 'Second question' },
      ],
    });

    assert.equal(thread.scrollTop, 20);
    assert.equal(
      element.querySelector('.comet-chat-thread-widget')?.classList.contains('comet-show-scroll-down'),
      true,
    );
  } finally {
    chatSurface.dispose();
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

test('chat view pane header mounts the provided leading comet-hover-actions element', () => {
  let toggleCount = 0;
  const headerActionsElement = createHeaderActionsElement();
  headerActionsElement
    .querySelector('.comet-titlebar-primary-sidebar-toggle-btn')
    ?.addEventListener('click', () => {
      toggleCount += 1;
  });
  const chatSurface = createChatViewPane({
    ...createProps(),
    isPrimarySidebarVisible: false,
    headerActionsElement,
  });
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    const toggleButton = element.querySelector(
      '.comet-chat-header .comet-titlebar-primary-sidebar-toggle-btn',
    );
    assert(toggleButton instanceof HTMLButtonElement);
    assert.equal(toggleButton.getAttribute('aria-label'), 'Header comet-hover-action');

    toggleButton.click();
    assert.equal(toggleCount, 1);
  } finally {
    chatSurface.dispose();
  }
});

test('composer toolbar uses comet-actionbar comet-hover-action-icon controls', () => {
  let askCount = 0;
  let autoModelRoutingToggleCount = 0;
  let selectedModelValue: string | null = null;
  let maxContextWindowToggleCount = 0;
  let openedModelSettings = 0;
  const chatSurface = createChatWidget({
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
  const element = chatSurface.getElement();
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

    const menu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'chat-model-menu');

    const autoMode = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) =>
        node.querySelector('.comet-dropdown-menu-item-content')?.textContent?.trim()
        === 'Auto',
    );
    assert(autoMode instanceof HTMLElement);
    assert.equal(autoMode.classList.contains('selected'), false);
    assert.equal(autoMode.querySelector('.lx-icon'), null);
    assert(autoMode.querySelector('.comet-dropdown-menu-item-switch') instanceof HTMLElement);
    assert.equal(autoMode.querySelector('.comet-dropdown-menu-item-description'), null);
    autoMode.click();
    assert.equal(autoModelRoutingToggleCount, 1);
    assert.equal(dropdownButton.getAttribute('aria-expanded'), 'true');
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-label')?.textContent,
      'Auto',
    );

    const autoMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(autoMenu instanceof HTMLElement);
    assert.deepEqual(
      Array.from(autoMenu.querySelectorAll('.comet-dropdown-menu-item .comet-dropdown-menu-item-content'))
        .map((node) => node.textContent?.trim()),
      ['Auto'],
    );

    const autoToggle = Array.from(autoMenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) =>
        node.querySelector('.comet-dropdown-menu-item-content')?.textContent?.trim()
        === 'Auto',
    );
    assert(autoToggle instanceof HTMLElement);
    autoToggle.click();
    assert.equal(autoModelRoutingToggleCount, 2);

    const switchMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(switchMenu instanceof HTMLElement);
    assert.equal(dropdownButton.getAttribute('aria-expanded'), 'true');
    assert.equal(
      dropdownButton.querySelector('.comet-chat-model-switch-label')?.textContent,
      'GLM-4.7-Flash',
    );

    const maxMode = Array.from(switchMenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) =>
        node.querySelector('.comet-dropdown-menu-item-content')?.textContent?.trim()
        === 'Max mode',
    );
    assert(maxMode instanceof HTMLElement);
    assert.equal(maxMode.querySelector('.lx-icon'), null);
    assert(maxMode.querySelector('.comet-dropdown-menu-item-switch') instanceof HTMLElement);
    maxMode.click();
    assert.equal(maxContextWindowToggleCount, 1);
    assert.equal(dropdownButton.getAttribute('aria-expanded'), 'true');

    const modelMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(modelMenu instanceof HTMLElement);
    const option = Array.from(modelMenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('GPT-5.4'),
    );
    assert(option instanceof HTMLElement);
    option.click();

    const submenu = document.body.querySelector('.comet-menu-submenu');
    assert(submenu instanceof HTMLElement);
    const useModel = Array.from(submenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Use model'),
    );
    assert(useModel instanceof HTMLElement);
    useModel.click();

    assert.equal(selectedModelValue, 'openai:gpt-5.4:medium');

    dropdownButton.click();
    const runtimeMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(runtimeMenu instanceof HTMLElement);
    const runtimeOption = Array.from(runtimeMenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('GPT-5.4'),
    );
    assert(runtimeOption instanceof HTMLElement);
    runtimeOption.click();
    const runtimeSubmenu = document.body.querySelector('.comet-menu-submenu');
    assert(runtimeSubmenu instanceof HTMLElement);
    const fastOn = Array.from(runtimeSubmenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Fast: On'),
    );
    assert(fastOn instanceof HTMLElement);
    fastOn.click();

    assert.equal(selectedModelValue, 'openai:gpt-5.4:medium:priority');

    dropdownButton.click();
    const reopenedMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(reopenedMenu instanceof HTMLElement);
    const addModels = Array.from(
      reopenedMenu.querySelectorAll('.comet-dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Add models'));
    assert(addModels instanceof HTMLElement);
    addModels.click();

    assert.equal(openedModelSettings, 1);
  } finally {
    chatSurface.dispose();
  }
});

test('composer article quick comet-hover-action opens source menu and runs selected source', async () => {
  let selectedSourceUrl = '';
  const chatSurface = createChatWidget({
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
  const element = chatSurface.getElement();
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

    const contextView = document.body.querySelector('.comet-chat-composer-article-context-view');
    assert(contextView instanceof HTMLElement);
    const menu = contextView.querySelector('.comet-chat-composer-article-menu');
    assert(menu instanceof HTMLElement);
    const scrollableRoot = menu.querySelector(
      '.comet-scrollable-element-root.comet-chat-composer-article-source-scrollable',
    );
    assert(scrollableRoot instanceof HTMLElement);
    const list = scrollableRoot.querySelector(
      '.comet-chat-composer-article-source-list.comet-scrollable-content',
    );
    assert(list instanceof HTMLElement);
    const sourceButton = list.querySelector('.comet-chat-composer-article-source');
    assert(sourceButton instanceof HTMLButtonElement);
    assert.equal(sourceButton.textContent, 'Science');
    sourceButton.click();

    assert.equal(selectedSourceUrl, 'https://www.science.org/toc/science/current');
    assert.equal(document.body.querySelector('.comet-chat-composer-article-menu'), null);
  } finally {
    chatSurface.dispose();
  }
});

test('composer article quick menu is disposed with the chat widget', async () => {
  const chatSurface = createChatWidget({
    ...createProps(),
    articleQuickSources: [
      {
        id: 'science',
        url: 'https://www.science.org/toc/science/current',
        journalTitle: 'Science',
        preferredExtractorId: 'science-current-news-in-depth-research-articles',
      },
    ],
  });
  const element = chatSurface.getElement();
  document.body.append(element);

  const articleButton = Array.from(
    element.querySelectorAll('.comet-chat-composer-quick-action'),
  )[3];
  assert(articleButton instanceof HTMLButtonElement);
  articleButton.click();
  await delay(0);

  assert(document.body.querySelector('.comet-chat-composer-article-menu') instanceof HTMLElement);
  chatSurface.dispose();
  assert.equal(document.body.querySelector('.comet-chat-composer-article-menu'), null);
});

test('composer input toolbar hosts article batch actions', async () => {
  let downloadAllCount = 0;
  const exportSummaryChoices: boolean[] = [];
  const chatSurface = createChatWidget({
    ...createProps(),
    showArticleBatchActions: true,
    onDownloadAllArticles: () => {
      downloadAllCount += 1;
    },
    onExportArticleSummaries: (translateSummaries) => {
      exportSummaryChoices.push(translateSummaries);
    },
  });
  const element = chatSurface.getElement();
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
    assert.equal(inputToolbarButtons[0].textContent?.trim(), '下载全部');
    assert.equal(inputToolbarButtons[1].textContent?.trim(), '导出摘要');
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
    const menu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-article-summary-export"]');
    assert(menu instanceof HTMLElement);
    assert.equal(exportSummariesButton.getAttribute('aria-expanded'), 'true');
    const originalExportItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('直接导出摘要'),
    );
    assert(originalExportItem instanceof HTMLElement);
    originalExportItem.click();
    await delay(0);

    exportSummariesButton.click();
    await delay(0);
    const reopenedMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-article-summary-export"]');
    assert(reopenedMenu instanceof HTMLElement);
    const translatedExportItem = Array.from(reopenedMenu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('翻译并导出摘要'),
    );
    assert(translatedExportItem instanceof HTMLElement);
    translatedExportItem.click();
    await delay(0);

    assert.deepEqual(exportSummaryChoices, [false, true]);
  } finally {
    chatSurface.dispose();
  }
});

test('composer input toolbar renders inline article batch progress', async () => {
  let downloadAllCount = 0;
  const exportSummaryChoices: boolean[] = [];
  const chatSurface = createChatWidget({
    ...createProps(),
    showArticleBatchActions: true,
    downloadAllProgress: { phase: 'running', current: 1, total: 3 },
    translationExportProgress: { phase: 'running', current: 2, total: 5 },
    onDownloadAllArticles: () => {
      downloadAllCount += 1;
    },
    onExportArticleSummaries: (translateSummaries) => {
      exportSummaryChoices.push(translateSummaries);
    },
  });
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    const inputToolbarButtons = Array.from(
      element.querySelectorAll('.comet-chat-composer-input-toolbar-action'),
    );
    assert.equal(inputToolbarButtons.length, 2);
    assert.equal(inputToolbarButtons[0].textContent?.trim(), '1/3');
    assert.equal(inputToolbarButtons[1].textContent?.trim(), '2/5');
    assert.equal(
      inputToolbarButtons[0]
        .querySelector('.comet-chat-composer-input-toolbar-action-progress-fill')
        ?.getAttribute('style'),
      'width: 33%;',
    );
    assert.equal(
      inputToolbarButtons[1]
        .querySelector('.comet-chat-composer-input-toolbar-action-progress-fill')
        ?.getAttribute('style'),
      'width: 40%;',
    );

    const downloadAllButton = inputToolbarButtons[0];
    const exportSummariesButton = inputToolbarButtons[1];
    assert(downloadAllButton instanceof HTMLButtonElement);
    assert(exportSummariesButton instanceof HTMLButtonElement);
    downloadAllButton.click();
    exportSummariesButton.click();
    await delay(0);

    assert.equal(downloadAllCount, 1);
    assert.deepEqual(exportSummaryChoices, [true]);
  } finally {
    chatSurface.dispose();
  }
});

test('chat renders fetched article linked text and opens links through markdown renderer service', async () => {
  let openedSourceUrl = '';
  let toggledSourceUrl = '';
  const chatSurface = createChatWidget(
    {
      ...createProps(),
      messages: [
        {
          id: 'article-1',
          role: 'assistant',
          content: 'Science\n- [Example article](https://www.science.org/doi/example) - 2026-07-03 | Research Article',
          includeInAgentHistory: false,
        },
      ],
      isArticleSelected: href => href === 'https://www.science.org/doi/example',
      onToggleArticleSelected: href => {
        toggledSourceUrl = href;
      },
    },
    createMarkdownRendererService(href => {
      openedSourceUrl = href;
    }),
  );
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    const markdown = element.querySelector('.comet-chat-answer > .rendered-markdown');
    assert(markdown instanceof HTMLElement);
    assert.equal(
      markdown.textContent?.replace(/\s+/g, ' ').trim(),
      'Science Example article - 2026-07-03 | Research Article',
    );

    const link = markdown.querySelector('a[data-href]');
    assert(link instanceof HTMLElement);
    assert.equal(link.textContent, 'Example article');
    const checkbox = markdown.querySelector('.comet-chat-article-checkbox');
    assert(checkbox instanceof HTMLElement);
    assert.equal(checkbox.getAttribute('role'), 'checkbox');
    assert.equal(checkbox.getAttribute('aria-checked'), 'true');
    checkbox.click();
    assert.equal(toggledSourceUrl, 'https://www.science.org/doi/example');
    link.click();
    assert.equal(openedSourceUrl, 'https://www.science.org/doi/example');
  } finally {
    chatSurface.dispose();
  }
});

test('chat view pane model trigger and menu collapse to Auto while automatic routing is enabled', async () => {
  const chatSurface = createChatWidget(createProps());
  const element = chatSurface.getElement();
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

    const menu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(menu instanceof HTMLElement);

    const menuItemLabels = Array.from(
      menu.querySelectorAll('.comet-dropdown-menu-item .comet-dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(menuItemLabels, ['Auto']);

    const autoDescription = menu.querySelector('.comet-dropdown-menu-item-description');
    assert(autoDescription instanceof HTMLElement);
    assert.equal(
      autoDescription.textContent,
      'Balanced quality and speed, recommended for most tasks',
    );
    assert(menu.querySelector('.comet-dropdown-menu-item-switch.checked') instanceof HTMLElement);
  } finally {
    chatSurface.dispose();
  }
});

test('chat view pane model menu supports search filtering', async () => {
  const chatSurface = createChatWidget({
    ...createProps(),
    activeLlmModelOptionValue: 'glm:glm-4.7-flash',
    llmModelOptions: [
      { value: 'auto', label: 'Auto' },
      { value: 'glm:glm-4.7-flash', label: 'GLM-4.7-Flash' },
      { value: 'openai:gpt-5.4:medium', label: 'GPT-5.4 · medium' },
    ],
  });
  const element = chatSurface.getElement();
  document.body.append(element);

  try {
    const dropdownButton = element.querySelector('.comet-chat-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
    dropdownButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-model-menu"]');
    assert(menu instanceof HTMLElement);
    const searchInput = menu.querySelector('.comet-menu-header .comet-chat-model-menu-search-input .comet-input');
    assert(searchInput instanceof HTMLInputElement);

    searchInput.value = 'gpt';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(0);

    const menuItemLabels = Array.from(
      menu.querySelectorAll('.comet-dropdown-menu-item .comet-dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(menuItemLabels, ['GPT-5.4']);
  } finally {
    chatSurface.dispose();
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
