# Beadlight daily blog agent guide

This repository publishes the Beadlight journal through GitHub Pages. Blog posts are Markdown files in `_posts/`; images live in `assets/blog/`. The browser publishing studio at `/admin/blog/` writes the same format.

## Default agent behaviour

Prepare one useful, original post on a reviewable `agent/blog-YYYY-MM-DD-short-topic` branch and open a pull request. Do not merge or publish unless Sam explicitly asks. Never overwrite another draft or reuse an image without checking its rights.

Before writing:

1. Pull the latest `main` branch and read the recent posts to avoid repetition.
2. Choose a narrow topic that helps someone pray, understand the Rosary, or use Beadlight.
3. Research any Catholic teaching, quotation, feast, date, product claim or current fact from reliable primary sources. Keep a source list in the pull-request description; do not add invented quotations or unsupported claims to the article.
4. Match the site voice: calm, practical, welcoming, reverent and concise. Beadlight supports prayer; it does not replace the Church, clergy or spiritual direction.

## Required post format

Name the file `_posts/YYYY-MM-DD-url-slug.md`. Use lowercase ASCII words separated by hyphens. Do not change the filename after a post is live because that changes its public URL.

Every file must start with this front matter:

```yaml
---
layout: blog-post
title: "A clear human title"
slug: a-stable-lowercase-url-name
description: "A specific 120–160 character summary for cards and search results."
date: 2026-08-11 09:00:00 +0100
author: Beadlight
category: Reflection
tags:
  - Rosary
  - Prayer habits
image: /assets/blog/descriptive-image-name.webp
image_alt: "A concise description of the meaningful visual content"
featured: false
published: true
---
```

The `slug` must exactly match the filename after its date prefix. It becomes the permanent public address at `/blog/slug/`, so never change it after publication. Allowed categories are `Prayer guide`, `Reflection`, `Beadlight news`, and `Faith and life`. If the post has no meaningful cover image, omit both `image` and `image_alt`. Set `published: false` while a post is still being reviewed.

## Article structure and formatting

- Begin with a short paragraph that answers why the topic matters.
- Use `##` for main sections and `###` only beneath a `##`; never add another `#` because the layout supplies the page title.
- Prefer short paragraphs, helpful lists, blockquotes used sparingly, and descriptive link text.
- Markdown supports bold, italics, links, numbered and bulleted lists, blockquotes, tables, code when genuinely relevant, and inline images.
- Use Markdown only. Raw HTML, Liquid tags and Kramdown attribute extensions are deliberately rejected by the validator.
- Use original wording. Short quotations must be accurately transcribed, attributed and linked to the primary source.
- End with one gentle, practical next step. Do not use manipulative urgency or make promises about spiritual outcomes.
- Product statements must match the current app and website. Do not invent features, prices, availability or endorsements.

## Images

- Put images in `assets/blog/` with a descriptive lowercase filename. Prefer WebP or JPEG for photographs and PNG only when transparency is needed.
- Optimise large images before committing. Aim for a landscape cover around 1600 × 900 pixels and under 1 MB.
- Only use images that Sam owns, that were generated for Beadlight, or that have a licence permitting this use. Record the source or generation note in the pull request.
- Every meaningful image needs useful alternative text. Do not begin alt text with “Image of”. Decorative images should not be inserted into the article body.

## Validation before handoff

1. Confirm the front matter is valid YAML and the filename date matches the `date` field.
2. Confirm all internal links and image paths exist, and all external links use HTTPS.
3. Build the site with GitHub Pages-compatible Jekyll when available; otherwise validate the HTML/Liquid structure and run the repository’s smoke checks.
4. Check the generated blog index, post page, mobile layout, canonical URL, Open Graph data and Article JSON-LD.
5. Run `git diff --check` and inspect the final diff for secrets, unsafe HTML, scripts, event-handler attributes and `javascript:` URLs.
6. In the pull request, state the topic, sources, image provenance, checks run and the exact public URL that will be created.

After Sam approves and merges the pull request, the Pages deployment runs the same validator again before anything can go live. Wait for GitHub Pages to report success, then verify the live post and blog index return HTTP 200 before calling the publication complete.
