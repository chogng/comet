/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { ButtonView } from 'cs/base/browser/ui/button/button';
import { renderIcon } from 'cs/base/browser/ui/iconLabel/iconLabels';
import { Codicon } from 'cs/base/common/codicons';
import { DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import type { IBrowserViewCertificateError, IBrowserViewLoadError } from 'cs/platform/browserView/common/browserView';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import {
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	type IBrowserEditorWidget,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';

class BrowserEditorErrorFeatures extends BrowserEditorContribution {
	private readonly element = $('.browser-error-container');
	private readonly certActions = this._register(new MutableDisposable<DisposableStore>());
	private readonly contentWidget: IBrowserEditorWidget;

	constructor(editor: BrowserEditor) {
		super(editor);
		this.element.style.display = 'none';
		this.contentWidget = { location: BrowserWidgetLocation.ContentArea, element: this.element, order: 300 };
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [this.contentWidget];
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		store.add(model.onDidChangeLoadingState(() => this.updateError()));
		this.updateError();
	}

	override onModelDetached(): void {
		this.clearContent();
		this.element.style.display = 'none';
	}

	private updateError(): void {
		const model = this.editor.model;
		if (!model) {
			return;
		}

		const error = model.error;
		if (!error) {
			this.clearContent();
			this.element.style.display = 'none';
			return;
		}

		this.clearContent();
		this.element.appendChild(this.renderError(model, error));
		this.element.style.display = '';
	}

	private clearContent(): void {
		this.certActions.clear();
		this.element.replaceChildren();
	}

	private renderError(model: IBrowserViewModel, error: IBrowserViewLoadError): HTMLElement {
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

		const remoteWarning = model.isRemoteSession && (error.errorCode === -111 || error.errorCode === -324)
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
			content.append(this.renderCertDetails(error.certificateError), this.renderCertActions(model, error.certificateError));
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

	private renderCertActions(model: IBrowserViewModel, certError: IBrowserViewCertificateError): HTMLElement {
		const container = $('.browser-cert-action');
		const store = new DisposableStore();
		this.certActions.value = store;

		const primaryLabel = model.canGoBack
			? localize('browser.certGoBack', "Go Back")
			: localize('browser.certReload', "Reload");
		const primaryButton = store.add(new ButtonView({
			variant: 'secondary',
			content: primaryLabel,
				onClick: () => {
					if (model.canGoBack) {
						void model.goBack();
					} else {
						void model.reload();
				}
			},
		}));

		const proceedButton = store.add(new ButtonView({
			variant: 'primary',
			content: localize('browser.certProceed', "Proceed anyway (unsafe)"),
			onClick: () => {
				void model.trustCertificate(certError.host, certError.fingerprint);
			},
		}));

		container.append(primaryButton.getElement(), proceedButton.getElement());
		return container;
	}
}

function formatCertDate(epoch: number): string {
	return new Date(epoch * 1000).toLocaleDateString();
}

BrowserEditor.registerContribution(BrowserEditorErrorFeatures);
