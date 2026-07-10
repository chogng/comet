# Nature

maybe check this string in HTML？
> li
> a
> ul

## Article list

An article list, such as the one on `Nature Communications`, includes the following fields:

- Explore content
- Article type
- Datetime or published time
- Article title
- Article description
- Author list (simple, usually only the former 2 authors and the last author are displayed)
- Image (if exist)

### Explore content structure example

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

- Videos
- Collections
- Subjects

include 7 fields. `Explore content` and `Article type` contain multiple items, so consider introducing an `ExploreContentItem` interface:

The website uses `href` values for links rather than `url` values, so decide which property name best matches the data source.

## Article Detail

This article page includes the following fields (article-header):
- article identifier includes article type, if oa, and published time
- article title
- author list (detailed, include which author is corresponding author, the corresponding author has the field `data-corresp-id = "c1/c2"` in HTML)
- journal details includes journal title/link, volume, article number, articlepublication year and cite this article (link)

(article-body):
- article abstract

- href to download PDF if available (href = "/articles/s41586-023-06461-0.pdf")

## nature news,opinions article list
for the explore content of news, opinions, the article list structure is different to other articles, so need to use the new parser
- article title
- article description
- article type
- datetime
- image

## Nature News and Opinion article detail
- article identifier includes article type, datetime
- article magazine title
- teaser

- maybe should print the page as to the PDF.


## RSS feed

maybe you can use this to download PDF, but it cannot be used to get the proper article orders follow the website.

## Attention

- the article list contains many articles, one list item corresponse to  one article page, and one article page contain only one article detail. maybe you can call the list as home page which contains many article page. 
- so you need to divide into two parts, one is get the article list, and the other is get the article detail. includes the nature news, opinions and other nature journals from articles.

The remaining publishers still include ACS, Wiley, Springer, Elsevier, Taylor & Francis, MDPI, Frontiers, PLOS, BMJ, JMIR, JAMA Network, The Lancet, NEJM, Cell, bioRxiv, medRxiv, and others.

# Science

Science-family journals expose a journal home page and two article-list sources:

- Current Issue
- First Release papers

`Current Issue` and `First Release` are separate `ArticleListSource` values. A source with no articles returns an empty result; it is not omitted from the model merely because it usually contains few articles.

The Current Issue page has the following logical structure:

```text
Journal
└── ArticleListSource
    └── Issue
        └── Section
            └── ArticleListItem
```

Issue metadata can include volume, issue number, publication date, and canonical issue URL.

A section is a dynamic group rendered by the Current Issue page. Its meaning depends on the journal:

- Science uses sections such as Commentary, News, and Research.
- Science Advances uses subject-oriented sections such as Focus, Neuroscience, and Social and Interdisciplinary Sciences and Public Health.

Do not treat a section title as an article type. Science can render a separate article type inside an article card, such as Expert Voices or Perspectives. Science Advances can render an article type and a subject on the article detail page, such as Research Article and Materials Science.

## Article list for Science Advances

- issue metadata: volume, issue number, publication date, and canonical issue URL
- section title
- article title
- author list, which may be truncated
- published time
- access status or OA indicator
- description, if available
- abstract, only when abstract content is available in the list DOM; the Abstract control alone is not an abstract
- PDF URL, if available

The description and abstract are separate fields. Do not use the description as an abstract when the abstract is absent.

![Science Advances Current Issue](image-2.png)
![Science Advances sections and article cards](image-1.png)

## Article list for Science

- issue metadata: volume, issue number, publication date, and canonical issue URL
- section title
- article type, if displayed separately inside the article card
- article title
- author list, which may be truncated
- published time
- page range, if available
- access status or OA indicator
- description, if available
- abstract, only when abstract content is available in the list DOM
- PDF URL, if available
- related article, if available

A related article is a nested relationship of the containing article card, not another top-level item in the current section. Related article fields can include:

- relation label, such as Related Research Article
- URL
- article type
- article title
- simple author list
- journal title
- published time

![Science Current Issue sections, article types, and related articles](image-3.png)

## Article detail for Science and Science Advances

Science and Science Advances article detail pages share the following base fields:

- access status or OA indicator
- article type
- subject or discipline, if available
- article title
- complete author list
- journal title
- published time
- volume, issue, and page range, if available
- DOI, if available
- cite URL
- PDF URL, if available
- Editor's Summary, if available
- abstract, if available

An author link such as `href="#con3"` does not by itself identify a corresponding author. Only set corresponding-author status when the HTML contains an explicit semantic marker. Otherwise, keep the status unknown rather than setting it to `false` or inferring it from the anchor number.

The two journals may share a detail parser only when HTML fixtures confirm that their main structures and matching conditions are the same. Shared fields alone are not sufficient evidence that they use the same parser.

![Science Advances article detail](image.png)
