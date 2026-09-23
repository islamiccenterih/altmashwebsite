# Daily SEO Blog — Altmash

Fully auto-publishing blog system.

## Categories (rotate daily)
Branding, Agency, Meta Ads, Google Ads, Sales, Personal Brand, Website Development, Shopify Development, Android App, WordPress Development, Digital Marketing, UGC Ads

## Generate a post now
```bash
node scripts/generate-daily-blog.mjs
node scripts/generate-daily-blog.mjs --force
node scripts/generate-daily-blog.mjs --count 12 --force
```

## Better AI writing (optional)
Set secret `OPENAI_API_KEY` in GitHub (or local env). Without it, the local SEO composer still publishes unique detailed posts.

## Daily automation
GitHub Action: `.github/workflows/daily-blog.yml` runs every day ~00:30 IST.

1. Push this repo to GitHub
2. (Optional) Repo → Settings → Secrets → `OPENAI_API_KEY`
3. Enable Actions
4. Update `blog/config.json` → `siteUrl` to your real domain
5. Submit `https://yourdomain.com/sitemap.xml` in Google Search Console

## SEO included per post
- Unique title, meta description, keywords
- Canonical URL
- Open Graph
- BlogPosting + FAQ schema
- Internal CTA to WhatsApp
- Sitemap + robots.txt updates
