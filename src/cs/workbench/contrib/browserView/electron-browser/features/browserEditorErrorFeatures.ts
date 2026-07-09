/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { renderIcon } from 'cs/base/browser/ui/iconLabel/iconLabels';
import { Codicon } from 'cs/base/common/codicons';
import { Emitter, type Event as BaseEvent } from 'cs/base/common/event';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { IBrowserViewCertificateError, IBrowserViewLoadError } from 'cs/platform/browserView/common/browserView';
import { IHoverService } from 'cs/platform/hover/browser/hover';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	type IBrowserEditorWidget,
	type IBrowserUrlRenderer,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

class BrowserEditorErrorFeatures extends BrowserEditorContribution {
	private readonly element = $('.browser-error-container');
	private readonly certActions = this._register(new MutableDisposable<DisposableStore>());
	private readonly siteInfoSlot = $('.browser-site-info-slot-wrapper');
	private readonly siteInfoWidget: SiteInfoWidget;
	private readonly urlRenderer = this._register(new CertUrlRenderer());
	private readonly contentWidget: IBrowserEditorWidget;
	private readonly preUrlWidget: IBrowserEditorWidget;

	constructor(
		editor: BrowserEditor,
		@IHoverService hoverService: IHoverService,
	) {
		super(editor);
		this.element.style.display = 'none';
		this.contentWidget = { location: BrowserWidgetLocation.ContentArea, element: this.element, order: 300 };
		this.siteInfoWidget = this._register(new SiteInfoWidget(this.siteInfoSlot, editor, hoverService));
		this.preUrlWidget = { location: BrowserWidgetLocation.PreUrl, element: this.siteInfoSlot, order: 10 };
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this.contentWidget, this.preUrlWidget];
	}

	override get urlRenderers(): readonly IBrowserUrlRenderer[] {
		return [this.urlRenderer];
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		store.add(model.onDidChangeLoadingState(() => this.updateError()));
		store.add(model.onDidNavigate(() => this.updateCertState()));
		this.updateError();
	}

	override onModelDetached(): void {
		this.clearContent();
		this.element.style.display = 'none';
		this.siteInfoWidget.setCertificateError(undefined);
		this.urlRenderer.setCertificateError(undefined);
	}

	private updateError(): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}

		const error = model.error;
		this.updateCertState();
		if (!error) {
			this.clearContent();
			this.element.style.display = 'none';
			return;
		}

		this.clearContent();
		this.element.appendChild(this.renderError(error));
		this.element.style.display = '';
	}

	private updateCertState(): void {
		const model = this.editor.model;
		const cert = model?.certificateError ?? model?.error?.certificateError;
		this.siteInfoWidget.setCertificateError(cert);
		this.urlRenderer.setCertificateError(cert);
	}

	private clearContent(): void {
		this.certActions.clear();
		this.element.replaceChildren();
	}

	private renderError(error: IBrowserViewLoadError): HTMLElement {
		const isCertError = !!error.certificateError;
		const content = $('.browser-error-content');
		const icon = $('.browser-error-icon');
		icon.classList.toggle('cert-error', isCertError);
		icon.appendChild(renderIcon(isCertError ? Codicon.workspaceUntrusted : Codicon.globe));

		const title = $('.browser-error-title');
		title.textContent = isCertError
			? localize('browser.certErrorLabel', "Certificate Error")
			: localize('browser.loadErrorLabel', "Failed to Load Page");

		const detail = $('.browser-error-detail');
		const detailText = $('span');
		detailText.textContent = isCertError
			? localize('browser.certErrorDescription', "This site's security certificate could not be verified.")
			: `${error.errorDescription} (${error.errorCode})`;
		detail.appendChild(detailText);

		if (error.certificateError) {
			const warning = $('b.browser-error-detail');
			warning.textContent = localize('browser.certErrorExtraWarning', " Your connection is not private.");
			detail.appendChild(warning);
		}

		const remoteWarning = this.editor.model?.isRemoteSession && (error.errorCode === -111 || error.errorCode === -324)
			? localize('browser.remoteErrorExtraWarning', "This usually means the host could not be found.\nEnsure the URL is correct and the server is accessible from the remote machine.")
			: '';
		if (remoteWarning) {
			const remoteWarningElement = $('.browser-error-detail.hint');
			remoteWarningElement.textContent = remoteWarning;
			detail.appendChild(remoteWarningElement);
		}

		const url = $('.browser-error-detail');
		const urlLabel = $('strong');
		urlLabel.textContent = localize('browser.errorUrlLabel', "URL:");
		const urlValue = $('code');
		urlValue.textContent = error.url;
		url.append(urlLabel, document.createTextNode(' '), urlValue);

		content.append(icon, title, detail, url);

		if (error.certificateError) {
			content.append(this.renderCertDetails(error.certificateError), this.renderCertActions(error.certificateError));
		}

		return content;
	}

	private renderCertDetails(certError: IBrowserViewCertificateError): HTMLElement {
		const table = $('.browser-cert-details-table');
		const heading = $('.browser-cert-details-heading');
		heading.textContent = localize('browser.certDetailsHeading', "Certificate Details");
		table.appendChild(heading);

		const addRow = (label: string, value: string) => {
			const row = $('.browser-cert-details-row');
			const labelElement = $('.browser-cert-details-label');
			labelElement.textContent = label;
			const valueElement = $('.browser-cert-details-value');
			valueElement.textContent = value;
			row.append(labelElement, valueElement);
			table.appendChild(row);
		};

		addRow(localize('browser.certError', "Error"), certError.error);
		addRow(localize('browser.certIssuer', "Issuer"), certError.issuerName);
		addRow(localize('browser.certSubject', "Subject"), certError.subjectName);
		addRow(
			localize('browser.certValid', "Valid"),
			`${formatCertDate(certError.validStart)} - ${formatCertDate(certError.validExpiry)}`,
		);
		addRow(localize('browser.certFingerprint', "Fingerprint"), certError.fingerprint);

		return table;
	}

	private renderCertActions(certError: IBrowserViewCertificateError): HTMLElement {
		const container = $('.browser-cert-action');
		const store = new DisposableStore();
		this.certActions.value = store;

		const primaryLabel = this.editor.model?.canGoBack
			? localize('browser.certGoBack', "Go Back")
			: localize('browser.certReload', "Reload");
		const primaryButton = store.add(new ButtonView({
			variant: 'secondary',
			content: primaryLabel,
			onClick: () => {
				if (this.editor.model?.canGoBack) {
					void this.editor.model.goBack();
				} else {
					void this.editor.model?.reload();
				}
			},
		}));

		const proceedButton = store.add(new ButtonView({
			variant: 'primary',
			content: localize('browser.certProceed', "Proceed anyway (unsafe)"),
			onClick: () => {
				void this.editor.model?.trustCertificate(certError.host, certError.fingerprint);
			},
		}));

		container.append(primaryButton.getElement(), proceedButton.getElement());
		return container;
	}
}

function formatCertDate(epoch: number): string {
	return new Date(epoch * 1000).toLocaleDateString();
}

class CertUrlRenderer implements IBrowserUrlRenderer {
	private static readonly HttpsPrefix = 'https:';
	private readonly onDidChangeEmitter = new Emitter<void>();
	readonly onDidChange: BaseEvent<void> = this.onDidChangeEmitter.event;
	private hasCertError = false;

	setCertificateError(certError: IBrowserViewCertificateError | undefined): void {
		const next = !!certError;
		if (this.hasCertError === next) {
			return;
		}
		this.hasCertError = next;
		this.onDidChangeEmitter.fire();
	}

	render(url: string, container: HTMLElement): boolean {
		if (!this.hasCertError || !url.startsWith(CertUrlRenderer.HttpsPrefix)) {
			return false;
		}

		const protocol = $('span.browser-url-display-protocol-bad');
		protocol.textContent = CertUrlRenderer.HttpsPrefix;
		const rest = $('span');
		rest.textContent = url.slice(CertUrlRenderer.HttpsPrefix.length);
		container.append(protocol, rest);
		return true;
	}

	dispose(): void {
		this.onDidChangeEmitter.dispose();
	}
}

class SiteInfoWidget extends Disposable {
	private readonly container = $('.browser-site-info-container');
	private readonly indicator = $('.browser-site-info-indicator');
	private certError: IBrowserViewCertificateError | undefined;

	constructor(
		parent: HTMLElement,
		private readonly editor: BrowserEditor,
		private readonly hoverService: IHoverService,
	) {
		super();
		this.container.style.display = 'none';
		this.indicator.tabIndex = 0;
		this.indicator.setAttribute('role', 'button');
		this.indicator.setAttribute('aria-label', localize('browser.notSecure', "Not Secure"));
		this.indicator.appendChild(renderIcon(Codicon.workspaceUntrusted));
		this.container.appendChild(this.indicator);
		parent.appendChild(this.container);

		this._register(addDisposableListener(this.indicator, EventType.CLICK, () => this.showHover()));
		this._register(addDisposableListener(this.indicator, EventType.KEY_DOWN, event => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				this.showHover();
			}
		}));
	}

	setCertificateError(certError: IBrowserViewCertificateError | undefined): void {
		this.certError = certError;
		this.container.style.display = certError ? '' : 'none';
	}

	private showHover(): void {
		const certError = this.certError;
		if (!certError) {
			return;
		}

		const content = $('.browser-site-info-hover-content');
		const heading = $('.browser-site-info-hover-heading');
		heading.textContent = localize('browser.certHoverHeading', "Certificate Not Trusted");
		const detail = $('.browser-site-info-hover-detail');
		detail.textContent = localize('browser.certHoverDetail1', "Your connection to this site is not secure.");
		content.append(heading, detail);

		if (certError.hasTrustedException) {
			const trustedDetail = $('.browser-site-info-hover-detail');
			trustedDetail.textContent = localize(
				'browser.certHoverDetail2',
				"You previously chose to proceed to '{0}' despite a certificate error ({1}).",
				certError.host,
				certError.error,
			);
			const revoke = $<HTMLAnchorElement>('a.browser-site-info-hover-revoke');
			revoke.textContent = localize('browser.certRevoke', "Revoke and Close");
			revoke.setAttribute('role', 'button');
			revoke.tabIndex = 0;
			revoke.href = '#';
			const revokeTrust = (event: globalThis.Event) => {
				event.preventDefault();
				void this.editor.model?.untrustCertificate(certError.host, certError.fingerprint);
			};
			revoke.addEventListener('click', revokeTrust);
			revoke.addEventListener('keydown', event => {
				if (event.key === 'Enter' || event.key === ' ') {
					revokeTrust(event);
				}
			});
			content.append(trustedDetail, revoke);
		}

		this.hoverService.showInstantHover(this.indicator, content, true);
	}
}

BrowserEditor.registerContribution(BrowserEditorErrorFeatures);
