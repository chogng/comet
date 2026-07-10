# Fetch sites

`sites/` owns publisher-specific URL matching, listing extraction, article parsing, and page validation knowledge. Fetch scheduling, BrowserView presentation, Editor commands, and CDP integration stay outside this directory.

`fetchSitesProvider.ts` is the registry and resolution boundary:

```text
page URL
  → FetchSitesProvider
  → matching site provider
  → matching listing parser
```

The registry first selects one site provider by URL. It then selects a listing parser only from that provider's registered parsers. Parsers from one publisher must not match or handle another publisher's pages.

## Site provider responsibilities

A site provider declares:

- Its stable site ID.
- Which hostnames it owns.
- The listing candidate parsers registered for that site.
- Site-specific article parsing and validation functions when required.

Site providers do not create BrowserViews, open Editors, execute commands, or use CDP. Fetch presentation policy and page loading belong to the orchestration and page-session layers.

## Listing parser responsibilities

A listing parser may:

- Match a stable listing URL within its site.
- Extract ordered article candidates from the rendered document.
- Add date, article type, title, and scoring hints.
- Refine an extraction with an explicitly configured source.
- Resolve the next listing page.
- Evaluate a pagination stop condition.

URL normalization, same-site filtering, date-range filtering, candidate budgets, concurrent article fetches, article parsing, and final validation remain in the shared fetch pipeline.

Shared DOM helpers such as `listingCardDom.ts` and pagination helpers such as `dateSortedPagination.ts` contain reusable algorithms. They do not register themselves as site providers and do not select a site.

## Resolution rules

- Resolve providers from normalized URL hostnames and stable path signals.
- A preferred parser ID is valid only within the matched site provider.
- Do not keep a cross-site global parser lookup.
- Do not silently route an unmatched site or path through another site's parser.
- If generic site support is required, implement and register it as an explicit site provider.
- Preserve diagnostics so publisher layout changes can be investigated.
