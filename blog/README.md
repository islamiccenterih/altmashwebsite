# Daily SEO Blog — Altmash

Fully auto-publishing blog for https://mohdaltmash.com. A GitHub Action publishes one post every day around 00:30 IST, commits it, and Hostinger deploys the push.

## Categories (rotate daily)
Branding, Agency, Meta Ads, Google Ads, Sales, Personal Brand, Website Development, Shopify Development, Android App, WordPress Development, Digital Marketing, UGC Ads

## Writing quality
- **With `OPENAI_API_KEY`** (recommended): every article is written fresh by OpenAI — 1,600–2,200 words, its own keyword, headings, FAQ and examples.
- **Without it**: the local composer builds ~1,000–1,300 word articles from `data/playbooks.json`. Posts in the same category share a lot of wording, so this is a fallback only.

Setup: GitHub repo → Settings → Secrets and variables → Actions → **New repository secret** → `OPENAI_API_KEY`.
Optional: add a repository **variable** `OPENAI_MODEL` to change the model (default `gpt-4o-mini`).

## Commands
```bash
node scripts/generate-daily-blog.mjs                   # publish today's post
node scripts/generate-daily-blog.mjs --count 3 --force # publish several now
node scripts/generate-daily-blog.mjs --regenerate all  # rewrite every existing post (URLs stay the same)
node scripts/generate-daily-blog.mjs --regenerate 5    # rewrite the 5 oldest posts not yet AI-written
node scripts/generate-daily-blog.mjs --rebuild-only    # re-render pages, feeds and sitemap
```

To upgrade existing posts on GitHub after adding the key: Actions → **Daily SEO Blog** → **Run workflow** → type `all` in "regenerate".

## Files
- `data/posts.json` — post list (title, date, URL, meta)
- `data/content/<slug>.json` — full article content used to render each page
- `data/topics.json` — title ideas per category
- `data/playbooks.json` — category knowledge for the local composer
- `data/examples.json` — real brand examples woven into posts
- `<slug>/index.html` — generated page at `/blog/<slug>/`

## SEO included per post
- Unique title, meta description, keywords and canonical URL on mohdaltmash.com
- Open Graph and Twitter image
- BlogPosting, BreadcrumbList and FAQPage schema
- Key takeaways, table of contents, FAQ, related posts (internal links)
- Sitemap with `lastmod` + robots.txt

Submit `https://mohdaltmash.com/sitemap.xml` in Google Search Console.
