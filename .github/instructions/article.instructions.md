# Articles for nature journals

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

## nature news,opinions article list
- article identifier includes article type, datetime
- article magazine title
- teaser

- maybe should print the page as to the PDF.


## RSS feed

maybe you can use this to download PDF, but it cannot be used to get the proper article orders follow the website.

# Attention

- the article list contains many articles, one list item corresponse to  one article page, and one article page contain only one article detail. maybe you can call the list as home page which contains many article page. 
- so you need to divide into two parts, one is get the article list, and the other is get the article detail. includes the nature news, opinions and other nature journals from articles.

above almost include the nature, without the scicence, acs, wiley, springer, elsevier, taylorfrancis, mdpi, frontiers, plos, bmj, jmir, jamanetwork, thelancet, nejm, cell, biorxiv, medrxiv and so on.