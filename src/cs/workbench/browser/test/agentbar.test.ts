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
import { toDisposable } from 'cs/base/common/lifecycle';
import type { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import type { IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import type { INotificationService } from 'cs/platform/notification/common/notification';

let cleanupDomEnvironment: (() => void) | null = null;
let ChatWidget: typeof import('cs/workbench/contrib/chat/browser/widget/chatWidget').ChatWidget;
let ChatViewPane: typeof import('cs/workbench/contrib/chat/browser/widgetHosts/viewPane/chatViewPane').ChatViewPane;
let getWorkbenchInstantiationService: typeof import('cs/workbench/services/instantiation/browser/workbenchInstantiationService').getWorkbenchInstantiationService;
let registerWorkbenchService: typeof import('cs/workbench/services/instantiation/browser/workbenchInstantiationService').registerWorkbenchService;
let IMarkdownRendererServiceId: typeof import('cs/platform/markdown/browser/markdownRenderer').IMarkdownRendererService;
let IChatServiceId: typeof import('cs/workbench/contrib/chat/common/chatService/chatService').IChatService;
let IFetchServiceId: typeof import('cs/workbench/services/fetch/common/fetch').IFetchService;
let INotificationServiceId: typeof import('cs/platform/notification/common/notification').INotificationService;
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

function registerChatTestServices() {
	registerWorkbenchService(IChatServiceId, {
		_serviceBrand: undefined,
		subscribe: () => toDisposable(() => {}),
		getSnapshot: () => ({
			conversations: [],
			activeConversationId: '',
			checkedArticleIds: [],
			activeConversation: null,
			question: '',
			messages: [],
			result: null,
			isAsking: false,
			errorMessage: null,
		}),
		setContext() {},
		setQuestion() {},
		createConversation: () => '',
		activateConversation() {},
		closeConversation() {},
		insertContextMessage() {},
		insertArticleList() {},
		insertArticleFetchEmptyResult() {},
		applyPatch() {},
		ask: async () => {},
		isArticleChecked: () => false,
		setArticleChecked() {},
		removeArticleChecks() {},
	} as unknown as IChatService);
	registerWorkbenchService(IFetchServiceId, {
		_serviceBrand: undefined,
		onDidChangeCatalog: () => toDisposable(() => {}),
		onDidChangeSource: () => toDisposable(() => {}),
		onDidChangeArticle: () => toDisposable(() => {}),
		getJournals: () => [],
		getJournal: () => undefined,
		getArticleListCatalog: () => undefined,
		getArticlePage: () => undefined,
		getArticlePages: () => [],
		getArticleListItem: () => undefined,
		getArticle: () => undefined,
		getArticleDetail: () => undefined,
		getCatalogLoadState: () => ({ status: 'idle' as const }),
		getSourceLoadState: () => ({ status: 'idle' as const }),
		getArticleLoadState: () => ({ status: 'idle' as const }),
		discoverArticleListSources: async () => {},
		fetchArticleListSource: async () => {},
		fetchNextPage: async () => {},
		fetchArticle: async () => { throw new Error('No article is available in this test.'); },
		refreshJournal: async () => {},
		refreshArticleListSource: async () => {},
	} as unknown as IFetchService);
	registerWorkbenchService(INotificationServiceId, {
		_serviceBrand: undefined,
		info() {},
		warn() {},
		error() {},
		prompt() { return { onDidClose: () => ({ dispose() {} }), close() {}, updateSeverity() {} }; },
		status() { return { dispose() {} }; },
		getNotifications: () => [],
		onDidAddNotification: () => ({ dispose() {} }),
		onDidRemoveNotification: () => ({ dispose() {} }),
		onDidChangeNotification: () => ({ dispose() {} }),
	} as unknown as INotificationService);
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  await import('cs/platform/contextview/browser/contextViewService');
  ({ IMarkdownRendererService: IMarkdownRendererServiceId } = await import('cs/platform/markdown/browser/markdownRenderer'));
  ({ IChatService: IChatServiceId } = await import('cs/workbench/contrib/chat/common/chatService/chatService'));
  ({ IFetchService: IFetchServiceId } = await import('cs/workbench/services/fetch/common/fetch'));
  ({ INotificationService: INotificationServiceId } = await import('cs/platform/notification/common/notification'));
  ({ getWorkbenchInstantiationService, registerWorkbenchService } = await import('cs/workbench/services/instantiation/browser/workbenchInstantiationService'));
	registerChatTestServices();
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

test('composer toolbar uses comet-actionbar comet-hover-action-icon controls', async () => {
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
      return autoModelRoutingToggleCount % 2 === 1 ? 'auto' : 'glm:glm-4.7-flash';
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
    const composerActions = Array.from(
      element.querySelectorAll(
        '.comet-chat-composer-actions .comet-actionbar-action',
      ),
    );
    assert.equal(composerActions.length, 1);
    assert.equal(
      composerActions.some(button => button.getAttribute('aria-label') === 'Image'),
      false,
    );

    const sendButton = element.querySelector(
      '.comet-chat-composer-actions .comet-chat-composer-send-action',
    );
    assert(sendButton instanceof HTMLButtonElement);
    assert.equal(sendButton.getAttribute('aria-label'), 'Send');
    assert.equal(sendButton.disabled, false);
    assert(sendButton.querySelector('.lx-icon-mic') instanceof HTMLElement);

    sendButton.click();
    assert.equal(askCount, 1);

    const dropdownButton = element.querySelector('.comet-chat-model-switch-btn');
    assert(dropdownButton instanceof HTMLButtonElement);
		const modelPickerContainer = dropdownButton.parentElement;
		const composerTools = modelPickerContainer?.parentElement;
		const composerToolbar = composerTools?.parentElement;
		assert(modelPickerContainer instanceof HTMLDivElement);
		assert(composerTools instanceof HTMLDivElement);
		assert(composerToolbar instanceof HTMLDivElement);
		assert.equal(modelPickerContainer.classList.contains('comet-chat-model-switch'), true);
		assert.equal(composerTools.classList.contains('comet-chat-composer-tools'), true);
		assert.equal(
			composerTools.firstElementChild?.classList.contains('comet-chat-composer-add-menu-actions'),
			true,
		);
		assert.equal(composerTools.lastElementChild, modelPickerContainer);
		assert.equal(composerToolbar.classList.contains('comet-chat-composer-toolbar'), true);

		const addButton = element.querySelector('.comet-chat-add-menu-btn');
		assert(addButton instanceof HTMLButtonElement);
		addButton.click();
		const addMenu = document.body.querySelector('.comet-dropdown-menu[data-menu="chat-add-menu"]');
		assert(addMenu instanceof HTMLElement);
		assert.deepEqual(
			Array.from(addMenu.querySelectorAll('.comet-dropdown-menu-item .comet-dropdown-menu-item-content'))
				.map(node => node.textContent?.trim()),
			['Agents', 'Image', 'Skills', 'MCP', 'Plugins'],
		);
		addButton.click();
		await delay(0);
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
    dropdownButton.click();
    await delay(0);
    dropdownButton.click();
    await delay(0);

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
    dropdownButton.click();
    await delay(0);
    dropdownButton.click();
    await delay(0);

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
