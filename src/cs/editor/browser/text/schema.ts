import {
  inputRules,
  smartQuotes,
  emDash,
  ellipsis,
  wrappingInputRule,
  textblockTypeInputRule,
} from 'prosemirror-inputrules';
import { Schema } from 'prosemirror-model';
import type { DOMOutputSpec, MarkSpec, Node as ProseMirrorNode, NodeSpec } from 'prosemirror-model';

import { Plugin, PluginKey } from 'prosemirror-state';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';

export type BlockNodeAttrs = {
  blockId: string | null;
  textAlign?: 'left' | 'center' | 'right' | null;
};

export type FigureNodeAttrs = BlockNodeAttrs & {
  figureId: string | null;
  src: string | null;
  alt: string;
  title: string;
  width: number | null;
};

export type CitationNodeAttrs = {
  citationIds: string[];
  displayText: string | null;
};

export type FigureRefNodeAttrs = {
  targetId: string | null;
  label: string;
};

export type TextStyleMarkAttrs = {
  fontFamily: string | null;
  fontSize: string | null;
};

type ElementLike = {
  getAttribute: (name: string) => string | null;
  querySelector: (selectors: string) => ElementLike | null;
  textContent?: string | null;
  style?: {
    textAlign?: string;
    fontFamily?: string;
    fontSize?: string;
  };
};

const trackedBlockNodeNames = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bullet_list',
  'ordered_list',
  'figure',
  'figcaption',
]);

function requireNodeSpec(
  nodes: typeof basicSchema.spec.nodes,
  name: string,
): NodeSpec {
  const spec = nodes.get(name);
  if (!spec) {
    throw new Error(`Writing editor node "${name}" is unavailable.`);
  }

  return spec;
}

function withTrackedBlockId(spec: NodeSpec): NodeSpec {
  return {
    ...spec,
    attrs: {
      ...spec.attrs,
      blockId: { default: null },
    },
  };
}

function normalizeTextAlignValue(value: string | null | undefined) {
  if (value === 'left' || value === 'center' || value === 'right') {
    return value;
  }

  return null;
}

function asElementLike(value: unknown): ElementLike | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ElementLike>;
  return typeof candidate.getAttribute === 'function'
    ? candidate as ElementLike
    : null;
}

function withTextAlign(spec: NodeSpec): NodeSpec {
  const parseDOM = spec.parseDOM?.map((rule) => {
    const nextRule = { ...rule };
    const baseGetAttrs = rule.getAttrs;
    nextRule.getAttrs = (node) => {
      const baseAttrs = typeof baseGetAttrs === 'function' ? baseGetAttrs(node) : null;
      if (baseAttrs === false) {
        return false;
      }

      const element = asElementLike(node);
      const rawTextAlign = element?.style?.textAlign || element?.getAttribute('data-text-align') || null;
      return {
        ...(baseAttrs && typeof baseAttrs === 'object' ? baseAttrs : {}),
        textAlign: normalizeTextAlignValue(rawTextAlign),
      };
    };
    return nextRule;
  }) ?? [];

  return {
    ...spec,
    attrs: {
      ...spec.attrs,
      textAlign: { default: null },
    },
    parseDOM,
    toDOM(node) {
      const attrs = node.attrs as BlockNodeAttrs;
      const baseDom = (spec.toDOM ? spec.toDOM(node) : [node.type.name, 0]) as DOMOutputSpec;
      if (!Array.isArray(baseDom)) {
        return baseDom;
      }

      const [tagName, maybeAttrs, ...rest] = baseDom;
      const domAttrs =
        maybeAttrs && typeof maybeAttrs === 'object' && !Array.isArray(maybeAttrs)
          ? { ...maybeAttrs }
          : {};
      const content = domAttrs === maybeAttrs ? rest : [maybeAttrs, ...rest];

      if (attrs.textAlign) {
        domAttrs.style = [domAttrs.style, `text-align: ${attrs.textAlign}`]
          .filter((part) => typeof part === 'string' && part.trim().length > 0)
          .join('; ');
        domAttrs['data-text-align'] = attrs.textAlign;
      }

      return [String(tagName), domAttrs, ...content];
    },
  };
}

function createFigureSpec(): NodeSpec {
  return {
    group: 'block',
    content: 'figcaption?',
    defining: true,
    isolating: true,
    draggable: true,
    attrs: {
      blockId: { default: null },
      figureId: { default: null },
      src: { default: null },
      alt: { default: '' },
      title: { default: '' },
      width: { default: null },
    },
    toDOM(node) {
      const attrs = node.attrs as FigureNodeAttrs;
      return [
        'figure',
        {
          class: 'pm-figure',
          'data-editor-figure': 'true',
          'data-block-id': attrs.blockId ?? '',
          'data-figure-id': attrs.figureId ?? '',
        },
        [
          'img',
          {
            class: 'pm-figure-image',
            src: attrs.src ?? '',
            alt: attrs.alt,
            title: attrs.title,
            ...(attrs.width ? { width: String(attrs.width) } : {}),
          },
        ],
        0,
      ];
    },
    parseDOM: [
      {
        tag: 'figure[data-editor-figure]',
        contentElement: (element: unknown) => {
          const nextElement = asElementLike(element);
          return (nextElement?.querySelector('figcaption') ?? element) as never;
        },
        getAttrs: (element: ElementLike) => {
          const image = element.querySelector('img');
          return {
            blockId: element.getAttribute('data-block-id') || null,
            figureId: element.getAttribute('data-figure-id') || null,
            src: image?.getAttribute('src') || null,
            alt: image?.getAttribute('alt') || '',
            title: image?.getAttribute('title') || '',
            width: image?.getAttribute('width')
              ? Number(image.getAttribute('width')) || null
              : null,
          } satisfies FigureNodeAttrs;
        },
      },
    ],
  };
}

function createFigcaptionSpec(): NodeSpec {
  return {
    content: 'inline*',
    attrs: {
      blockId: { default: null },
    },
    toDOM(node) {
      const attrs = node.attrs as BlockNodeAttrs;
      return [
        'figcaption',
        {
          class: 'pm-figure-caption',
          'data-block-id': attrs.blockId ?? '',
        },
        0,
      ];
    },
    parseDOM: [
      {
        tag: 'figcaption.pm-figure-caption',
        getAttrs: (element) => ({
          blockId: element.getAttribute('data-block-id') || null,
        } satisfies BlockNodeAttrs),
      },
    ],
  };
}

function createCitationSpec(): NodeSpec {
  return {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: {
      citationIds: { default: [] },
      displayText: { default: null },
    },
    toDOM(node) {
      const attrs = node.attrs as CitationNodeAttrs;
      const displayText =
        attrs.displayText ?? `[${attrs.citationIds.length > 0 ? attrs.citationIds.join(', ') : '?'}]`;

      return [
        'span',
        {
          class: 'pm-inline-chip pm-inline-chip-citation',
          'data-citation-ids': attrs.citationIds.join(','),
        },
        displayText,
      ];
    },
    parseDOM: [
      {
        tag: 'span.pm-inline-chip-citation[data-citation-ids]',
        getAttrs: (element: ElementLike) => ({
          citationIds: (element.getAttribute('data-citation-ids') ?? '')
            .split(',')
            .map((segment) => segment.trim())
            .filter(Boolean),
          displayText: element.textContent?.trim() || null,
        } satisfies CitationNodeAttrs),
      },
    ],
  };
}

function createFigureRefSpec(): NodeSpec {
  return {
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    attrs: {
      targetId: { default: null },
      label: { default: 'Figure' },
    },
    toDOM(node) {
      const attrs = node.attrs as FigureRefNodeAttrs;
      const suffix = attrs.targetId ? ` ${attrs.targetId}` : '';

      return [
        'span',
        {
          class: 'pm-inline-chip pm-inline-chip-figure-ref',
          'data-target-id': attrs.targetId ?? '',
        },
        `${attrs.label}${suffix}`,
      ];
    },
    parseDOM: [
      {
        tag: 'span.pm-inline-chip-figure-ref[data-target-id]',
        getAttrs: (element) => {
          const targetId = element.getAttribute('data-target-id');
          const rawText = element.textContent?.trim() || '';
          const suffix = targetId?.trim() ? ` ${targetId.trim()}` : '';

          return {
            targetId: targetId || null,
            label: suffix && rawText.endsWith(suffix)
              ? rawText.slice(0, -suffix.length).trim() || 'Figure'
              : rawText || 'Figure',
          } satisfies FigureRefNodeAttrs;
        },
      },
    ],
  };
}

function normalizeTextStyleValue(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function createTextStyleMarkSpec(): MarkSpec {
  return {
    attrs: {
      fontFamily: { default: null },
      fontSize: { default: null },
    },
    parseDOM: [
      {
        tag: 'span',
        getAttrs: (element) => {
          const nextElement = asElementLike(element);
          if (!nextElement) {
            return false;
          }

          const fontFamily = normalizeTextStyleValue(nextElement.style?.fontFamily);
          const fontSize = normalizeTextStyleValue(nextElement.style?.fontSize);
          if (!fontFamily && !fontSize) {
            return false;
          }

          return {
            fontFamily,
            fontSize,
          } satisfies TextStyleMarkAttrs;
        },
      },
    ],
    toDOM(mark) {
      const attrs = mark.attrs as TextStyleMarkAttrs;
      const styleParts = [
        attrs.fontFamily ? `font-family: ${attrs.fontFamily}` : '',
        attrs.fontSize ? `font-size: ${attrs.fontSize}` : '',
      ].filter(Boolean);

      return [
        'span',
        styleParts.length > 0
          ? {
              style: styleParts.join('; '),
            }
          : {},
        0,
      ];
    },
  };
}

function createUnderlineMarkSpec(): MarkSpec {
  return {
    parseDOM: [
      { tag: 'u' },
      {
        style: 'text-decoration',
        getAttrs: (value) =>
          typeof value === 'string' && value.toLowerCase().includes('underline') ? null : false,
      },
    ],
    toDOM() {
      return ['u', 0];
    },
  };
}

const baseNodes = basicSchema.spec.nodes
  .remove('image')
  .update('paragraph', withTextAlign(withTrackedBlockId(requireNodeSpec(basicSchema.spec.nodes, 'paragraph'))))
  .update('heading', withTextAlign(withTrackedBlockId(requireNodeSpec(basicSchema.spec.nodes, 'heading'))))
  .update('blockquote', withTrackedBlockId(requireNodeSpec(basicSchema.spec.nodes, 'blockquote')))
  .append({
    figure: createFigureSpec(),
    figcaption: createFigcaptionSpec(),
    citation: createCitationSpec(),
    figure_ref: createFigureRefSpec(),
  });

const listNodes = addListNodes(baseNodes, 'paragraph block*', 'block');

const writingEditorNodes = listNodes
  .update('bullet_list', withTrackedBlockId(requireNodeSpec(listNodes, 'bullet_list')))
  .update('ordered_list', withTrackedBlockId(requireNodeSpec(listNodes, 'ordered_list')));

export const writingEditorSchema = new Schema({
  nodes: writingEditorNodes,
  marks: basicSchema.spec.marks
    .addToEnd('underline', createUnderlineMarkSpec())
    .addToEnd('text_style', createTextStyleMarkSpec()),
});

type WritingEditorPlaceholderState = {
  placeholder: string;
};

export const writingEditorPlaceholderPluginKey =
  new PluginKey<WritingEditorPlaceholderState>('writing-editor-placeholder');

export function createEditorNodeId(prefix: string) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isTrackedBlockNode(node: ProseMirrorNode) {
  return trackedBlockNodeNames.has(node.type.name);
}

export function createWritingEditorPlaceholderPlugin(placeholder: string) {
  return new Plugin({
    key: writingEditorPlaceholderPluginKey,
    state: {
      init: () => ({
        placeholder,
      }),
      apply(transaction, previousState) {
        const nextPlaceholder = transaction.getMeta(writingEditorPlaceholderPluginKey);
        if (typeof nextPlaceholder !== 'string' || nextPlaceholder === previousState.placeholder) {
          return previousState;
        }

        return {
          placeholder: nextPlaceholder,
        };
      },
    },
    props: {
      decorations(state) {
        const placeholderState = writingEditorPlaceholderPluginKey.getState(state);
        const firstChild = state.doc.firstChild;
        if (
          !firstChild ||
          state.doc.childCount !== 1 ||
          firstChild.type.name !== 'paragraph' ||
          firstChild.content.size > 0
        ) {
          return null;
        }

        return DecorationSet.create(state.doc, [
          Decoration.node(0, firstChild.nodeSize, {
            class: 'pm-empty-paragraph',
            'data-placeholder': placeholderState?.placeholder ?? '',
          }),
        ]);
      },
    },
  });
}

export function updateWritingEditorPlaceholder(
  view: EditorView,
  placeholder: string,
) {
  const placeholderState = writingEditorPlaceholderPluginKey.getState(view.state);
  if (placeholderState?.placeholder === placeholder) {
    return false;
  }

  view.dispatch(view.state.tr.setMeta(writingEditorPlaceholderPluginKey, placeholder));
  return true;
}

export function createWritingEditorDocumentIdentityPlugin() {
  return new Plugin({
    key: new PluginKey('writing-editor-document-identity'),
    appendTransaction(_transactions, oldState, newState) {
      if (oldState.doc.eq(newState.doc)) {
        return null;
      }

      const transaction = newState.tr;
      let mutated = false;

      newState.doc.descendants((node, pos) => {
        if (isTrackedBlockNode(node)) {
          const attrs = node.attrs as BlockNodeAttrs;
          if (!attrs.blockId) {
            transaction.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              blockId: createEditorNodeId('block'),
            });
            mutated = true;
          }
        }

        if (node.type.name === 'figure') {
          const attrs = node.attrs as FigureNodeAttrs;
          if (!attrs.figureId) {
            transaction.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              figureId: createEditorNodeId('figure'),
            });
            mutated = true;
          }
        }
      });

      return mutated ? transaction : null;
    },
  });
}

export function createWritingEditorInputRules() {
  const headingType = writingEditorSchema.nodes.heading;
  const blockquoteType = writingEditorSchema.nodes.blockquote;
  const bulletListType = writingEditorSchema.nodes.bullet_list;
  const orderedListType = writingEditorSchema.nodes.ordered_list;

  return inputRules({
    rules: [
      ...smartQuotes,
      emDash,
      ellipsis,
      textblockTypeInputRule(/^(#{1,3})\s$/, headingType, (match) => ({
        level: match[1].length,
      })),
      wrappingInputRule(/^\s*>\s$/, blockquoteType),
      wrappingInputRule(/^\s*([-+*])\s$/, bulletListType),
      wrappingInputRule(
        /^(\d+)\.\s$/,
        orderedListType,
        (match) => ({ order: Number(match[1]) || 1 }),
        (match, node) => node.childCount + node.attrs.order === Number(match[1]),
      ),
    ],
  });
}
