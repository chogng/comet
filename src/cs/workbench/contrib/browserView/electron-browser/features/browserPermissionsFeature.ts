/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { ThemeIcon } from 'cs/base/common/themables';
import { localize, localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId, type IBrowserViewDeviceRequest } from 'cs/platform/browserView/common/browserView';
import {
	ALL_PERMISSION_CATEGORIES,
	BrowserPermissionStore,
	type BrowserDeviceType,
	PERMISSION_CATEGORY_DESCRIPTORS,
	type PermissionCategory,
	type PermissionDecision,
	type PermissionState,
	toOriginKey,
} from 'cs/platform/browserView/common/browserPermissions';
import { ContextKeyExpr } from 'cs/platform/contextkey/common/contextkey';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'cs/platform/notification/common/notification';
import { IQuickInputService, type IQuickPickItem } from 'cs/platform/quickinput/common/quickInput';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	BROWSER_EDITOR_ACTIVE,
	CONTEXT_BROWSER_HAS_URL,
	BrowserActionCategory,
	BrowserEditor,
	BrowserEditorContribution,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

export class BrowserPermissionsFeature extends BrowserEditorContribution {
	private readonly devicePickers = new Map<string, IDevicePickerHandle>();
	private model: IBrowserViewModel | undefined;
	private permissions: BrowserPermissionStore | undefined;

	constructor(
		editor: BrowserEditor,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(editor);
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.model = model;
		this.permissions = model.permissions;
		store.add(model.onDidRequestPermission(event => {
			if (event.device) {
				this.onDidRequestDevice(event.origin, event.device);
			} else {
				this.onDidRequestPermission(event.origin, event.category);
			}
		}));
		store.add(toDisposable(() => this.closeDevicePickers()));
	}

	override onModelDetached(): void {
		this.closeDevicePickers();
		this.model = undefined;
		this.permissions = undefined;
	}

	showManagementPicker(): void {
		const model = this.model;
		const permissions = this.permissions;
		if (!model || !permissions) {
			throw new Error('The Browser permissions contribution has no attached model.');
		}

		const origin = toOriginKey(model.url);
		if (!origin) {
			this.notificationService.info(localize('browser.permissions.noOrigin', "Permissions can only be managed for web pages."));
			return;
		}

		showPermissionsPicker(this.quickInputService, model, permissions, origin);
	}

	private closeDevicePickers(): void {
		for (const picker of this.devicePickers.values()) {
			picker.dispose();
		}
		this.devicePickers.clear();
	}

	private onDidRequestDevice(origin: string, request: IBrowserViewDeviceRequest): void {
		const existing = this.devicePickers.get(request.requestId);
		if (existing) {
			existing.update(request);
			return;
		}

		const model = this.model;
		if (!model) {
			return;
		}

		const handle = showDevicePicker(
			this.quickInputService,
			model,
			origin,
			request,
			() => this.devicePickers.delete(request.requestId),
		);
		this.devicePickers.set(request.requestId, handle);
	}

	private onDidRequestPermission(origin: string, category: PermissionCategory): void {
		const model = this.model;
		if (!model) {
			return;
		}

		const descriptor = PERMISSION_CATEGORY_DESCRIPTORS[category];
		this.notificationService.prompt(
			Severity.Info,
			localize('browser.permissions.prompt', "{0} wants access to {1}", displayOrigin(origin), descriptor.label),
			[
				{
					label: localize('browser.permissions.allow', "Allow"),
					run: () => {
						void model.setPermissions(origin, [{ category, state: 'allow' }]);
					},
				},
				{
					label: localize('browser.permissions.block', "Block"),
					run: () => {
						void model.setPermissions(origin, [{ category, state: 'deny' }]);
					},
				},
			],
			{
				sticky: true,
				onCancel: () => {
					void model.setPermissions(origin, [{ category, state: null }]);
				},
			},
		);
	}
}

BrowserEditor.registerContribution(BrowserPermissionsFeature);

interface DevicePickItem extends IQuickPickItem {
	readonly deviceId: string;
}

interface IDevicePickerHandle {
	update(request: IBrowserViewDeviceRequest): void;
	dispose(): void;
}

function showDevicePicker(
	quickInputService: IQuickInputService,
	model: IBrowserViewModel,
	origin: string,
	request: IBrowserViewDeviceRequest,
	onDone: () => void,
): IDevicePickerHandle {
	const disposables = new DisposableStore();
	const picker = disposables.add(quickInputService.createQuickPick<DevicePickItem>());
	picker.title = localize('browser.device.title', "{0} wants to connect to {1}", displayOrigin(origin), deviceTypeLabel(request.deviceType));
	picker.placeholder = localize('browser.device.placeholder', "Select a device to connect to");
	picker.ignoreFocusOut = true;
	picker.busy = true;

	let resolved = false;
	let finished = false;

	const finish = () => {
		if (finished) {
			return;
		}
		finished = true;
		disposables.dispose();
		onDone();
	};

	const resolve = (deviceId: string | null) => {
		if (resolved) {
			return;
		}
		resolved = true;
		void model.selectDevice(request.requestId, deviceId);
	};

	const setDevices = (next: IBrowserViewDeviceRequest) => {
		const activeId = picker.activeItems[0]?.deviceId;
		const items = next.devices.map(device => ({
			label: device.label,
			description: device.detail,
			deviceId: device.deviceId,
		}));
		picker.items = items;
		const active = activeId ? items.find(item => item.deviceId === activeId) : items[0];
		picker.activeItems = active ? [active] : [];
	};

	setDevices(request);

	disposables.add(picker.onDidAccept(() => {
		const pick = picker.activeItems[0];
		if (!pick) {
			return;
		}
		resolve(pick.deviceId);
		finish();
	}));
	disposables.add(picker.onDidHide(() => {
		resolve(null);
		finish();
	}));

	picker.show();

	return {
		update: setDevices,
		dispose: () => {
			resolve(null);
			finish();
		},
	};
}

function deviceTypeLabel(deviceType: BrowserDeviceType): string {
	switch (deviceType) {
		case 'usb':
			return localize('browser.device.kind.usb', "a USB device");
		case 'serial':
			return localize('browser.device.kind.serial', "a serial port");
		case 'hid':
			return localize('browser.device.kind.hid', "an HID device");
		case 'bluetooth':
			return localize('browser.device.kind.bluetooth', "a Bluetooth device");
	}
}

interface PermissionPickItem extends IQuickPickItem {
	readonly iconClass?: string;
	readonly category: PermissionCategory;
}

interface PermissionDecisionPickItem extends IQuickPickItem {
	readonly iconClass?: string;
	readonly decision: PermissionDecision | null;
}

function showPermissionsPicker(quickInputService: IQuickInputService, model: IBrowserViewModel, permissions: BrowserPermissionStore, origin: string): void {
	const disposables = new DisposableStore();
	const picker = disposables.add(quickInputService.createQuickPick<PermissionPickItem>());
	picker.title = localize('browser.permissions.title', "Permissions for {0}", displayOrigin(origin));
	picker.placeholder = localize('browser.permissions.placeholder', "Select a permission to change");
	picker.ignoreFocusOut = true;

	const rebuild = () => {
		const activeCategory = picker.activeItems[0]?.category;
		const items = ALL_PERMISSION_CATEGORIES.map(category => buildPermissionItem(permissions, origin, category));
		picker.items = items;
		const active = activeCategory ? items.find(item => item.category === activeCategory) : items[0];
		picker.activeItems = active ? [active] : [];
	};

	rebuild();
	disposables.add(permissions.onDidChange(rebuild));
	disposables.add(picker.onDidAccept(() => {
		const selected = picker.activeItems[0];
		if (!selected) {
			return;
		}
		void pickPermissionDecision(quickInputService, model, permissions, origin, selected.category);
	}));
	disposables.add(picker.onDidHide(() => disposables.dispose()));
	picker.show();
}

function buildPermissionItem(permissions: BrowserPermissionStore, origin: string, category: PermissionCategory): PermissionPickItem {
	const descriptor = PERMISSION_CATEGORY_DESCRIPTORS[category];
	const decision = permissions.getDecision(origin, category);
	const effective = decision ?? permissions.defaultStateFor(category);
	const stateLabel = permissionStateLabel(effective);
	const description = decision
		? stateLabel
		: localize('browser.permissions.state.default', "{0} (default)", stateLabel);

	return {
		category,
		label: descriptor.label,
		description,
		detail: descriptor.description,
		iconClass: ThemeIcon.asClassName(descriptor.icon),
	};
}

async function pickPermissionDecision(
	quickInputService: IQuickInputService,
	model: IBrowserViewModel,
	permissions: BrowserPermissionStore,
	origin: string,
	category: PermissionCategory,
): Promise<void> {
	const descriptor = PERMISSION_CATEGORY_DESCRIPTORS[category];
	const current = permissions.getDecision(origin, category) ?? permissions.defaultStateFor(category);
	const pick = await quickInputService.pick<PermissionDecisionPickItem, { title: string; placeHolder: string }>([
		{
			label: localize('browser.permissions.allow', "Allow"),
			description: current === 'allow' ? localize('browser.permissions.current', "Current") : undefined,
			iconClass: ThemeIcon.asClassName(Codicon.check),
			decision: 'allow',
		},
		{
			label: localize('browser.permissions.block', "Block"),
			description: current === 'deny' ? localize('browser.permissions.current', "Current") : undefined,
			iconClass: ThemeIcon.asClassName(Codicon.circleSlash),
			decision: 'deny',
		},
		{
			label: localize('browser.permissions.reset', "Reset to Default"),
			description: current === 'ask' ? localize('browser.permissions.current', "Current") : undefined,
			iconClass: ThemeIcon.asClassName(Codicon.discard),
			decision: null,
		},
	], {
		title: descriptor.label,
		placeHolder: descriptor.description,
	});

	if (pick) {
		await model.setPermissions(origin, [{ category, state: pick.decision }]);
	}
}

function permissionStateLabel(state: PermissionState): string {
	if (state === 'allow') {
		return localize('browser.permissions.state.allowed', "Allowed");
	}
	if (state === 'deny') {
		return localize('browser.permissions.state.blocked', "Blocked");
	}
	return localize('browser.permissions.state.ask', "Ask");
}

function displayOrigin(origin: string): string {
	const parsed = URL.parse(origin);
	return parsed?.host || origin;
}

class ManageBrowserPermissionsAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ManagePermissions;

	constructor() {
		const when = ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL.isEqualTo(true));
		super({
			id: ManageBrowserPermissionsAction.ID,
			title: localize2('browser.managePermissions', "Site Permissions"),
			category: BrowserActionCategory,
			icon: Codicon.shield,
			f1: true,
			precondition: when,
		});
	}

	async run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (!(browserEditor instanceof BrowserEditor)) {
			throw new Error('The permissions action target is not the active Browser editor.');
		}
		const contribution = browserEditor.getContribution(BrowserPermissionsFeature);
		if (!contribution) {
			throw new Error('The active Browser editor has no permissions contribution.');
		}
		contribution.showManagementPicker();
	}
}

registerAction2(ManageBrowserPermissionsAction);
