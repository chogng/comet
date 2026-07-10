/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import type { FetchAccessGateReason } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';

export interface AccessGateDetectionContext {
	readonly bodyFound: boolean;
	readonly listingContentFound?: boolean;
}

function hasCloudflareChallenge(
	$: ReturnType<typeof load>,
	documentText: string,
) {
	const hasChallengeElement = $(
		'#challenge-running, #challenge-stage, .cf-challenge, .cf-turnstile, [data-cf-challenge], form[action*="/cdn-cgi/challenge-platform/"]',
	).length > 0;
	const hasChallengePlatform = $(
		'script[src*="/cdn-cgi/challenge-platform/"], iframe[src*="/cdn-cgi/challenge-platform/"]',
	).length > 0;
	const hasChallengeText =
		documentText.includes('checking your browser') ||
		documentText.includes('verify you are human') ||
		documentText.includes('performing security verification') ||
		(documentText.includes('cloudflare') && documentText.includes('ray id'));
	return hasChallengeElement || (hasChallengePlatform && hasChallengeText);
}

function isInstitutionalSsoPage(
	$: ReturnType<typeof load>,
	finalUrl: string,
) {
	let url: URL | null = null;
	try {
		url = new URL(finalUrl);
	} catch {
		url = null;
	}
	const locationText = `${url?.hostname ?? ''}${url?.pathname ?? ''}`.toLowerCase();
	const hasSsoLocation = /(?:shibboleth|openathens|saml|institutional[-_/]?login|\bsso\b|identity[-_.]?provider|\/idp\/)/i.test(locationText);
	const hasSsoForm = $('form[action*="saml" i], form[action*="shibboleth" i], input[name="SAMLRequest"], input[name="SAMLResponse"]').length > 0;
	return hasSsoLocation || hasSsoForm;
}

function isLoginPage(
	$: ReturnType<typeof load>,
	finalUrl: string,
	includeEmbeddedForm: boolean,
) {
	let pathname = '';
	try {
		pathname = new URL(finalUrl).pathname;
	} catch {
		pathname = '';
	}
	const hasAuthenticationPath = /\/(?:login|log-in|signin|sign-in|authenticate|authorization)(?:\/|$)/i.test(pathname);
	const hasPasswordForm = $('form input[type="password"], form[action*="login" i], form[action*="signin" i]').length > 0;
	return hasAuthenticationPath || (includeEmbeddedForm && hasPasswordForm);
}

function hasSubscriptionGate($: ReturnType<typeof load>) {
	return $(
		'[data-test*="paywall" i], [data-testid*="paywall" i], [class~="paywall" i], [id*="paywall" i], [data-test*="access-denied" i], [data-test*="subscription" i], .article-access-options, .purchase-access, .access-denied-content',
	).length > 0;
}

function hasManualChallenge($: ReturnType<typeof load>) {
	return $(
		'iframe[src*="recaptcha" i], iframe[src*="hcaptcha" i], .g-recaptcha, .h-captcha, [data-sitekey][class*="captcha" i], [data-sitekey][class*="turnstile" i]',
	).length > 0;
}

export function detectAccessGate(
	document: FetchTargetDocument,
	context: AccessGateDetectionContext,
): FetchAccessGateReason | null {
	const $ = load(document.html);
	const documentText = cleanText($('body').text()).toLowerCase();

	if (!context.bodyFound && hasCloudflareChallenge($, documentText)) {
		return 'cloudflareChallenge';
	}
	if (!context.bodyFound && isInstitutionalSsoPage($, document.finalUrl)) {
		return 'institutionalSso';
	}
	if (
		!context.bodyFound &&
		isLoginPage($, document.finalUrl, !context.listingContentFound)
	) {
		return 'loginRequired';
	}
	if (!context.bodyFound && hasSubscriptionGate($)) {
		return 'subscriptionGate';
	}
	if (!context.bodyFound && !context.listingContentFound && hasManualChallenge($)) {
		return 'manualInteractionRequired';
	}

	return null;
}
