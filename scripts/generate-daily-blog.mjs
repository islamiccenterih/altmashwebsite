#!/usr/bin/env node
/**
 * Daily SEO blog generator for Altmash.
 * Usage:
 *   node scripts/generate-daily-blog.mjs                   publish today's post
 *   node scripts/generate-daily-blog.mjs --count 3 --force publish several posts now
 *   node scripts/generate-daily-blog.mjs --regenerate all  rewrite every existing post (URLs stay the same)
 *   node scripts/generate-daily-blog.mjs --regenerate 5    rewrite the 5 oldest posts not yet at the best quality
 *   node scripts/generate-daily-blog.mjs --rebuild-only    re-render pages, feeds and sitemap from stored content
 *
 * With OPENAI_API_KEY set, articles are written by OpenAI (model: OPENAI_MODEL, default gpt-4o-mini).
 * Without it, the local composer builds long-form articles from blog/data/playbooks.json.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const blogDir = path.join(root, "blog");
const legacyPostsDir = path.join(blogDir, "posts");
const dataDir = path.join(blogDir, "data");
const contentDir = path.join(dataDir, "content");

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

const MIN_AI_WORDS = 1200;
const CATEGORY_TERMS = {
  "Meta Ads": "Meta ads",
  "Google Ads": "Google Ads",
  "Shopify Development": "Shopify development",
  "WordPress Development": "WordPress development",
  "Android App": "Android app development",
  "UGC Ads": "UGC ads",
};
const categoryTerm = (category) => CATEGORY_TERMS[category] || category.toLowerCase();
const QUALITY_RANK = { legacy: 0, local: 1, openai: 2 };

const config = readJson(path.join(blogDir, "config.json"));
const topics = readJson(path.join(dataDir, "topics.json"));
const examples = readJson(path.join(dataDir, "examples.json"));
const playbooks = readJson(path.join(dataDir, "playbooks.json"));
const postsPath = path.join(dataDir, "posts.json");
const statePath = path.join(dataDir, "state.json");

const siteBase = config.siteUrl.replace(/\/$/, "");
const ogImage = `${siteBase}/assets/portrait.jpg`;

const posts = exists(postsPath) ? readJson(postsPath) : [];
const state = exists(statePath)
  ? readJson(statePath)
  : { categoryIndex: 0, usedTitles: [], usedExamples: [], lastRun: null };

const args = process.argv.slice(2);
const argValue = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const count = Math.max(1, Number(argValue("--count")) || 1);
const force = args.includes("--force");
const rebuildOnly = args.includes("--rebuild-only");
const regenerate = args.includes("--regenerate") ? argValue("--regenerate") || "all" : null;

async function main() {
  fs.mkdirSync(contentDir, { recursive: true });
  migrateLegacyPosts();
  ensureStoredContent();

  if (rebuildOnly) {
    renderAllPosts();
    writeFeeds();
    console.log(`Rebuilt pages. Homepage: ${Math.min(3, posts.length)} · Archive: ${Math.max(0, posts.length - 3)}`);
    return;
  }

  if (regenerate) {
    await regeneratePosts(regenerate);
    writeJson(postsPath, posts);
    renderAllPosts();
    writeFeeds();
    return;
  }

  for (let i = 0; i < count; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await publishOne(i);
  }

  writeJson(postsPath, posts);
  writeJson(statePath, state);
  renderAllPosts();
  writeFeeds();
  console.log(`Total posts: ${posts.length}`);
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

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
  const seedTitle = nextTitle(category, dateKey);
  const pickedExamples = pickExamples(2);
  const content = await buildContent({
    category,
    title: seedTitle,
    examples: pickedExamples,
    dateKey,
    avoidTitles: allTitles(),
    keepTitle: false,
  });

  let slug = slugify(`${dateKey}-${content.title}`).slice(0, 90).replace(/-+$/, "");
  while (posts.some((p) => p.slug === slug)) slug = `${slug}-2`;

  const post = {
    id: slug,
    slug,
    title: content.title,
    category,
    date: formatDisplayDate(today),
    dateIso: dateKey,
    url: `blog/${slug}/`,
    examples: pickedExamples.map((e) => e.id),
  };
  applyContentMeta(post, content);
  saveContent(slug, content);

  posts.unshift(post);
  state.usedTitles = uniquePush(state.usedTitles, [seedTitle, content.title], 500);
  state.usedExamples = uniquePush(
    state.usedExamples,
    pickedExamples.map((e) => e.id),
    80
  );
  if (offset === 0) state.lastRun = dateKey;

  console.log(`✓ ${category} — ${content.title} (${post.wordCount} words, ${content.source})`);
}

async function regeneratePosts(mode) {
  const targetRank = process.env.OPENAI_API_KEY ? QUALITY_RANK.openai : QUALITY_RANK.local;
  const oldestFirst = [...posts].reverse();
  let queue =
    mode === "all"
      ? oldestFirst
      : oldestFirst.filter((p) => (QUALITY_RANK[readContent(p.slug)?.source] ?? 0) < targetRank);
  const limit = Number(mode);
  if (Number.isFinite(limit) && limit > 0) queue = queue.slice(0, limit);

  if (!queue.length) {
    console.log("Nothing to regenerate.");
    return;
  }

  for (const post of queue) {
    const postExamples = (post.examples || [])
      .map((id) => examples.find((e) => e.id === id))
      .filter(Boolean);
    // eslint-disable-next-line no-await-in-loop
    const content = await buildContent({
      category: post.category,
      title: post.title,
      examples: postExamples.length ? postExamples : pickExamples(2),
      dateKey: post.dateIso,
      avoidTitles: [],
      keepTitle: true,
    });
    content.title = post.title;
    applyContentMeta(post, content);
    post.updatedIso = dateInTz(config.timezone, 0).toISOString().slice(0, 10);
    saveContent(post.slug, content);
    console.log(`↻ ${post.title} (${post.wordCount} words, ${content.source})`);
  }
}

function applyContentMeta(post, content) {
  const words = countWords(content);
  post.excerpt = content.metaDescription;
  post.keywords = content.keywords.join(", ");
  post.wordCount = words;
  post.readTime = `${Math.max(4, Math.round(words / 220))} min read`;
  post.source = content.source;
}

function allTitles() {
  return [...new Set([...posts.map((p) => p.title), ...state.usedTitles])];
}

function nextCategory() {
  const list = config.categories;
  const category = list[state.categoryIndex % list.length];
  state.categoryIndex = (state.categoryIndex + 1) % list.length;
  return category;
}

function nextTitle(category, dateKey) {
  const used = new Set(allTitles().map((t) => t.toLowerCase()));
  const pool = (topics[category] || []).filter((t) => !used.has(t.toLowerCase()));
  if (pool.length) return pool[hash(`${dateKey}-${category}`) % pool.length];

  const pb = playbookFor(category);
  const year = dateKey.slice(0, 4);
  const lc = categoryTerm(category);
  const angles = [
    `${capitalize(pb.keyword)}: a practical playbook for ${year}`,
    `${capitalize(pb.keyword)} mistakes that quietly waste budget`,
    `How to plan ${pb.keyword} for the next 90 days`,
    `A ${lc} checklist before you spend another rupee`,
    `What ${pb.audience} get wrong about ${lc}`,
    `${capitalize(lc)} in ${year}: what still works in India`,
    `The ${lc} system I use for brands I manage`,
    `${capitalize(lc)} on a small budget: where to start`,
  ];
  const fresh = angles.filter((t) => !used.has(t.toLowerCase()));
  if (fresh.length) return fresh[hash(`${dateKey}-${category}-angle`) % fresh.length];
  return `${capitalize(pb.keyword)}: field notes from ${formatDisplayDate(new Date(`${dateKey}T06:00:00+05:30`))}`;
}

function pickExamples(n = 2) {
  const fresh = examples.filter((e) => !state.usedExamples.includes(e.id));
  const pool = fresh.length >= n ? fresh : examples;
  const shuffled = [...pool].sort(
    (a, b) => hash(a.id + state.categoryIndex) - hash(b.id + state.categoryIndex)
  );
  const preferred = shuffled.filter(
    (e) => !["insane-look-drop", "wolf-cloth-seasonal", "islamic-center-hub"].includes(e.id)
  );
  const primary = preferred.length >= n ? preferred : shuffled;
  return primary.slice(0, n);
}

/* ------------------------------------------------------------------ */
/* Content generation                                                  */
/* ------------------------------------------------------------------ */

async function buildContent(ctx) {
  if (process.env.OPENAI_API_KEY) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const ai = await generateWithOpenAI(ctx);
        const words = countWords(ai);
        if (words >= MIN_AI_WORDS) return ai;
        console.warn(`OpenAI draft too short (${words} words), retrying.`);
      } catch (error) {
        console.warn(`OpenAI attempt ${attempt} failed: ${error.message}`);
      }
    }
    console.warn("Falling back to the local composer.");
  }
  return composeLocal(ctx);
}

async function generateWithOpenAI({ category, title, examples: picked, dateKey, avoidTitles, keepTitle }) {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const titleRule = keepTitle
    ? `Use exactly this title: "${title}".`
    : `Working title: "${title}". You may sharpen it for search intent (max 65 characters). Do not reuse any of these existing titles: ${avoidTitles
        .slice(-60)
        .join(" | ")}`;

  const prompt = `Write a long-form, SEO-optimised blog article for ${siteBase}.

Author: Altmash — Business Owner & Developer from India. Freelancer since 2020, founded a branding & marketing agency in 2021, launched a clothing brand in 2023, nominated for the Dubai Business Award in 2024. Brands he has worked on: Insane Look (streetwear), The Wolf Cloth (apparel), Islamic Center Firozabad (community platform), Trends Sole (perfume & watches), Hey Gentleman (shoes), Ranglook (women's ethnic wear), POP Naari (ethnic wear), Russh Clothing (streetwear), Jaipur Tex (sarees), Thredsy (clothing & shoes).

Category: ${category}
Date: ${dateKey}
${titleRule}

Weave these real examples in naturally, in your own words:
${picked.map((e) => `- ${e.text}`).join("\n")}

Requirements:
- 1600 to 2200 words in total.
- Choose one primary long-tail keyword that a founder or marketer in India would really search. Use it in the first paragraph, in one section heading and in the meta description.
- metaDescription: 140 to 158 characters, includes the primary keyword, written to earn the click.
- intro: 2 to 3 paragraphs that name the problem and promise what the reader will learn.
- sections: 6 to 8 sections. Each has a descriptive "heading", 2 to 4 "paragraphs", and optionally 3 to 6 short "bullets". Include one step-by-step section and one common-mistakes section. Use concrete numbers, timelines and INR budgets where they genuinely help.
- takeaways: 4 or 5 one-line key takeaways.
- conclusion: 1 or 2 paragraphs ending with an invitation to message Altmash on WhatsApp.
- faq: 4 or 5 questions people actually search about this topic, each answered in 2 to 4 sentences.
- keywords: 6 to 10 SEO keywords and phrases.
- Write in first person as Altmash and mention the name "Altmash" naturally 3 to 5 times.
- Plain text inside every string: no markdown, no HTML, no emojis, no bullet characters.
- Do not invent statistics or attribute numbers to named studies or companies.

Return only JSON with exactly this shape:
{"title":"","primaryKeyword":"","metaDescription":"","keywords":[],"intro":[],"takeaways":[],"sections":[{"heading":"","paragraphs":[],"bullets":[]}],"conclusion":[],"faq":[{"q":"","a":""}]}`;

  const body = {
    model,
    response_format: { type: "json_object" },
    max_completion_tokens: 8000,
    messages: [
      {
        role: "system",
        content:
          "You are a senior SEO content strategist ghostwriting practical, experience-led articles for an Indian brand operator. You reply with valid JSON only.",
      },
      { role: "user", content: prompt },
    ],
  };
  if (!/^(o\d|gpt-5)/.test(model)) body.temperature = 0.85;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content?.trim() || "";
  const raw = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  return normalizeContent(raw, { category, title, avoidTitles, keepTitle }, "openai");
}

function normalizeContent(raw, ctx, source) {
  const list = (value) =>
    Array.isArray(value) ? value.map((item) => String(item ?? "").trim()).filter(Boolean) : [];
  const sections = (Array.isArray(raw.sections) ? raw.sections : [])
    .map((s) => ({
      heading: String(s?.heading ?? "").trim(),
      paragraphs: list(s?.paragraphs),
      bullets: list(s?.bullets),
    }))
    .filter((s) => s.heading && s.paragraphs.length);
  const faq = (Array.isArray(raw.faq) ? raw.faq : [])
    .map((f) => ({ q: String(f?.q ?? "").trim(), a: String(f?.a ?? "").trim() }))
    .filter((f) => f.q && f.a);
  const intro = list(raw.intro);
  if (!intro.length || sections.length < 4) throw new Error("Incomplete article structure");

  let title = ctx.keepTitle ? ctx.title : String(raw.title ?? "").trim() || ctx.title;
  const taken = new Set((ctx.avoidTitles || []).map((t) => t.toLowerCase()));
  if (!ctx.keepTitle && taken.has(title.toLowerCase())) title = ctx.title;

  const keywords = list(raw.keywords).slice(0, 10);
  return {
    title,
    primaryKeyword: String(raw.primaryKeyword ?? "").trim(),
    metaDescription: clampMeta(String(raw.metaDescription ?? "").trim() || defaultMeta(ctx.category, title)),
    keywords: keywords.length ? keywords : defaultKeywords(ctx.category, playbookFor(ctx.category)),
    intro,
    takeaways: list(raw.takeaways).slice(0, 6),
    sections,
    conclusion: list(raw.conclusion),
    faq,
    source,
    generatedAt: new Date().toISOString(),
  };
}

/* ---------------------------- local composer ---------------------------- */

function composeLocal({ category, title, examples: picked, dateKey }) {
  const pb = playbookFor(category);
  const rnd = seededRandom(hash(`${title}|${dateKey}|${category}`));
  const ctx = {
    category,
    lc: categoryTerm(category),
    title,
    topic: title.replace(/[?.!]+$/, ""),
    pb,
    ex: picked.length ? picked : [examples[0]],
    rnd,
  };

  const intro = [choose(rnd, INTRO_OPENERS)(ctx), choose(rnd, INTRO_ROADMAPS)(ctx)];
  const optional = shuffle(rnd, [sectionExample, sectionMistakes, sectionMetrics, sectionStack, sectionBudget, sectionMarket]);
  const middle = optional.slice(0, rnd() < 0.5 ? 4 : 5);
  const stepsFirst = rnd() < 0.5;
  const sectionBuilders = [
    sectionWhy,
    ...(stepsFirst ? [sectionSteps, ...middle] : [middle[0], sectionSteps, ...middle.slice(1)]),
    sectionPlan,
  ];
  const sections = sectionBuilders.map((build) => build(ctx));

  const genericFaq = [
    {
      q: `Can I handle ${ctx.lc} myself or should I hire help?`,
      a: `You can start yourself if you follow a clear process and review the numbers every week. Bring in help when the work starts eating time you should spend on product and sales, or when results plateau and you cannot see why.`,
    },
    {
      q: `How does ${ctx.lc} connect with SEO?`,
      a: `Clear structure, useful content and fast, focused pages help both search rankings and conversions. The same discipline that makes ${ctx.lc} perform usually makes your brand easier to find as well.`,
    },
    {
      q: `Does Altmash work with brands outside India?`,
      a: `Yes. Altmash works with Indian and international brands on branding, websites, Shopify, ads and full brand management, usually coordinated over WhatsApp and video calls.`,
    },
    {
      q: `What is the first thing to fix in ${ctx.lc}?`,
      a: `Start with clarity: who it is for, what the offer is and what action you want next. Most ${ctx.lc} problems that look technical are really unclear decisions made earlier.`,
    },
  ];

  const content = {
    title,
    primaryKeyword: pb.keyword,
    metaDescription: fitMeta([
      `${ctx.topic}: a practical guide by Altmash with steps, common mistakes, metrics and a 30-day plan for ${pb.audience}.`,
      `${ctx.topic} — Altmash's practical guide with steps, mistakes to avoid, key metrics and a 30-day plan.`,
      `${ctx.topic}: steps, mistakes to avoid and a 30-day plan from Altmash.`,
      `${ctx.topic} — a practical guide by Altmash.`,
    ]),
    keywords: defaultKeywords(category, pb),
    intro,
    takeaways: sample(rnd, pb.tips, 4),
    sections,
    conclusion: [choose(rnd, CONCLUSIONS)(ctx), CLOSING_CTA],
    faq: [...pb.faq, ...sample(rnd, genericFaq, 2)],
    source: "local",
    generatedAt: new Date().toISOString(),
  };
  return content;
}

const INTRO_OPENERS = [
  (c) =>
    `${c.topic} is a question I hear from ${c.pb.audience} almost every week. I am Altmash — I started freelancing in 2020, opened my branding and marketing agency in 2021 and launched a clothing brand in 2023 — and the pattern is always the same: the brands that win treat ${c.lc} as a system, not a one-off task.`,
  (c) =>
    `Most advice about ${c.pb.keyword} is either too generic or written by people who have never had to hit a monthly target with it. I am Altmash, and everything in this guide comes from running live brands across fashion, ethnic wear, footwear, perfume and community platforms.`,
  (c) =>
    `If you are one of the ${c.pb.audience}, this article is for you. ${c.topic} sounds simple on paper, but in practice it touches your offer, your pages, your team and your budget at the same time — which is why I, Altmash, approach it as an operating system rather than a tactic.`,
];

const INTRO_ROADMAPS = [
  () =>
    `Below I walk through why it matters, a step-by-step process, the mistakes I see most often, what to measure and a practical 30-day plan you can start this week.`,
  () =>
    `You will find the framework I use with clients, real examples from brands I have worked on, the numbers worth tracking and a plan to put it into action without a big team.`,
  () =>
    `This guide is written for doers: clear steps, honest trade-offs, realistic budgets for Indian brands and a checklist you can hand to your team today.`,
];

const CONCLUSIONS = [
  (c) =>
    `${c.topic} is not about doing more. It is about doing the right things in the right order and owning them after launch. Start with the steps above, measure honestly and improve a little every week.`,
  (c) =>
    `The brands that get ${c.lc} right are rarely the ones with the biggest budgets. They are the ones with clear decisions, a weekly rhythm and someone who owns the result. Put those three in place and the rest becomes much easier.`,
  (c) =>
    `If you take one thing from this guide, let it be this: ${c.lc} compounds when it is treated as a system. Fix the inputs, keep a simple scoreboard and give each change enough time to show results.`,
];

const CLOSING_CTA =
  "If you want help applying this to your brand, message me on WhatsApp. I am Altmash, and I build and run brands end to end — website, identity, ads and the systems that keep them growing.";

function sectionWhy(c) {
  return {
    heading: choose(c.rnd, [
      `Why ${c.pb.keyword} matters more than most founders think`,
      `Why ${c.lc} deserves a real system`,
      `What is really at stake with ${c.lc}`,
    ]),
    paragraphs: [
      ...c.pb.why,
      choose(c.rnd, [
        `The good news is that none of this needs a big team. It needs clear decisions, a weekly rhythm and someone who owns the result after launch — which is exactly how I run ${c.lc} for the brands I manage.`,
        `That is why I never start with tactics. I start by asking what the business needs from ${c.lc} in the next 90 days, and then build only what serves that goal.`,
      ]),
    ],
    bullets: [],
  };
}

function sectionSteps(c) {
  return {
    heading: choose(c.rnd, [
      `A step-by-step process for ${c.pb.keyword}`,
      `The ${c.pb.steps.length}-step framework I use`,
      `How to approach ${c.lc}, step by step`,
    ]),
    paragraphs: [
      `Here is the process I follow. The order matters: each step removes a reason for the next one to fail.`,
      choose(c.rnd, [
        `Do not skip the early steps to get to the exciting part. In my experience, most ${c.lc} problems that look like execution issues are really decisions that were never made at the start.`,
        `Give each step a clear owner and a deadline. A plan without owners is just a list of good intentions, and ${c.lc} punishes good intentions that never ship.`,
      ]),
    ],
    bullets: c.pb.steps.map((s) => s.replace(" — ", ": ")),
  };
}

function sectionExample(c) {
  const [first, second] = [c.ex[0], c.ex[1] || c.ex[0]];
  const paragraphs = [
    `One example from my own work: ${first.text}`,
    choose(c.rnd, [
      `That lesson applies directly to ${c.lc}: fix the input before you push more budget or effort through it.`,
      `For ${c.lc}, the takeaway is to treat proof and clarity as part of the work, not as decoration on top of it.`,
    ]),
  ];
  if (second !== first) paragraphs.push(`Another: ${second.text}`);
  paragraphs.push(
    `The details differ by category, but the principle holds: when the brand, the page and the channel tell one story, ${c.lc} becomes cheaper and more predictable.`
  );
  return {
    heading: choose(c.rnd, [
      `What this looks like on real brands`,
      `Lessons from brands I have worked on`,
      `Real examples from the field`,
    ]),
    paragraphs,
    bullets: [],
  };
}

function sectionMistakes(c) {
  return {
    heading: choose(c.rnd, [
      `Common ${c.lc} mistakes to avoid`,
      `Mistakes that quietly waste money`,
      `Where most brands go wrong with ${c.lc}`,
    ]),
    paragraphs: [
      `These are the mistakes I see most often when I audit brands. Each one looks small on its own; together they explain why results stall.`,
      `If you recognise two or more of these in your own business, fix them before adding budget. More spend on a broken system only makes the problem more expensive.`,
    ],
    bullets: c.pb.mistakes,
  };
}

function sectionMetrics(c) {
  return {
    heading: choose(c.rnd, [
      `What to measure`,
      `The numbers that actually matter for ${c.lc}`,
      `How to know if it is working`,
    ]),
    paragraphs: [
      `Pick a small set of numbers and review them every week in the same place. I prefer five metrics the whole team understands over a dashboard nobody opens.`,
      `Look at trends over four to eight weeks rather than daily swings, and always tie the numbers back to revenue or qualified leads.`,
    ],
    bullets: c.pb.metrics,
  };
}

function sectionStack(c) {
  return {
    heading: choose(c.rnd, [
      `Tools and setup I recommend`,
      `The tool stack for ${c.lc}`,
      `What you need in place before you start`,
    ]),
    paragraphs: [
      `You do not need expensive software to do this well. This is the stack I usually start with:`,
      `Tools only help when someone owns them. Assign one person to each tool, document the setup, and keep every login in the brand's name rather than a freelancer's personal account.`,
    ],
    bullets: c.pb.tools,
  };
}

function sectionBudget(c) {
  return {
    heading: choose(c.rnd, [
      `Budget and timeline: what to expect`,
      `How much time and money ${c.lc} takes`,
      `Realistic budgets for Indian brands`,
    ]),
    paragraphs: [
      c.pb.budget,
      `These ranges are starting points, not quotes. The right number depends on your category, your margins and how much of the work your team can handle in-house. What matters most is committing to a test long enough to learn from it.`,
    ],
    bullets: [],
  };
}

function sectionMarket(c) {
  return {
    heading: choose(c.rnd, [
      `The Indian market context`,
      `What is different for brands in India`,
      `Selling to Indian and global buyers`,
    ]),
    paragraphs: [
      choose(c.rnd, [
        `Indian buyers are mobile-first, value-conscious and quick to message a brand on WhatsApp before they buy. Page speed on patchy networks, clear pricing, easy payment options and fast replies are part of ${c.lc}, not separate from it.`,
        `In India, trust is often built in the chat window. A buyer who messages you on WhatsApp is judging your speed, tone and clarity as much as your product, so ${c.lc} has to include how your team responds.`,
      ]),
      choose(c.rnd, [
        `At the same time, trust is local while expectations are global. A buyer in Jaipur or Lucknow compares your experience with the best apps on their phone, so the bar for clarity and speed keeps rising.`,
        `Festive seasons, regional preferences and cash-on-delivery habits also shape results. Plan your calendar around them instead of treating every month the same.`,
      ]),
    ],
    bullets: [],
  };
}

function sectionPlan(c) {
  const name = (i) => (c.pb.steps[i] || "").split(" — ")[0];
  return {
    heading: choose(c.rnd, [
      `A 30-day plan you can start this week`,
      `Your first 30 days`,
      `Putting it into action: a 30-day plan`,
    ]),
    paragraphs: [
      `If you want to move quickly, here is how I would sequence the first month.`,
      `At the end of the month you will have real data instead of opinions — and a clear picture of where to invest next.`,
    ],
    bullets: [
      `Week 1: ${name(0)} and ${lowerFirst(name(1))}.`,
      `Week 2: ${name(2)}.`,
      `Week 3: ${name(3)} and ${lowerFirst(name(4))}.`,
      `Week 4: ${name(5)}, then review your metrics and decide what to keep.`,
    ],
  };
}

function playbookFor(category) {
  if (playbooks[category]) return playbooks[category];
  const lc = categoryTerm(category);
  return {
    keyword: `${lc} for growing brands`,
    audience: "founders building a brand in India",
    why: [
      `${category} decides how efficiently attention turns into revenue. Done well, it makes every other channel cheaper.`,
      `Most brands struggle with ${lc} because nobody owns it end to end, so small problems pile up unnoticed.`,
    ],
    steps: [
      "Set the goal — one measurable outcome for the next 90 days.",
      "Audit the current state — what exists, what works and what is broken.",
      "Fix the foundations — tracking, offer clarity and the key pages.",
      "Run focused tests — one variable at a time with clear success rules.",
      "Scale what works — increase effort only on proven winners.",
      "Review monthly — keep a simple scoreboard and adjust deliberately.",
    ],
    mistakes: [
      "No single owner for the outcome.",
      "Changing too many things at once.",
      "Measuring activity instead of results.",
      "Skipping the foundations to chase quick wins.",
      "Stopping before tests have enough data.",
    ],
    metrics: ["Revenue or qualified leads", "Cost per result", "Conversion rate", "Repeat customers", "Time to ship changes"],
    tools: ["Google Analytics 4", "Google Search Console", "A shared scoreboard", "A project board", "WhatsApp Business"],
    tips: [
      "One owner per outcome.",
      "Fix foundations first.",
      "Test one thing at a time.",
      "Measure results, not activity.",
      "Review monthly.",
      "Give tests enough time.",
    ],
    budget: `Budgets for ${lc} vary widely. Start with an amount you can sustain for three months and scale only what shows results.`,
    faq: [
      {
        q: `Where should I start with ${lc}?`,
        a: `Start with one clear goal for the next 90 days and fix the foundations that goal depends on before adding new tactics.`,
      },
    ],
  };
}

function defaultKeywords(category, pb) {
  const lc = categoryTerm(category);
  return [pb.keyword, lc, `${lc} India`, `${lc} tips`, `${lc} strategy`, "Altmash", "branding agency India"];
}

function defaultMeta(category, title) {
  return `${title} — practical ${categoryTerm(category)} guidance from Altmash with steps, mistakes to avoid and what to measure.`;
}

function fitMeta(candidates) {
  return candidates.find((text) => text.length <= 158) || clampMeta(candidates[candidates.length - 1]);
}

function clampMeta(text) {
  if (text.length <= 158) return text;
  const cut = text.slice(0, 155);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

function countWords(content) {
  const parts = [
    ...(content.intro || []),
    ...(content.takeaways || []),
    ...(content.sections || []).flatMap((s) => [s.heading, ...s.paragraphs, ...s.bullets]),
    ...(content.conclusion || []),
    ...(content.faq || []).flatMap((f) => [f.q, f.a]),
  ];
  return parts.join(" ").split(/\s+/).filter(Boolean).length;
}

/* ------------------------------------------------------------------ */
/* Stored content                                                      */
/* ------------------------------------------------------------------ */

function contentPath(slug) {
  return path.join(contentDir, `${slug}.json`);
}

function readContent(slug) {
  const file = contentPath(slug);
  return exists(file) ? readJson(file) : null;
}

function saveContent(slug, content) {
  writeJson(contentPath(slug), content);
}

function ensureStoredContent() {
  for (const post of posts) {
    if (exists(contentPath(post.slug))) continue;
    const htmlFile = [path.join(blogDir, post.slug, "index.html"), path.join(legacyPostsDir, `${post.slug}.html`)].find(exists);
    if (!htmlFile) {
      console.warn(`Missing HTML for ${post.slug}`);
      continue;
    }
    const html = fs.readFileSync(htmlFile, "utf8");
    const copy = (html.match(/<div class="blog-copy">([\s\S]*?)<\/div>\s*<section class="blog-faq">/) || [])[1] || "";
    const intro = [...copy.matchAll(/<p>([\s\S]*?)<\/p>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, "")));
    const faqBlock = (html.match(/<section class="blog-faq">([\s\S]*?)<\/section>/) || [])[1] || "";
    const faq = [...faqBlock.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({
      q: decodeEntities(m[1]),
      a: decodeEntities(m[2]),
    }));
    saveContent(post.slug, {
      title: post.title,
      primaryKeyword: "",
      metaDescription: post.excerpt,
      keywords: String(post.keywords || "").split(",").map((k) => k.trim()).filter(Boolean),
      intro,
      takeaways: [],
      sections: [],
      conclusion: [],
      faq,
      source: "legacy",
      generatedAt: null,
    });
  }
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
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderAllPosts() {
  for (const post of posts) {
    const content = readContent(post.slug);
    if (!content) continue;
    const outDir = path.join(blogDir, post.slug);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), renderPostHtml(post, content), "utf8");
  }
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

function relatedPosts(post, limit = 3) {
  const others = posts.filter((p) => p.slug !== post.slug);
  const distance = (p) => Math.abs(new Date(p.dateIso) - new Date(post.dateIso));
  const sameCategory = others.filter((p) => p.category === post.category).sort((a, b) => distance(a) - distance(b));
  const rest = others.filter((p) => p.category !== post.category).sort((a, b) => distance(a) - distance(b));
  return [...sameCategory, ...rest].slice(0, limit);
}

function renderPostHtml(post, content) {
  const url = `${siteBase}/${post.url}`;
  const usedIds = new Set();
  const sections = content.sections.map((section) => {
    let id = slugify(section.heading).slice(0, 60) || "section";
    while (usedIds.has(id)) id = `${id}-2`;
    usedIds.add(id);
    return { ...section, id };
  });

  const intro = content.intro.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n        ");
  const sectionHtml = sections
    .map(
      (s) => `
        <h2 id="${s.id}">${escapeHtml(s.heading)}</h2>
        ${s.paragraphs
          .slice(0, 1)
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join("")}
        ${s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
        ${s.paragraphs
          .slice(1)
          .map((p) => `<p>${escapeHtml(p)}</p>`)
          .join("\n        ")}`
    )
    .join("");
  const conclusionHtml = content.conclusion.length
    ? `
        <h2 id="final-thoughts">Final thoughts</h2>
        ${content.conclusion.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n        ")}`
    : "";

  const toc = sections.length
    ? `
      <nav class="blog-toc" aria-label="Table of contents">
        <h2>In this article</h2>
        <ol>${sections.map((s) => `<li><a href="#${s.id}">${escapeHtml(s.heading)}</a></li>`).join("")}</ol>
      </nav>`
    : "";
  const takeaways = content.takeaways.length
    ? `
      <aside class="blog-takeaways">
        <h2>Key takeaways</h2>
        <ul>${content.takeaways.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>
      </aside>`
    : "";
  const faqHtml = content.faq
    .map(
      (item) => `
        <div class="faq-item">
          <h3>${escapeHtml(item.q)}</h3>
          <p>${escapeHtml(item.a)}</p>
        </div>`
    )
    .join("");
  const related = relatedPosts(post);
  const relatedHtml = related.length
    ? `
      <section class="blog-related">
        <h2>Keep reading</h2>
        <div class="blog-related-grid">${related
          .map(
            (p) => `
          <a class="blog-related-card" href="/${escapeHtml(p.url)}">
            <small>${escapeHtml(p.category)} · ${escapeHtml(p.readTime)}</small>
            <strong>${escapeHtml(p.title)}</strong>
            <span>Read →</span>
          </a>`
          )
          .join("")}
        </div>
      </section>`
    : "";

  const modified = post.updatedIso || post.dateIso;
  const author = {
    "@type": "Person",
    name: config.author,
    url: `${siteBase}/`,
    jobTitle: config.authorRole,
    sameAs: [config.instagram, config.whatsapp],
  };
  const schemas = [
    {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title,
      description: content.metaDescription,
      image: ogImage,
      datePublished: post.dateIso,
      dateModified: modified,
      inLanguage: "en-IN",
      wordCount: post.wordCount,
      author,
      publisher: author,
      mainEntityOfPage: url,
      keywords: content.keywords.join(", "),
      articleSection: post.category,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${siteBase}/` },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${siteBase}/blog/` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (content.faq.length) {
    schemas.push({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: content.faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    });
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(post.title)} | ${escapeHtml(config.author)}</title>
  <meta name="description" content="${escapeHtml(content.metaDescription)}" />
  <meta name="keywords" content="${escapeHtml(content.keywords.join(", "))}" />
  <meta name="author" content="${escapeHtml(config.author)}" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <link rel="canonical" href="${escapeHtml(url)}" />
  <meta property="og:type" content="article" />
  <meta property="og:locale" content="${escapeHtml(config.locale)}" />
  <meta property="og:title" content="${escapeHtml(post.title)}" />
  <meta property="og:description" content="${escapeHtml(content.metaDescription)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:site_name" content="${escapeHtml(config.siteName)}" />
  <meta property="article:published_time" content="${escapeHtml(post.dateIso)}" />
  <meta property="article:modified_time" content="${escapeHtml(modified)}" />
  <meta property="article:author" content="${escapeHtml(config.author)}" />
  <meta property="article:section" content="${escapeHtml(post.category)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(post.title)}" />
  <meta name="twitter:description" content="${escapeHtml(content.metaDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
  <meta name="theme-color" content="#070707" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/blog/blog.css" />
  ${schemas.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join("\n  ")}
</head>
<body class="blog-page">
  ${renderSiteChrome({ active: "Blog" })}
  <main class="blog-main">
    <article>
      <nav class="blog-crumbs" aria-label="Breadcrumb">
        <a href="/">Home</a><span>/</span><a href="/blog/">Blog</a><span>/</span><span>${escapeHtml(post.category)}</span>
      </nav>
      <p class="blog-kicker">${escapeHtml(post.category)} · ${escapeHtml(post.date)} · ${escapeHtml(post.readTime)}</p>
      <h1>${escapeHtml(post.title)}</h1>
      <p class="blog-lead">${escapeHtml(content.metaDescription)}</p>
      <p class="blog-byline">By <strong>${escapeHtml(config.author)}</strong> — ${escapeHtml(config.authorRole)} · <time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(formatLongDate(post.dateIso))}</time></p>
      ${takeaways}
      ${toc}
      <div class="blog-copy">
        ${intro}
        ${sectionHtml}
        ${conclusionHtml}
      </div>
      <section class="blog-faq">
        <h2>Frequently asked questions</h2>
        ${faqHtml}
      </section>
      <section class="blog-cta">
        <h2>Work with Altmash</h2>
        <p>Need branding, websites, Shopify, ads, or full brand management? Start on WhatsApp.</p>
        <a class="blog-btn" href="${escapeHtml(config.whatsapp)}" rel="noreferrer">Chat on WhatsApp</a>
      </section>
      ${relatedHtml}
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

  const description =
    "Building notes by Altmash — branding, agency, Meta Ads, Google Ads, sales, Shopify, WordPress, Android, digital marketing and UGC for Indian brands.";
  const blogSchema = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "Altmash — Notes on building",
    url: `${siteBase}/blog/`,
    description,
    author: { "@type": "Person", name: config.author, url: `${siteBase}/` },
    blogPost: posts.slice(0, 20).map((p) => ({
      "@type": "BlogPosting",
      headline: p.title,
      url: `${siteBase}/${p.url}`,
      datePublished: p.dateIso,
    })),
  };

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog — Notes on Building Brands | Altmash</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${escapeHtml(`${siteBase}/blog/`)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="Blog — Notes on Building Brands | Altmash" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(`${siteBase}/blog/`)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="theme-color" content="#070707" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@300;400;500;600&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="/blog/blog.css" />
  <script type="application/ld+json">${JSON.stringify(blogSchema)}</script>
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
  const latest = posts.reduce((max, p) => {
    const d = p.updatedIso || p.dateIso;
    return d > max ? d : max;
  }, "");
  const entries = [
    { loc: `${siteBase}/`, lastmod: latest, changefreq: "daily", priority: "1.0" },
    { loc: `${siteBase}/blog/`, lastmod: latest, changefreq: "daily", priority: "0.9" },
    ...posts.map((p) => ({
      loc: `${siteBase}/${p.url}`,
      lastmod: p.updatedIso || p.dateIso,
      changefreq: "weekly",
      priority: "0.8",
    })),
  ];
  const body = entries
    .map(
      (e) => `  <url>
    <loc>${e.loc}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ""}
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
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
  fs.writeFileSync(path.join(root, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${siteBase}/sitemap.xml\n`, "utf8");
}

function syncHomepagePosts() {
  const latest = posts.slice(0, 3).map((p) => ({
    id: p.id,
    date: p.date,
    title: p.title,
    excerpt: p.excerpt,
    tag: p.category,
    readTime: p.readTime,
    href: `/${p.url}`,
  }));
  const meta = { archiveCount: Math.max(0, posts.length - 3), total: posts.length, viewMore: "/blog/#archive" };
  fs.writeFileSync(path.join(root, "blog-feed.json"), JSON.stringify({ latest, ...meta }, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(root, "blog-feed.js"),
    `window.BLOG_FEED = ${JSON.stringify(latest, null, 2)};\nwindow.BLOG_META = ${JSON.stringify(meta, null, 2)};\n`,
    "utf8"
  );
}

/* ------------------------------------------------------------------ */
/* Utilities                                                           */
/* ------------------------------------------------------------------ */

function dateInTz(tz, dayOffset = 0) {
  const shifted = new Date(Date.now() + dayOffset * 86400000);
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(
    fmt.formatToParts(shifted).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  return new Date(`${parts.year}-${parts.month}-${parts.day}T06:00:00+05:30`);
}

function formatDisplayDate(date) {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: config.timezone });
}

function formatLongDate(iso) {
  return new Date(`${iso}T06:00:00+05:30`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
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

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lowerFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function decodeEntities(value) {
  return String(value)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function hash(value) {
  return crypto.createHash("sha1").update(String(value)).digest().readUInt32BE(0);
}

function seededRandom(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function choose(rnd, list) {
  return list[Math.floor(rnd() * list.length)];
}

function shuffle(rnd, list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sample(rnd, list, n) {
  return shuffle(rnd, list).slice(0, n);
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

await main();
