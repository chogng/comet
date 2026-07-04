import { LibraryWidget } from 'cs/workbench/contrib/preferences/browser/libraryWidget';
import type { LibraryWidgetProps } from 'cs/workbench/contrib/preferences/browser/libraryWidget';
import { RagWidget } from 'cs/workbench/contrib/preferences/browser/ragWidget';
import type { RagWidgetProps } from 'cs/workbench/contrib/preferences/browser/ragWidget';
import {
  buildSettingsHint as buildHint,
  createSettingsElement as el,
} from 'cs/workbench/contrib/preferences/browser/settingsUiPrimitives';

export type KnowledgeBaseWidgetProps = {
  title: string;
  hint: string;
  library: LibraryWidgetProps;
  rag: RagWidgetProps;
};

export class KnowledgeBaseWidget {
  private props: KnowledgeBaseWidgetProps;
  private readonly element = el('section', 'comet-settings-field comet-settings-knowledge-base-field');
  private readonly libraryWidget: LibraryWidget;
  private readonly ragWidget: RagWidget;

  constructor(props: KnowledgeBaseWidgetProps) {
    this.props = props;
    this.libraryWidget = new LibraryWidget(props.library);
    this.ragWidget = new RagWidget(props.rag);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  setProps(props: KnowledgeBaseWidgetProps) {
    this.props = props;
    this.libraryWidget.setProps(props.library);
    this.ragWidget.setProps(props.rag);
    this.element.replaceChildren(this.render());
  }

  private render() {
    const root = el('div', 'comet-settings-field');
    const title = el('span', 'comet-settings-section-title');
    title.textContent = this.props.title;
    root.append(
      title,
      buildHint(this.props.hint),
      this.libraryWidget.getElement(),
      this.ragWidget.getElement(),
    );
    return root;
  }
}
