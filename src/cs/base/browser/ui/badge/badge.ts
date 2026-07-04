import 'cs/base/browser/ui/badge/badge.css';
import { $ } from 'cs/base/browser/dom';

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

export function createBadge(props: BadgeProps) {
  const badge = $<HTMLElementTagNameMap['span']>('span', { class: [
      'comet-badge',
      props.compact ? 'comet-is-compact' : '',
      props.className ?? '',
    ]
      .filter(Boolean)
      .join(' ') });
  const content = $<HTMLElementTagNameMap['span']>('span.comet-badge-content');

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
    const label = $<HTMLElementTagNameMap['span']>('span.comet-badge-label');
    label.textContent = props.label;
    content.append(label);
  }

  badge.append(content);
  return badge;
}
