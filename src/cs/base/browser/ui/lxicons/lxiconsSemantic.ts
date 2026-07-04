import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';

export const lxIconSemanticMap = {
  titlebar: {
    primarySidebarOpen: 'projects-filled',
    primarySidebarClosed: 'projects',
    agentSidebarOpen: 'agent-filled',
    agentSidebarClosed: 'agent',
    navigateBack: 'arrow-left',
    navigateForward: 'arrow-right',
    refresh: 'refresh',
    exportDocx: 'docx',
    settings: 'gear',
  },
  assistant: {
    closeConversation: 'close',
    newConversation: 'add',
    history: 'history',
    more: 'more',
    secondarySidebarOpen: 'layout-sidebar-right',
    secondarySidebarClosed: 'layout-sidebar-right-off',
    voice: 'mic',
    image: 'image',
    send: 'enter',
    busy: 'sync',
  },
  articleCard: {
    download: 'download',
    downloaded: 'check',
    details: 'chevron-down',
  },
  sidebar: {
    selectionMode: 'select-all',
  },
  fetch: {
    batchDownload: 'batch-download',
  },
  editor: {
    closeTab: 'close',
    pdfPagination: 'spilt-page',
    pdfHighlight: 'edit',
    pdfTranslate: 'translate',
    pdfErase: 'erasure',
    pdfNote: 'note',
  },
  settings: {
    moveUp: 'arrow-up',
    moveDown: 'arrow-down',
    decrement: 'remove-1',
    increment: 'add-1',
    removeBatchSource: 'close',
    chooseDirectory: 'projects',
    changeConfigLocation: 'link-external',
    calendar: 'calendar',
  },
  library: {
    refresh: 'projects',
    downloadPdf: 'download-2',
    createDraft: 'draft',
    folderExpanded: 'chevron-down',
    folderCollapsed: 'chevron-right',
  },
  windowControls: {
    close: 'close',
  },
} as const satisfies Record<string, Record<string, LxIconName>>;
