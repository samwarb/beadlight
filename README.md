# Beadlight

> Analytics currently loads by default and can be rejected through the site's privacy controls. Review this behaviour against UK cookie-consent requirements before production use.

Static GitHub Pages site for `beadlight.app`.

## Blog publishing

- Public index: `https://beadlight.app/blog/`
- Browser studio: `https://beadlight.app/admin/blog/`
- Post source: `_posts/YYYY-MM-DD-slug.md`
- Blog images: `assets/blog/`
- Post layout: `_layouts/blog-post.html`

The studio writes Markdown and optimised images directly to this repository. On first use, choose **Sign In Using Access Token** and create a short-lived fine-grained GitHub token restricted to `samwarb/beadlight` with only **Contents: read and write**. Never commit a token or reuse the browser token for an AI agent.

Daily agents must follow `BLOG_AGENT_GUIDE.md`, work on a reviewable branch, and open a pull request. Pull requests check post metadata, paths, unsafe content and the GitHub Pages build. The production Pages workflow repeats those checks and only deploys `main` when they pass, including posts saved through the browser studio.

## GitHub Pages

- Repository: `samwarb/beadlight`
- Source: GitHub Actions via `.github/workflows/deploy-pages.yml` from `main`
- Custom domain: `beadlight.app`

## DNS

In IONOS, point the apex domain to GitHub Pages:

```text
Type: A      Host/name: @      Target/value: 185.199.108.153
Type: A      Host/name: @      Target/value: 185.199.109.153
Type: A      Host/name: @      Target/value: 185.199.110.153
Type: A      Host/name: @      Target/value: 185.199.111.153
Type: CNAME  Host/name: www    Target/value: samwarb.github.io
```
