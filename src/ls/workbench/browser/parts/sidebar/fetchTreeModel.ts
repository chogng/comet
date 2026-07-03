import type { SidebarArticle } from 'ls/workbench/browser/parts/sidebar/fetchPanePart';

export type FetchTreeLabels = {
  fetchTitle: string;
  fetchLatestBusy: string;
  fetchLatest: string;
  selectionModeEnterMulti: string;
  selectionModeSelectAll: string;
  selectionModeExit: string;
  untitled: string;
  unknown: string;
};

export type FetchTreeFolderNode = {
  kind: 'folder';
  id: string;
  name: string;
  articles: SidebarArticle[];
};

export type FetchTreeArticleNode = {
  kind: 'article';
  id: string;
  article: SidebarArticle;
};

export type FetchTreeRootNode = {
  kind: 'root';
  id: 'root';
  name: string;
  folders: FetchTreeFolderNode[];
};

export type FetchTreeNode =
  | FetchTreeRootNode
  | FetchTreeFolderNode
  | FetchTreeArticleNode;

export type FetchTreeInput = {
  articles: SidebarArticle[];
  labels: FetchTreeLabels;
};

function normalizeLabel(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function createStableId(value: string) {
  const normalized = value.trim().toLocaleLowerCase();
  return normalized
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'unknown';
}

function resolveArticleGroupName(
  article: SidebarArticle,
  labels: FetchTreeLabels,
) {
  return (
    normalizeLabel(article.journalTitle) ||
    normalizeLabel(article.sourceId) ||
    resolveHostname(article.sourceUrl) ||
    labels.unknown
  );
}

function resolveHostname(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function getArticleNodeId(article: SidebarArticle, index: number) {
  return [
    'article',
    createStableId(article.sourceId ?? ''),
    createStableId(article.sourceUrl),
    createStableId(article.fetchedAt),
    String(index),
  ].join('/');
}

export function buildFetchTree(input: FetchTreeInput): FetchTreeRootNode {
  const root: FetchTreeRootNode = {
    kind: 'root',
    id: 'root',
    name: input.labels.fetchTitle,
    folders: [],
  };
  const foldersByName = new Map<string, FetchTreeFolderNode>();

  input.articles.forEach((article) => {
    const groupName = resolveArticleGroupName(article, input.labels);
    let folder = foldersByName.get(groupName);
    if (!folder) {
      folder = {
        kind: 'folder',
        id: `source/${createStableId(groupName)}`,
        name: groupName,
        articles: [],
      };
      foldersByName.set(groupName, folder);
      root.folders.push(folder);
    }

    folder.articles.push(article);
  });

  return root;
}

export function getFetchTreeNodeLabel(
  node: FetchTreeNode,
  labels: FetchTreeLabels,
) {
  if (node.kind !== 'article') {
    return node.name;
  }

  return normalizeLabel(node.article.title) || labels.untitled;
}

export class FetchTreeDataSource {
  getRoot(input: FetchTreeInput) {
    return buildFetchTree(input);
  }

  hasChildren(node: FetchTreeNode) {
    return (
      (node.kind === 'root' && node.folders.length > 0) ||
      (node.kind === 'folder' && node.articles.length > 0)
    );
  }

  getChildren(node: FetchTreeNode): FetchTreeNode[] {
    if (node.kind === 'root') {
      return node.folders;
    }

    if (node.kind === 'folder') {
      return node.articles.map((article, index) => ({
        kind: 'article',
        id: getArticleNodeId(article, index),
        article,
      }));
    }

    return [];
  }
}
