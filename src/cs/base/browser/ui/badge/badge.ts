import 'cs/base/browser/ui/badge/badge.css';

import { applyHover } from 'cs/base/browser/ui/hover/hoverDelegate';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';

export type BadgeProps = {
  icon?: LxIconName;
  label?: string;
  title?: string;
  className?: string;
  compact?: boolean;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

export function createBadge(props: BadgeProps) {
  const badge = createElement(
    'span',
    [
      'comet-badge',
      props.compact ? 'is-compact' : '',
      props.className ?? '',
    ]
      .filter(Boolean)
      .join(' '),
  );
  const content = createElement('span', 'comet-badge-content');

  if (props.title) {
    applyHover(badge, props.title);
    badge.setAttribute('aria-label', props.title);
  } else {
    badge.setAttribute('aria-hidden', 'true');
  }

  if (props.icon) {
    content.append(createLxIcon(props.icon, 'comet-badge-icon'));
  }

  if (props.label) {
    const label = createElement('span', 'comet-badge-label');
    label.textContent = props.label;
    content.append(label);
  }

  badge.append(content);
  return badge;
}
