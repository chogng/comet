---
description: Durable architecture and parsing rules for Article Fetch.
applyTo: "{src/cs/workbench/services/fetch/**,src/cs/workbench/contrib/fetch/**,src/cs/workbench/contrib/chat/**,src/cs/workbench/browser/documentActionsModel.ts,src/cs/workbench/contrib/translation/**,src/cs/sessions/browser/sessionsWorkbench.ts,src/cs/sessions/contrib/providers/agentHost/**}"
---

# Article Fetch

Read `src/cs/sessions/ATTACHMENTS.md` before changing Article attachment,
content extraction, publication, or Chat submission behavior. Read
`src/cs/sessions/TOOLS.md` and `src/cs/sessions/CLIENT_TOOLS.md` before changing
lazy Article or Browser content Tools and their interaction targets.

## Service ownership

`IFetchService` is the single owner of journal catalogs, source pages, article
records, article details, load state, refresh generations, and shared request
coordination. Views query it by stable ID and subscribe to relevant changes;
they do not maintain synchronized article collections or detail caches.
Fetch commits data and load state before publishing a change event. A failing
observer is reported as an unexpected error without changing the committed
operation result or preventing later observers from receiving the event.

Navigation state such as an active journal, source, or article belongs to the
view that renders it. Chat-specific Article selection belongs to Article
presentation state keyed by `chatResource`; it does not enter Chat's generic
attachment or interaction-target model until an explicit Feature action binds
one. Sessions, the product shell, downloads, exports, and knowledge-base
services do not own copies of those states.

Downstream operations receive an `ArticleId` snapshot and resolve the required
`ArticleRecord` or `ArticleDetail` through `IFetchService` at operation start.
Cross-process calls use feature-specific DTOs; `ArticleId` and Fetch domain
objects do not move to electron-main for later lookup.

`ArticleDetail` is structured Article detail and metadata. It is not a contract
for the complete article body. Complete readable content is produced by a
feature-owned content extraction capability using an explicitly addressed
Article or Browser resource. Content extraction is independent of any Agent
implementation.

Article checkbox state is Feature selection, not Chat attachment state.
Download and export consume an immutable `ArticleId` selection snapshot without
adding Chat context. An explicit Add Selected Articles to Chat action consumes
the same selection snapshot and creates Article attachments through Chat's
common addressed attachment API. Normal Chat submission never turns Article
selection into attachments implicitly. A Summarize Selected Articles action,
when provided, is an explicit compound Feature action rather than special
behavior in general Chat submission. It first adds the captured selection
through the common attachment API and then invokes the normal Chat submission
path; preparation failure leaves those visible composer attachments in place.

Article result presentation renders typed items keyed by `ArticleId`. It does
not render an untyped Markdown list and recover Article ownership by matching
`li` count, DOM order, CSS classes, or link text. Checkbox and open-link actions
receive the exact `ArticleId` directly. An Article open action originating in
Chat also carries the addressed `chatResource`, Article URI, and Article ID so
the Editor Browser can establish the typed interaction-target relationship.

The registered Article attachment type owns validation, presentation,
persistence, and resolution. Its resolver resolves only an explicitly attached
Article through `IFetchService` and constructs normalized Article metadata plus
a stable, version-addressed content reference. The content owner materializes a
bounded read handle for the addressed request. If the full-content extractor or
the referenced version is unavailable, preparation fails; the resolver never
substitutes `ArticleDetail`, a list summary, or a currently active Browser page.
The addressed Agent materializes that exact reference through the Host
content-resource protocol while converting the attachment into SDK input. This
read is not a Tool call and does not depend on a model decision. Agent
implementations do not scrape Article pages or treat `ArticleDetail` as full
text. Chat and Sessions core do not interpret Article attachment state. The
same extractor service may implement lazy readable-content execution, but its
Client Tool contract remains separate from attachment publication and reads.

Opening an Article link from an addressed Chat in the Editor Browser may bind
the resulting exact Browser document target to that same Chat input. This
creates no attachment and extracts no body. If the user asks about the opened
article, the Agent can invoke the independently registered readable-content
Client Tool through a model-facing function call; extraction happens only for
that call. Opening the same content without an addressed Chat relationship
requires an explicit Use in Chat action to bind the target, and general send
never scans the active Editor.

## Runtime boundary

The environment-neutral `FetchService` runs in browser and owns Fetch domain
state, load state, request coordination, and Provider resolution. Desktop
Provider, Parser, and page-session implementations run in electron-browser,
where they can use BrowserView and Playwright services. A target without a
registered Provider still uses the same real domain service; an unavailable
Provider is an explicit registry error.

Page acquisition uses `IPlaywrightService.captureSnapshot()` and a typed
page-session ownership contract. Fetch does not expose a parallel BrowserView
DOM API, access a raw Playwright Page, or implement a private Playwright
facade.

Providers register descriptors and constructors through the Fetch registry.
The registry rejects duplicate IDs, and registrations are disposable. Parser
resolution requires exactly one match; there is no default parser or priority
fallback.

## Provider parsing

Provider parsers preserve the distinction between list discovery, list pages,
article identity, and article details:

```text
JournalDescriptor
└── ArticleListSourceGroup?
    └── ArticleListSource
        └── ArticlePage
            └── ArticleGroup?
                └── ArticleListItem
                    └── ArticleRecord
                        └── ArticleDetail
```

A list item identifies one article but is not its detail record. List parsers do
not manufacture detail fields, and detail parsers do not determine list order.
Optional values remain absent when the page provides no evidence. Parser
sharing requires fixtures demonstrating the same DOM structure and matching
conditions; similar output fields alone are insufficient.

## Nature family

### Catalog discovery

Nature-family discovery maps the site's dynamic classification into source
groups and sources:

```text
Explore content → ArticleListSourceGroup
Article type    → ArticleListSource
```

Examples include:

- Research articles
  - Article
  - Matters Arising
  - Registered Report
- Reviews & Analysis
  - Review Article
  - Perspective
- News & Comment
  - Comment
  - Correspondence
  - Editorial
  - Poster
  - Q&A

These values are parsed from the current catalog. They are not a closed public
enum and are not hardcoded into `JournalDescriptor`.

### Article lists

A Nature list item may provide:

- article type;
- published time;
- title and description;
- a truncated author list;
- image and canonical article link;
- access status when explicitly present.

Links use normalized URI fields in the provider model even when the source DOM
attribute is `href`.

Nature News and Opinion pages use a distinct list structure. Their dedicated
list parser still returns the common `ArticlePage` and `ArticleListItem`
contracts; it does not introduce a public News/Opinion article kind.

### Article details

A Nature detail may provide article type, access status, publication time,
title, complete authors, corresponding-author evidence, journal metadata,
volume, article number, citation link, abstract, and PDF URI.

Corresponding-author state is set only from an explicit semantic marker such as
the page's correspondence metadata. The parser does not infer it from author
position or anchor numbering.

## Science family

Science-family journals expose two independent sources:

- Current Issue;
- First Release.

An empty source remains a valid `ArticleListSource` with an empty page result.
It is not removed merely because it currently contains no articles.

The Current Issue structure is:

```text
Journal
└── ArticleListSource
    └── ArticlePage with IssueMetadata
        └── ArticleGroup
            └── ArticleListItem
```

Issue metadata can include volume, issue number, publication date, and canonical
issue URI. Section titles are dynamic `ArticleGroup` labels, not article types:

- Science can expose groups such as Commentary, News, and Research.
- Science Advances can expose subject-oriented groups such as Focus,
  Neuroscience, and Social and Interdisciplinary Sciences and Public Health.

### Science Advances list items

A list item may provide issue metadata, section title, article title, truncated
authors, publication time, access status, description, abstract, and PDF URI.
Description and abstract are separate optional fields. An Abstract control
without abstract content is not evidence of an abstract.

![Science Advances Current Issue](image-2.png)
![Science Advances sections and article cards](image-1.png)

### Science list items

A Science list item may additionally provide article type, page range, and a
related article. A related article is nested under its containing list item; it
is not another top-level item in the current group. Its fields can include
relation label, URI, article type, title, truncated authors, journal title, and
publication time.

![Science Current Issue sections, article types, and related articles](image-3.png)

### Science-family details

Science and Science Advances details may provide access status, article type,
subject, title, complete authors, publication metadata, DOI, citation URI, PDF
URI, Editor's Summary, and abstract.

An author link such as `href="#con3"` does not identify a corresponding author.
The value remains unknown unless an explicit semantic marker exists.

Science and Science Advances share a detail parser only when fixtures prove
that their main DOM structures and matching rules are equivalent.

![Science Advances article detail](image.png)

## RSS

RSS may supplement metadata or provide a PDF link when a provider contract
explicitly uses it. It is not the authority for website article ordering and
does not replace catalog or list-page parsing.

## Provider verification

- Add saved HTML fixtures for every supported page family.
- Test catalog discovery, empty sources, pagination, grouping, identity, and
  optional-field absence.
- Treat zero parser matches and multiple parser matches as explicit errors.
- Do not add a generic parser, priority fallback, or catch-and-try-next path.
- Do not execute scripts contained in captured HTML.
