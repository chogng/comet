import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import type { IListRenderer, IListVirtualDelegate } from 'ls/base/browser/ui/list/list';

let cleanupDomEnvironment: (() => void) | null = null;
let List: typeof import('ls/base/browser/ui/list/listWidget').List;

type ListItem = {
	id: string;
	label: string;
};

type TemplateData = {
	container: HTMLElement;
};

const rowHeight = 20;

before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ List } = await import('ls/base/browser/ui/list/listWidget'));
});

after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

function createList(selected: string[] = []) {
	const items: ListItem[] = [
		{ id: 'alpha', label: 'Alpha' },
		{ id: 'beta', label: 'Beta' },
	];
	const container = document.createElement('div');
	document.body.append(container);

	const delegate: IListVirtualDelegate<ListItem> = {
		getHeight: () => rowHeight,
		getTemplateId: () => 'listItem',
	};
	const renderer: IListRenderer<ListItem, TemplateData> = {
		templateId: 'listItem',
		renderTemplate: row => ({ container: row }),
		renderElement: (item, _index, data) => {
			data.container.dataset['listItemId'] = item.id;
			data.container.textContent = item.label;
		},
		disposeTemplate: () => {},
	};

	const list = new List<ListItem>(
		'testList',
		container,
		delegate,
		[renderer],
		{
			identityProvider: {
				getId: item => item.id,
			},
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: item => item.label,
			},
			accessibilityProvider: {
				getWidgetAriaLabel: () => 'Test list',
				getAriaLabel: item => item.label,
			},
			multipleSelectionSupport: false,
		},
	);

	list.splice(0, 0, items);
	list.setFocus([0]);
	list.layout(items.length * rowHeight);
	list.onDidChangeSelection(({ elements }) => {
		selected.push(elements[0]?.id ?? 'null');
	});

	return { container, items, list };
}

test('list type navigation focuses the matching item and click selects it', () => {
	const selected: string[] = [];
	const { container, items, list } = createList(selected);

	try {
		list.domFocus();
		list.getHTMLElement().dispatchEvent(new window.KeyboardEvent('keydown', {
			bubbles: true,
			key: 'b',
			keyCode: 66,
			which: 66,
		}));

		const betaNode = list.getHTMLElement().querySelector<HTMLElement>(
			'[data-list-item-id="beta"]',
		);
		assert(betaNode instanceof HTMLElement);
		assert.equal(betaNode.classList.contains('focused'), true);

		betaNode.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

		assert.equal(items[list.getSelection()[0]]?.id, 'beta');
		assert.deepEqual(selected, ['beta']);
	} finally {
		list.dispose();
		container.remove();
	}
});

test('list applies expected DOM classes and keyboard navigation', () => {
	const selected: string[] = [];
	const { container, items, list } = createList(selected);

	try {
		assert.equal(list.getHTMLElement().classList.contains('monaco-list'), true);

		list.domFocus();
		list.getHTMLElement().dispatchEvent(new window.KeyboardEvent('keydown', {
			bubbles: true,
			key: 'ArrowDown',
			keyCode: 40,
			which: 40,
		}));

		const betaNode = list.getHTMLElement().querySelector<HTMLElement>(
			'[data-list-item-id="beta"]',
		);
		assert(betaNode instanceof HTMLElement);
		assert.equal(betaNode.classList.contains('monaco-list-row'), true);
		assert.equal(betaNode.classList.contains('focused'), true);

		list.getHTMLElement().dispatchEvent(new window.KeyboardEvent('keydown', {
			bubbles: true,
			key: 'Enter',
			keyCode: 13,
			which: 13,
		}));

		assert.equal(items[list.getSelection()[0]]?.id, 'beta');
		assert.deepEqual(selected, ['beta']);
	} finally {
		list.dispose();
		container.remove();
	}
});
