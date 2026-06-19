import { reset } from 'base/browser/dom';

export type TrustedHTML = string & { readonly __trustedHtmlBrand: unique symbol };

export const basicMarkupHtmlTags = Object.freeze([
  'a',
  'abbr',
  'b',
  'bdo',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'label',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'source',
  'span',
  'strike',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'tt',
  'u',
  'ul',
  'var',
  'video',
  'wbr',
]);

export const defaultAllowedAttrs = Object.freeze([
  'href',
  'target',
  'src',
  'alt',
  'title',
  'for',
  'name',
  'role',
  'tabindex',
  'x-dispatch',
  'required',
  'checked',
  'placeholder',
  'type',
  'start',
  'width',
  'height',
  'align',
]);

export type SanitizeAttributePredicate = (
  node: Element,
  data: { readonly attrName: string; readonly attrValue: string },
) => boolean | string;

export interface SanitizeAttributeRule {
  readonly attributeName: string;
  shouldKeep: SanitizeAttributePredicate;
}

export interface DomSanitizerConfig {
  readonly allowedTags?: {
    readonly override?: readonly string[];
    readonly augment?: readonly string[];
  };
  readonly allowedAttributes?: {
    readonly override?: ReadonlyArray<string | SanitizeAttributeRule>;
    readonly augment?: ReadonlyArray<string | SanitizeAttributeRule>;
  };
  readonly allowedLinkProtocols?: {
    readonly override?: readonly string[] | '*';
  };
  readonly allowRelativeLinkPaths?: boolean;
  readonly allowedMediaProtocols?: {
    readonly override?: readonly string[] | '*';
  };
  readonly allowRelativeMediaPaths?: boolean;
  readonly replaceWithPlaintext?: boolean;
}

type ResolvedSanitizerConfig = {
  allowedTags: ReadonlySet<string>;
  allowedAttrNames: ReadonlySet<string>;
  allowedAttrPredicates: ReadonlyMap<string, SanitizeAttributeRule>;
  allowedLinkProtocols: readonly string[] | '*';
  allowRelativeLinkPaths: boolean;
  allowedMediaProtocols: readonly string[] | '*';
  allowRelativeMediaPaths: boolean;
  replaceWithPlaintext: boolean;
};

const defaultLinkProtocols = Object.freeze(['http', 'https']);
const defaultMediaProtocols = Object.freeze(['http', 'https']);
const fakeRelativeUrlProtocol = 'ls-relative-path';
const removedWithChildrenTags = new Set(['script', 'style', 'iframe', 'object', 'embed']);
const selfClosingTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'command',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export function sanitizeHtml(untrusted: string, config?: DomSanitizerConfig): TrustedHTML {
  const fragment = sanitizeHtmlToFragment(untrusted, config);
  const container = document.createElement('div');
  container.append(fragment);
  return container.innerHTML as unknown as TrustedHTML;
}

export function safeSetInnerHtml(
  node: HTMLElement,
  untrusted: string,
  config?: DomSanitizerConfig,
): void {
  reset(node, sanitizeHtmlToFragment(untrusted, config));
}

function sanitizeHtmlToFragment(untrusted: string, config?: DomSanitizerConfig): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = untrusted;
  return sanitizeChildren(template.content, resolveConfig(config));
}

function resolveConfig(config?: DomSanitizerConfig): ResolvedSanitizerConfig {
  let allowedTags = [...basicMarkupHtmlTags];
  if (config?.allowedTags?.override) {
    allowedTags = [...config.allowedTags.override];
  }
  if (config?.allowedTags?.augment) {
    allowedTags.push(...config.allowedTags.augment);
  }

  let resolvedAttributes: Array<string | SanitizeAttributeRule> = [...defaultAllowedAttrs];
  if (config?.allowedAttributes?.override) {
    resolvedAttributes = [...config.allowedAttributes.override];
  }
  if (config?.allowedAttributes?.augment) {
    resolvedAttributes.push(...config.allowedAttributes.augment);
  }

  resolvedAttributes = resolvedAttributes.map((attr) => {
    if (typeof attr === 'string') {
      return attr.toLowerCase();
    }
    return {
      attributeName: attr.attributeName.toLowerCase(),
      shouldKeep: attr.shouldKeep,
    };
  });

  const allowedAttrNames = new Set(
    resolvedAttributes.map((attr) => (typeof attr === 'string' ? attr : attr.attributeName)),
  );
  const allowedAttrPredicates = new Map<string, SanitizeAttributeRule>();
  for (const attr of resolvedAttributes) {
    if (typeof attr === 'string') {
      allowedAttrPredicates.delete(attr);
    } else {
      allowedAttrPredicates.set(attr.attributeName, attr);
    }
  }

  return {
    allowedTags: new Set(allowedTags.map((tag) => tag.toLowerCase())),
    allowedAttrNames,
    allowedAttrPredicates,
    allowedLinkProtocols: config?.allowedLinkProtocols?.override ?? defaultLinkProtocols,
    allowRelativeLinkPaths: config?.allowRelativeLinkPaths ?? false,
    allowedMediaProtocols: config?.allowedMediaProtocols?.override ?? defaultMediaProtocols,
    allowRelativeMediaPaths: config?.allowRelativeMediaPaths ?? false,
    replaceWithPlaintext: config?.replaceWithPlaintext ?? false,
  };
}

function sanitizeChildren(parent: Node, config: ResolvedSanitizerConfig): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const child of Array.from(parent.childNodes)) {
    const sanitized = sanitizeNode(child, config);
    if (sanitized) {
      fragment.append(sanitized);
    }
  }
  return fragment;
}

function sanitizeNode(node: Node, config: ResolvedSanitizerConfig): Node | DocumentFragment | undefined {
  if (node.nodeType === Node.TEXT_NODE) {
    return document.createTextNode(node.textContent ?? '');
  }

  if (node.nodeType === Node.COMMENT_NODE) {
    return config.replaceWithPlaintext ? document.createTextNode(`<!--${node.textContent ?? ''}-->`) : undefined;
  }

  if (!(node instanceof Element)) {
    return undefined;
  }

  const tagName = node.tagName.toLowerCase();
  if (!config.allowedTags.has(tagName)) {
    if (config.replaceWithPlaintext) {
      return convertTagToPlaintext(node, config);
    }
    return removedWithChildrenTags.has(tagName) ? undefined : sanitizeChildren(node, config);
  }

  const element = document.createElement(tagName);
  sanitizeAttributes(node, element, config);
  element.append(sanitizeChildren(node, config));
  return element;
}

function sanitizeAttributes(source: Element, target: Element, config: ResolvedSanitizerConfig): void {
  for (const attr of Array.from(source.attributes)) {
    const attrName = attr.name.toLowerCase();
    let attrValue = attr.value;
    if (!config.allowedAttrNames.has(attrName)) {
      continue;
    }

    const predicate = config.allowedAttrPredicates.get(attrName);
    if (predicate) {
      const result = predicate.shouldKeep(source, { attrName, attrValue });
      if (result === false) {
        continue;
      }
      attrValue = typeof result === 'string' ? result : attrValue;
    }

    if (attrName === 'href') {
      if (!attrValue.startsWith('#') && !validateLink(attrValue, config.allowedLinkProtocols, config.allowRelativeLinkPaths)) {
        continue;
      }
    } else if (attrName === 'src') {
      if (!validateLink(attrValue, config.allowedMediaProtocols, config.allowRelativeMediaPaths)) {
        continue;
      }
    }

    target.setAttribute(attrName, attrValue);
  }
}

function validateLink(
  value: string,
  allowedProtocols: readonly string[] | '*',
  allowRelativePaths: boolean,
): boolean {
  if (allowedProtocols === '*') {
    return true;
  }

  try {
    const url = new URL(value, `${fakeRelativeUrlProtocol}://`);
    const protocol = url.protocol.replace(/:$/, '');
    if (allowedProtocols.includes(protocol)) {
      return true;
    }
    return (
      allowRelativePaths &&
      protocol === fakeRelativeUrlProtocol &&
      !value.trim().toLowerCase().startsWith(fakeRelativeUrlProtocol)
    );
  } catch {
    return false;
  }
}

export function convertTagToPlaintext(
  node: Node,
  config = resolveConfig({ replaceWithPlaintext: true }),
): DocumentFragment | undefined {
  if (!node.ownerDocument) {
    return undefined;
  }

  let startTagText: string;
  let endTagText: string | undefined;
  if (node.nodeType === Node.COMMENT_NODE) {
    startTagText = `<!--${node.textContent ?? ''}-->`;
  } else if (node instanceof Element) {
    const tagName = node.tagName.toLowerCase();
    const attrString = Array.from(node.attributes)
      .map((attr) => `${attr.name}="${attr.value}"`)
      .join(' ');
    startTagText = `<${tagName}${attrString ? ` ${attrString}` : ''}>`;
    if (!selfClosingTags.has(tagName)) {
      endTagText = `</${tagName}>`;
    }
  } else {
    return undefined;
  }

  const fragment = document.createDocumentFragment();
  fragment.append(node.ownerDocument.createTextNode(startTagText));
  fragment.append(sanitizeChildren(node, config));
  if (endTagText) {
    fragment.append(node.ownerDocument.createTextNode(endTagText));
  }
  return fragment;
}
