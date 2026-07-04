import type { StatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRendererTypes';

export const renderCommonStatusbarMode: StatusbarModeRenderer = (status, context) => {
  const {
    primaryGroupElement,
    secondaryGroupElement,
    createTextElement,
    createStatusbarItemElement,
  } = context;

  primaryGroupElement.replaceChildren();
  secondaryGroupElement.replaceChildren();

  if (status.modeLabel) {
    primaryGroupElement.append(
      createTextElement('comet-editor-statusbar-mode-pill', status.modeLabel),
    );
  }

  if (status.summary) {
    primaryGroupElement.append(
      createTextElement('comet-editor-statusbar-summary', status.summary, status.summary),
    );
  }

  for (const item of status.leftItems) {
    primaryGroupElement.append(createStatusbarItemElement(item));
  }

  for (const item of status.rightItems) {
    secondaryGroupElement.append(createStatusbarItemElement(item));
  }
};
