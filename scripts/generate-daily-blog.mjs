#!/usr/bin/env node
/**
 * Daily SEO blog generator for Altmash.
 * Usage:
 *   node scripts/generate-daily-blog.mjs
 *   node scripts/generate-daily-blog.mjs --count 3
 *   OPENAI_API_KEY=... node scripts/generate-daily-blog.mjs
 *
 * Fully auto-publishes HTML posts + updates posts.json, sitemap.xml, robots.txt
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const blogDir = path.join(root, "blog");
const postsDir = path.join(blogDir, "posts");
const dataDir = path.join(blogDir, "data");

const SITE_NAV = [
  { label: "About", href: "/#about" },
  { label: "Work", href: "/#work" },
  { label: "Selected", href: "/#selected" },
  { label: "Brands", href: "/#brands" },
  { label: "Cases", href: "/#cases" },
  { label: "Voice", href: "/#testimonials" },
  { label: "Wins", href: "/#achievements" },
  { label: "Path", href: "/#background" },
  { label: "Blog", href: "/blog/" },
  { label: "Connect", href: "/#connect" },
];

const config = readJson(path.join(blogDir, "config.json"));
const topics = readJson(path.join(dataDir, "topics.json"));
const examples = readJson(path.join(dataDir, "examples.json"));
const postsPath = path.join(dataDir, "posts.json");
const statePath = path.join(dataDir, "state.json");

const posts = exists(postsPath) ? readJson(postsPath) : [];
const state = exists(statePath)
  ? readJson(statePath)
  : { categoryIndex: 0, usedTitles: [], usedExamples: [], lastRun: null };

const args = process.argv.slice(2);
const count = Math.max(1, Number(args.includes("--count") ? args[args.indexOf("--count") + 1] : 1) || 1);
const force = args.includes("--force");
const rebuildOnly = args.includes("--rebuild-only");

fs.mkdirSync(blogDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

if (rebuildOnly) {
  migrateLegacyPosts();
  rewriteAllPostPages();
  writeFeeds();
  console.log(`Rebuilt feeds + pages. Homepage: ${Math.min(3, posts.length)} · Archive: ${Math.max(0, posts.length - 3)}`);
  process.exit(0);
}

for (let i = 0; i < count; i += 1) {
  // eslint-disable-next-line no-await-in-loop
  await publishOne(i);
}

writeJson(postsPath, posts);
writeJson(statePath, state);
writeFeeds();
console.log(`Published ${count} post(s). Total posts: ${posts.length}`);

function writeFeeds() {
  writeSitemap();
  writeRobots();
  writeBlogIndex();
  syncHomepagePosts();
}

async function publishOne(offset = 0) {
  const today = dateInTz(config.timezone, 0);
  const dateKey = today.toISOString().slice(0, 10);

  if (!force && state.lastRun === dateKey && offset === 0 && count === 1) {
    console.log(`Already published for ${dateKey}. Use --force to republish.`);
    return;
  }

  const category = nextCategory();
  const title = nextTitle(category);
  const pickedExamples = pickExamples(2);
  const slug = slugify(`${dateKey}-${title}`).slice(0, 90);
  const excerpt = buildExcerpt(category, title);
  const keywords = buildKeywords(category, title);
  const body = await buildBody({ category, title, examples: pickedExamples, dateKey });
  const faq = buildFaq(category, title);
  const readMinutes = Math.max(6, Math.round(body.join(" ").split(/\s+/).length / 180));
  const iso = today.toISOString();

  const post = {
    id: slug,
    slug,
    title,
    excerpt,
    category,
    date: formatDisplayDate(today),
    dateIso: iso.slice(0, 10),
    readTime: `${readMinutes} min read`,
    keywords,
    url: `blog/${slug}/`,
    examples: pickedExamples.map((e) => e.id),
  };

  const html = renderPostHtml(post, body, faq);
  const outDir = path.join(blogDir, slug);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  // Remove legacy flat file if present
  const legacy = path.join(postsDir, `${slug}.html`);
  if (exists(legacy)) fs.unlinkSync(legacy);

  posts.unshift(post);
  state.usedTitles = uniquePush(state.usedTitles, [title], 120);
  state.usedExamples = uniquePush(
    state.usedExamples,
    pickedExamples.map((e) => e.id),
    80
  );
  if (offset === 0) state.lastRun = dateKey;

  console.log(`✓ ${category} — ${title}`);
}

function nextCategory() {
  const list = config.categories;
  const category = list[state.categoryIndex % list.length];
  state.categoryIndex = (state.categoryIndex + 1) % list.length;
  return category;
}

function nextTitle(category) {
  const pool = topics[category] || [`${category} strategies Altmash uses for growing brands`];
  const unused = pool.filter((t) => !state.usedTitles.includes(t));
  const source = unused.length ? unused : pool;
  return source[Math.floor(hash(`${state.categoryIndex}-${Date.now()}-${category}`) % source.length)];
}

function pickExamples(n = 2) {
  const fresh = examples.filter((e) => !state.usedExamples.includes(e.id));
  const pool = fresh.length >= n ? fresh : examples;
  const shuffled = [...pool].sort(
    (a, b) => hash(a.id + state.categoryIndex) - hash(b.id + state.categoryIndex)
  );
  // Prefer not always using the famous three together
  const preferred = shuffled.filter(
    (e) => !["insane-look-drop", "wolf-cloth-seasonal", "islamic-center-hub"].includes(e.id)
  );
  const primary = preferred.length >= n ? preferred : shuffled;
  return primary.slice(0, n);
}

async function buildBody({ category, title, examples, dateKey }) {
  if (process.env.OPENAI_API_KEY) {
    try {
      const ai = await generateWithOpenAI({ category, title, examples, dateKey });
      if (ai?.length) return ai;
    } catch (error) {
      console.warn("OpenAI failed, using local composer:", error.message);
    }
  }
  return composeLocal({ category, title, examples });
}

function composeLocal({ category, title, examples }) {
  const ex1 = examples[0];
  const ex2 = examples[1] || examples[0];
  const openers = [
    `${title} is not a slogan for Altmash — it is an operating problem. Since freelancing in 2020 and founding a branding & marketing agency in 2021, I have watched brands spend on attention before they earned clarity.`,
    `I am Altmash — business owner and developer. When founders ask me about ${category.toLowerCase()}, I start with systems, not trends. ${title.replace(/\?$/, "")} only works when the brand, the offer, and the channel agree.`,
    `After launching a clothing brand in 2023 and getting nominated for the Dubai Business Award in 2024, one lesson keeps repeating: ${category} fails when it is treated as a one-week campaign instead of a weekly craft.`,
  ];
  const middle = [
    `First, define the job of ${category.toLowerCase()} in one sentence. If the team cannot say who it is for and what action should happen next, ads and pages will fight each other.`,
    `Second, align proof with promise. ${ex1.text}`,
    `Third, instrument the loop: creative → landing → conversation → payment. ${ex2.text}`,
    `For Indian and global buyers, trust is local and speed is global. Your WhatsApp reply time, your page speed, and your brand voice are all part of ${category.toLowerCase()}.`,
    `Altmash’s rule is ownership after launch. Month two is where most brands quietly die — creatives get stale, offers drift, and nobody owns the calendar.`,
  ];
  const categoryBlocks = categoryBlocksFor(category);
  const closer = [
    `If you are evaluating ${category.toLowerCase()} partners, ask who stays after the first publish. Packaging a deck is easy. Running the system is the work.`,
    `Build for ranking and revenue together: clear titles, useful sections, internal links to real projects, and pages that load fast on mobile. SEO without conversion is vanity; conversion without discoverability is fragile.`,
    `I am Altmash. I build brands end to end — website, identity, sales systems, Meta Ads, Google Ads, and the ops that keep them growing. If you want the same standard for your brand, start a conversation and bring a clear offer.`,
  ];
  return [pick(openers), ...middle, ...categoryBlocks, ...closer];
}

function categoryBlocksFor(category) {
  const map = {
    Branding: [
      "Brand systems need tokens: voice, color, photography rules, and offer language that sales and ads can reuse without improvising.",
      "A redesign without positioning is expensive decoration. Fix the promise, then dress it.",
    ],
    Agency: [
      "Agencies create value when they own outcomes: creative shipped, pipeline quality, and weekly learning — not slide volume.",
      "Retainers should include a scoreboard. If nobody reviews numbers weekly, you do not have an agency relationship — you have a vendor habit.",
    ],
    "Meta Ads": [
      "Meta rewards creative diversity and clean events. Broad targeting can work — weak offers cannot.",
      "Test hooks in batches, kill losers in 48–72 hours, and protect margin with placement and frequency discipline.",
    ],
    "Google Ads": [
      "Google intent is a gift only if the landing page matches the query. Mismatch is the silent budget leak.",
      "Separate brand, competitor, and category themes. Let Search teach you language; let Performance Max amplify clean assets.",
    ],
    Sales: [
      "Sales is offer design plus speed. Discounts are a lazy substitute for clarity.",
      "Discovery questions beat monologues. Especially on WhatsApp, the first useful reply wins trust.",
    ],
    "Personal Brand": [
      "Personal brands compound when they publish receipts: process, decisions, and results — not empty motivation.",
      "Your website should be the home base. Social platforms are distribution, not the archive of record.",
    ],
    "Website Development": [
      "Websites should be built as conversion products: hierarchy, speed, accessibility, and a single primary CTA per view.",
      "SEO structure starts with URLs and headings. Pretty animations cannot rescue a confused sitemap.",
    ],
    "Shopify Development": [
      "Shopify wins when collections, tags, and product templates are intentional. Feed quality for ads starts in the catalog.",
      "Reduce apps that fight each other. One clean upsell path beats five overlapping widgets.",
    ],
    "Android App": [
      "Apps must honor the ad promise in the first session. Onboarding is marketing, not an afterthought.",
      "Measure retention cohorts before scaling install campaigns. Cheap installs with empty sessions are expensive.",
    ],
    "WordPress Development": [
      "WordPress SEO thrives on clean taxonomy, fast themes, and editorial discipline — not plugin piles.",
      "Give marketing a safe editing path so content ships without breaking Core Web Vitals.",
    ],
    "Digital Marketing": [
      "Digital marketing is a loop across brand, content, paid, CRM, and sales — not a single channel bet.",
      "Pick fewer KPIs. Revenue, CAC, and retention beat vanity reach every time.",
    ],
    "UGC Ads": [
      "UGC works because it looks like proof. Brief creators on the offer and objection — not on perfect lighting.",
      "Build a clip library so testing never waits on a studio day. Volume with authenticity beats one expensive film.",
    ],
  };
  return map[category] || [
    `${category} improves when strategy and execution sit with the same owner.`,
    "Document the system so the brand does not depend on one lucky campaign.",
  ];
}

async function generateWithOpenAI({ category, title, examples, dateKey }) {
  const prompt = `You are Altmash, Business Owner & Developer (freelancer since 2020, branding & marketing agency since 2021, clothing brand since 2023, Dubai Business Award nominee 2024).
Write a detailed SEO blog post body as JSON array of 9 to 12 plain paragraphs (no markdown).
Topic title: ${title}
Category: ${category}
Date: ${dateKey}
Include the name Altmash naturally 2-4 times.
Use these real-world examples (do not force Insane Look / Wolf Cloth / Islamic Center unless listed):
${examples.map((e) => `- ${e.text}`).join("\n")}
Tone: premium operator, clear, practical, India + global context. No fluff. No bullet symbols inside paragraphs.
Return ONLY a JSON array of strings.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.8,
      messages: [
        { role: "system", content: "Return only valid JSON arrays of paragraph strings." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  const parsed = JSON.parse(text.replace(/^```json\n?|\n?```$/g, ""));
  if (!Array.isArray(parsed)) throw new Error("Invalid AI payload");
  return parsed.map(String);
}

function buildExcerpt(category, title) {
  return `${title} — practical ${category.toLowerCase()} guidance from Altmash on building brands, systems, and growth that compound.`;
}

function buildKeywords(category, title) {
  return [
    "Altmash",
    category,
    ...title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .slice(0, 8),
    "digital marketing",
    "branding agency",
    "India",
  ].join(", ");
}

function buildFaq(category, title) {
  return [
    {
      q: `What does Altmash recommend first for ${category}?`,
      a: `Start with clarity of offer and audience, then build ${category.toLowerCase()} systems that sales and ads can reuse weekly — not one-off campaigns.`,
    },
    {
      q: `How is this approach different from generic ${category.toLowerCase()} tips?`,
      a: `It is written from operator experience: freelancing since 2020, agency ownership since 2021, clothing brands since 2023, and ongoing brand management across web and paid media.`,
    },
    {
      q: `Can these ideas help SEO as well as paid growth?`,
      a: `Yes. Clear structure, useful depth, and conversion-focused pages help both organic ranking and paid landing-page performance.`,
    },
  ];
}

function renderSiteChrome({ active = "" } = {}) {
  const desk = SITE_NAV.map((item) => {
    const current = item.label === active ? ' aria-current="page"' : "";
    return `<a href="${escapeHtml(item.href)}"${current}>${escapeHtml(item.label)}</a>`;
  }).join("");
  const mobile = SITE_NAV.map(
    (item, index) =>
      `<a href="${escapeHtml(item.href)}"><em>${String(index + 1).padStart(2, "0")}</em>${escapeHtml(item.label)}</a>`
  ).join("");

  return `
  <header class="nav">
    <a class="brand" href="/">
      <span>Altmash</span>
      <small>Owner · Operator</small>
    </a>
    <nav class="desk-nav" aria-label="Primary">${desk}</nav>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-menu">Menu</button>
  </header>
  <div class="menu" id="site-menu" aria-hidden="true">
    <nav aria-label="Mobile">${mobile}</nav>
  </div>`;
}

function renderPostHtml(post, body, faq) {
  const url = `${config.siteUrl.replace(/\/$/, "")}/${post.url.replace(/^\//, "")}`;
  const paragraphs = body.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n");
  const faqHtml = faq
    .map(
      (item) => `
      <div class="faq-item">
        <h3>${escapeHtml(item.q)}</h3>
        <p>${escapeHtml(item.a)}</p>
      </div>`
    )
    .join("");
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.dateIso,
    dateModified: post.dateIso,
    author: {
      "@type": "Person",
      name: config.author,
      url: config.siteUrl,
      sameAs: [config.instagram, config.whatsapp],
    },
    publisher: {
      "@type": "Person",
      name: config.author,
    },
    mainEntityOfPage: url,
    keywords: post.keywords,
    articleSection: post.category,
  };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(post.title)} | ${escapeHtml(config.author)}</title>
  <meta name="description" content="${escapeHtml(post.excerpt)}" />
  <meta name="keywords" content="${escapeHtml(post.keywords)}" />
  <meta name="author" content="${escapeHtml(config.author)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeHtml(url)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${escapeHtml(post.title)}" />
  <meta property="og:description" content="${escapeHtml(post.excerpt)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:site_name" content="${escapeHtml(config.siteName)}" />
  <meta property="article:published_time" content="${escapeHtml(post.dateIso)}" />
  <meta property="article:author" content="${escapeHtml(config.author)}" />
  <meta property="article:section" content="${escapeHtml(post.category)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(post.title)}" />
  <meta name="twitter:description" content="${escapeHtml(post.excerpt)}" />
  <meta name="theme-color" content="#070707" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/blog/blog.css" />
  <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
  <script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
</head>
<body class="blog-page">
  ${renderSiteChrome({ active: "Blog" })}
  <main class="blog-main">
    <article>
      <p class="blog-kicker">${escapeHtml(post.category)} · ${escapeHtml(post.date)} · ${escapeHtml(post.readTime)}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="blog-lead">${escapeHtml(post.excerpt)}</p>
      <p class="blog-byline">By <strong>${escapeHtml(config.author)}</strong> — ${escapeHtml(config.authorRole)}</p>
      <div class="blog-copy">
        ${paragraphs}
      </div>
      <section class="blog-faq">
        <h2>FAQ</h2>
        ${faqHtml}
      </section>
      <section class="blog-cta">
        <h2>Work with Altmash</h2>
        <p>Need branding, websites, Shopify, ads, or full brand management? Start on WhatsApp.</p>
        <a class="blog-btn" href="${escapeHtml(config.whatsapp)}" rel="noreferrer">Chat on WhatsApp</a>
      </section>
    </article>
  </main>
  <footer class="blog-foot">
    <span>© ${new Date().getFullYear()} ${escapeHtml(config.author)}</span>
    <a href="/blog/">All posts</a>
  </footer>
  <script src="/blog/blog-shell.js"></script>
</body>
</html>`;
}

function writeBlogIndex() {
  const latest = posts.slice(0, 3);
  const archive = posts.slice(3);

  const latestCards = latest
    .map(
      (post, index) => `
      <a class="blog-card blog-card-feature" href="/blog/${escapeHtml(post.slug)}/">
        <em>0${index + 1}</em>
        <small>${escapeHtml(post.category)} · ${escapeHtml(post.date)}</small>
        <h2>${escapeHtml(post.title)}</h2>
        <p>${escapeHtml(post.excerpt)}</p>
        <span>Read article →</span>
      </a>`
    )
    .join("");

  const archiveCards = archive.length
    ? archive
        .map(
          (post, index) => `
      <a class="blog-row" href="/blog/${escapeHtml(post.slug)}/">
        <b>${String(index + 1).padStart(2, "0")}</b>
        <div>
          <small>${escapeHtml(post.category)} · ${escapeHtml(post.date)} · ${escapeHtml(post.readTime)}</small>
          <h2>${escapeHtml(post.title)}</h2>
          <p>${escapeHtml(post.excerpt)}</p>
        </div>
        <span>Open →</span>
      </a>`
        )
        .join("")
    : `<p class="blog-empty">As newer notes land on the homepage, earlier articles will collect here.</p>`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>All Building Notes | Altmash Blog</title>
  <meta name="description" content="Full archive of Altmash building notes — branding, agency, Meta Ads, Google Ads, sales, Shopify, WordPress, Android, digital marketing, and UGC." />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${escapeHtml(config.siteUrl.replace(/\/$/, "") + "/blog/")}" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/blog/blog.css" />
</head>
<body class="blog-page">
  ${renderSiteChrome({ active: "Blog" })}
  <main class="blog-index">
    <section class="blog-hero-panel">
      <p class="blog-kicker">Building journal</p>
      <h1>Notes on building</h1>
      <p class="blog-lead">The homepage keeps the newest three. Everything older lives here — each note on its own page, SEO-ready.</p>
      <div class="blog-hero-meta">
        <span>${posts.length} published</span>
        <span>${archive.length} in archive</span>
        <span>Daily updates</span>
      </div>
    </section>

    <section class="blog-block">
      <div class="blog-block-head">
        <h2>On the homepage now</h2>
        <p>Latest three notes featured on the main site.</p>
      </div>
      <div class="blog-grid blog-grid-feature">${latestCards || `<p class="blog-empty">No posts yet.</p>`}</div>
    </section>

    <section class="blog-block" id="archive">
      <div class="blog-block-head">
        <h2>Earlier writing</h2>
        <p>When a fourth post publishes, the oldest homepage note moves here.</p>
      </div>
      <div class="blog-archive">${archiveCards}</div>
    </section>
  </main>
  <footer class="blog-foot">
    <span>© ${new Date().getFullYear()} Altmash</span>
    <a href="/">Back home</a>
  </footer>
  <script src="/blog/blog-shell.js"></script>
</body>
</html>`;
  fs.writeFileSync(path.join(blogDir, "index.html"), html, "utf8");
}

function writeSitemap() {
  const base = config.siteUrl.replace(/\/$/, "");
  const urls = ["", "blog/", ...posts.map((p) => p.url.replace(/^\//, ""))];
  const body = urls
    .map(
      (u) => `  <url>
    <loc>${base}/${u}</loc>
    <changefreq>${u.startsWith("blog/") && u !== "blog/" ? "weekly" : "daily"}</changefreq>
    <priority>${u === "" ? "1.0" : u === "blog/" ? "0.9" : "0.8"}</priority>
  </url>`
    )
    .join("\n");
  fs.writeFileSync(
    path.join(root, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`,
    "utf8"
  );
}

function writeRobots() {
  const base = config.siteUrl.replace(/\/$/, "");
  fs.writeFileSync(
    path.join(root, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${base}/sitemap.xml\n`,
    "utf8"
  );
}

function syncHomepagePosts() {
  const latest = posts.slice(0, 3).map((p) => ({
    id: p.id,
    date: p.date,
    title: p.title,
    excerpt: p.excerpt,
    tag: p.category,
    readTime: p.readTime,
    href: `/${p.url.replace(/^\//, "")}`,
  }));
  const archiveCount = Math.max(0, posts.length - 3);
  const meta = { archiveCount, total: posts.length, viewMore: "/blog/#archive" };
  fs.writeFileSync(
    path.join(root, "blog-feed.json"),
    JSON.stringify({ latest, ...meta }, null, 2) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(root, "blog-feed.js"),
    `window.BLOG_FEED = ${JSON.stringify(latest, null, 2)};\nwindow.BLOG_META = ${JSON.stringify(meta, null, 2)};\n`,
    "utf8"
  );
}

function findPostSourceHtml(post) {
  const modern = path.join(blogDir, post.slug, "index.html");
  if (exists(modern)) return modern;
  const legacy = path.join(postsDir, `${post.slug}.html`);
  if (exists(legacy)) return legacy;
  return null;
}

function extractPostParts(html) {
  const copy = (html.match(/<div class="blog-copy">([\s\S]*?)<\/div>\s*<section class="blog-faq">/) || [])[1] || "";
  const body = [...copy.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) =>
    decodeBasicEntities(m[1].replace(/<[^>]+>/g, ""))
  );
  const faqBlock = (html.match(/<section class="blog-faq">([\s\S]*?)<\/section>/) || [])[1] || "";
  const faq = [...faqBlock.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({
    q: decodeBasicEntities(m[1]),
    a: decodeBasicEntities(m[2]),
  }));
  return { body, faq: faq.length ? faq : buildFaq("Building", "this topic") };
}

function decodeBasicEntities(value) {
  return String(value)
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function migrateLegacyPosts() {
  let changed = false;
  for (const post of posts) {
    const nextUrl = `blog/${post.slug}/`;
    if (post.url !== nextUrl) {
      post.url = nextUrl;
      changed = true;
    }
  }
  if (changed) writeJson(postsPath, posts);

  if (!exists(postsDir)) return;
  for (const name of fs.readdirSync(postsDir)) {
    if (!name.endsWith(".html")) continue;
    const slug = name.replace(/\.html$/, "");
    const src = path.join(postsDir, name);
    const destDir = path.join(blogDir, slug);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, "index.html");
    if (!exists(dest)) fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
  try {
    if (fs.readdirSync(postsDir).length === 0) fs.rmdirSync(postsDir);
  } catch {
    /* ignore */
  }
}

function rewriteAllPostPages() {
  for (const post of posts) {
    const source = findPostSourceHtml(post);
    if (!source) {
      console.warn(`Missing HTML for ${post.slug}`);
      continue;
    }
    const { body, faq } = extractPostParts(fs.readFileSync(source, "utf8"));
    if (!body.length) {
      console.warn(`Empty body for ${post.slug}`);
      continue;
    }
    const outDir = path.join(blogDir, post.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), renderPostHtml(post, body, faq), "utf8");
  }
}

function dateInTz(tz, dayOffset = 0) {
  const now = new Date();
  const shifted = new Date(now.getTime() + dayOffset * 86400000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(shifted).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return new Date(`${parts.year}-${parts.month}-${parts.day}T06:00:00+05:30`);
}

function formatDisplayDate(date) {
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: config.timezone,
  });
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest().readUInt32BE(0);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function uniquePush(list, items, limit = 100) {
  const next = [...list];
  for (const item of items) {
    if (!next.includes(item)) next.push(item);
  }
  return next.slice(-limit);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}
