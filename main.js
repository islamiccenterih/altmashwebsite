const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (Array.isArray(window.BLOG_FEED) && window.BLOG_FEED.length) {
  profile.posts = window.BLOG_FEED.slice(0, 3);
}
const blogMeta = window.BLOG_META || { archiveCount: 0, viewMore: "/blog/#archive" };

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const pad = (number) => String(number).padStart(2, "0");

const [roleLead, roleRest] = profile.role.split("&").map((part) => part.trim());

const letters = profile.name
  .split("")
  .map(
    (letter, index) =>
      `<span class="letter"><span style="animation-delay:${0.05 + index * 0.045}s">${escapeHtml(letter)}</span></span>`
  )
  .join("");

const applySeo = () => {
  const { title, description, keywords } = profile.seo;
  document.title = title;

  const setMeta = (selector, attr, value) => {
    let node = document.querySelector(selector);
    if (!node) {
      node = document.createElement("meta");
      if (selector.includes("property=")) {
        node.setAttribute("property", selector.match(/property="([^"]+)"/)[1]);
      } else {
        node.setAttribute("name", selector.match(/name="([^"]+)"/)[1]);
      }
      document.head.appendChild(node);
    }
    node.setAttribute(attr, value);
  };

  setMeta('meta[name="description"]', "content", description);
  setMeta('meta[name="keywords"]', "content", keywords);
  setMeta('meta[property="og:title"]', "content", title);
  setMeta('meta[property="og:description"]', "content", description);
  setMeta('meta[property="og:type"]', "content", "website");
  setMeta('meta[property="og:image"]', "content", new URL(profile.portrait, location.href).href);
  setMeta('meta[name="twitter:card"]', "content", "summary_large_image");
  setMeta('meta[name="twitter:title"]', "content", title);
  setMeta('meta[name="twitter:description"]', "content", description);
  setMeta('meta[name="twitter:image"]', "content", new URL(profile.portrait, location.href).href);
};

applySeo();

const navLinks = () =>
  nav
    .map((item) => `<a data-nav href="${item.href}">${escapeHtml(item.label)}</a>`)
    .join("");

const marquee = [0, 1]
  .map(
    () =>
      `<div class="marquee-group">${profile.disciplines
        .map((item) => `<span>${escapeHtml(item)}<i></i></span>`)
        .join("")}</div>`
  )
  .join("");

const about = profile.about.map((paragraph) => `<p class="reveal">${escapeHtml(paragraph)}</p>`).join("");

const stats = profile.stats
  .map(
    (stat) =>
      `<div><dt>${escapeHtml(stat.label)}</dt><dd>${escapeHtml(stat.value)}</dd></div>`
  )
  .join("");

const work = profile.work
  .map(
    (item, index) => `
      <article class="row reveal" style="transition-delay:${index * 0.06}s">
        <span>${pad(index + 1)}</span>
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.text)}</p>
        </div>
        <em>↗</em>
      </article>`
  )
  .join("");

const selected = profile.selected
  .map(
    (item, index) => `
      <a class="gallery-card reveal" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" style="transition-delay:${index * 0.08}s">
        <div class="gallery-shot">
          <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)} website screenshot" loading="lazy" />
        </div>
        <div class="gallery-body">
          <small>${escapeHtml(item.category)}</small>
          <h3>${escapeHtml(item.name)}</h3>
          <p>${escapeHtml(item.blurb)}</p>
          <ul>${item.tags.map((tag) => `<li>${escapeHtml(tag)}</li>`).join("")}</ul>
          <span class="gallery-link">Visit live site <em>↗</em></span>
        </div>
      </a>`
  )
  .join("");

const brands = (profile.brands || [])
  .map((item, index) => {
    const tags = (item.tags || []).map((tag) => `<li>${escapeHtml(tag)}</li>`).join("");
    const body = `
        <small>${escapeHtml(item.category)}</small>
        <h3>${escapeHtml(item.name)}</h3>
        <p>${escapeHtml(item.blurb)}</p>
        <ul>${tags}</ul>
        ${
          item.url
            ? `<span class="gallery-link">Visit live site <em>↗</em></span>`
            : `<span class="brand-chip">Brand work</span>`
        }`;
    if (item.url) {
      return `
      <a class="brand-card reveal" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer" style="transition-delay:${index * 0.05}s">
        ${body}
      </a>`;
    }
    return `
      <article class="brand-card brand-card-static reveal" style="transition-delay:${index * 0.05}s">
        ${body}
      </article>`;
  })
  .join("");

const cases = profile.cases
  .map(
    (item, index) => `
      <article class="case reveal" style="transition-delay:${index * 0.08}s">
        <header>
          <b>${pad(index + 1)}</b>
          <div>
            <h3>${escapeHtml(item.brand)}</h3>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url.replace(/^https?:\/\//, "").replace(/\/$/, ""))} ↗</a>
          </div>
        </header>
        <div class="case-grid">
          <div>
            <small>Problem</small>
            <p>${escapeHtml(item.problem)}</p>
          </div>
          <div>
            <small>What I built</small>
            <p>${escapeHtml(item.built)}</p>
          </div>
          <div>
            <small>Result</small>
            <p>${escapeHtml(item.result)}</p>
          </div>
        </div>
        <dl class="case-metrics">
          ${item.metrics
            .map(
              (metric) =>
                `<div><dd>${escapeHtml(metric.value)}</dd><dt>${escapeHtml(metric.label)}</dt></div>`
            )
            .join("")}
        </dl>
      </article>`
  )
  .join("");

const testimonials = profile.testimonials
  .map(
    (item, index) => `
      <figure class="quote reveal" style="transition-delay:${index * 0.08}s">
        <blockquote>${escapeHtml(item.quote)}</blockquote>
        <figcaption>
          <strong>${escapeHtml(item.name)}</strong>
          <span>${escapeHtml(item.role)}</span>
        </figcaption>
      </figure>`
  )
  .join("");

const achievements = profile.achievements
  .map(
    (item, index) => `
      <article class="reveal" style="transition-delay:${index * 0.06}s">
        <b>${pad(index + 1)}</b>
        <div>
          <small>${escapeHtml(item.year)}</small>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </div>
      </article>`
  )
  .join("");

const background = profile.background
  .map(
    (item, index) => `
      <li class="reveal" style="transition-delay:${index * 0.06}s">
        <span>${escapeHtml(item.year)}</span>
        <div>
          <h3>${escapeHtml(item.title)}</h3>
          <p>${escapeHtml(item.detail)}</p>
        </div>
      </li>`
  )
  .join("");

const posts = (profile.posts || [])
  .slice(0, 3)
  .map(
    (post, index) => `
      <a class="post reveal" href="${escapeHtml(post.href || `/blog/${post.id}/`)}" style="transition-delay:${index * 0.08}s">
        <div class="post-meta">
          <small>${escapeHtml(post.date)}</small>
          <span>${escapeHtml(post.tag)}</span>
        </div>
        <h3>${escapeHtml(post.title)}</h3>
        <p>${escapeHtml(post.excerpt)}</p>
        <span class="post-cta">Read full article <em>→</em></span>
      </a>`
  )
  .join("") || `<p class="section-note reveal">New SEO articles publish daily. <a href="/blog/">Open the blog →</a></p>`;

const viewMoreBuilding =
  blogMeta.archiveCount > 0
    ? `<div class="blog-more reveal">
        <a class="blog-more-btn" href="${escapeHtml(blogMeta.viewMore || "/blog/#archive")}">
          <span>View more building</span>
          <em>${blogMeta.archiveCount} earlier note${blogMeta.archiveCount === 1 ? "" : "s"} →</em>
        </a>
      </div>`
    : "";

const needOptions = profile.form.needs
  .map((need) => `<option value="${escapeHtml(need)}">${escapeHtml(need)}</option>`)
  .join("");

const budgetOptions = profile.form.budgets
  .map((budget) => `<option value="${escapeHtml(budget)}">${escapeHtml(budget)}</option>`)
  .join("");

const socials = profile.socials
  .map(
    (item) => `
      <a
        class="reveal app-link"
        href="${escapeHtml(item.href)}"
        data-app="${escapeHtml(item.app || "")}"
        data-web="${escapeHtml(item.href)}"
        rel="noreferrer"
      >
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(item.handle)}</span>
        <em>↗</em>
      </a>`
  )
  .join("");

const mobileNav = nav
  .map(
    (item, index) =>
      `<a data-nav href="${item.href}"><em>${pad(index + 1)}</em>${escapeHtml(item.label)}</a>`
  )
  .join("");

document.getElementById("root").innerHTML = `
  <div class="page">
    <div class="progress"></div>
    <div class="cursor-ring"></div>
    <div class="cursor-dot"></div>
    <div class="loader" ${reduce ? "hidden" : ""}>
      <div class="loader-inner">
        <p>Portfolio</p>
        <strong>${escapeHtml(profile.name)}</strong>
        <div class="loader-bar"><span></span></div>
      </div>
    </div>
    <header class="nav">
      <a class="brand" data-nav href="#top">
        <span>${escapeHtml(profile.name)}</span>
        <small>Owner / Developer</small>
      </a>
      <nav class="desk-nav" aria-label="Primary">${navLinks()}</nav>
      <button class="menu-btn" type="button" aria-expanded="false" aria-controls="mobile-menu">
        <span>Menu</span>
      </button>
    </header>
    <div id="mobile-menu" class="menu" aria-hidden="true">
      <nav aria-label="Mobile">${mobileNav}</nav>
    </div>
    <main>
      <section id="top" class="hero">
        <div class="hero-top">
          <p class="kicker"><i></i>${escapeHtml(profile.availability)}</p>
          <p class="meta">${escapeHtml(profile.location)}<span data-clock>--:--</span></p>
        </div>
        <div class="hero-grid">
          <div>
            <h1 class="name" aria-label="${escapeHtml(profile.name)}">${letters}</h1>
            <p class="role">${escapeHtml(roleLead)}<em>& ${escapeHtml(roleRest)}</em></p>
          </div>
          <div class="portrait-wrap">
            <figure class="portrait">
              <img src="${escapeHtml(profile.portrait)}" alt="${escapeHtml(profile.name)} portrait" width="768" height="1024" />
              <figcaption>Owner · Operator · Builder</figcaption>
            </figure>
          </div>
        </div>
        <div class="hero-bottom">
          <p>${escapeHtml(profile.intro)}</p>
          <a class="scroll-cue" data-nav href="#selected"><span>See the work</span><b></b></a>
        </div>
      </section>
      <div class="marquee" aria-hidden="true">
        <div class="marquee-track">${marquee}</div>
      </div>
      <section id="about" class="section">
        <div class="section-index"><span>01</span>About</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.aboutTitle)}</h2>
          <div class="about-copy">${about}</div>
          <dl class="stats reveal">${stats}</dl>
        </div>
      </section>
      <section id="work" class="section">
        <div class="section-index"><span>02</span>Work</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.workTitle)}</h2>
          <div class="rows">${work}</div>
        </div>
      </section>
      <section id="selected" class="section">
        <div class="section-index"><span>03</span>Selected</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.selectedTitle)}</h2>
          <p class="section-note reveal">${escapeHtml(profile.selectedNote)}</p>
          <div class="gallery">${selected}</div>
        </div>
      </section>
      <section id="brands" class="section">
        <div class="section-index"><span>04</span>Brands</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.brandsTitle)}</h2>
          <p class="section-note reveal">${escapeHtml(profile.brandsNote)}</p>
          <div class="brand-grid">${brands}</div>
        </div>
      </section>
      <section id="cases" class="section">
        <div class="section-index"><span>05</span>Cases</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.casesTitle)}</h2>
          <div class="cases">${cases}</div>
        </div>
      </section>
      <section id="testimonials" class="section">
        <div class="section-index"><span>06</span>Voice</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.testimonialsTitle)}</h2>
          <p class="section-note reveal">${escapeHtml(profile.testimonialsNote)}</p>
          <div class="quotes">${testimonials}</div>
        </div>
      </section>
      <section id="achievements" class="section">
        <div class="section-index"><span>07</span>Achievements</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.achievementsTitle)}</h2>
          <div class="achievements">${achievements}</div>
        </div>
      </section>
      <section id="background" class="section">
        <div class="section-index"><span>08</span>Background</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.backgroundTitle)}</h2>
          <ol class="timeline">${background}</ol>
        </div>
      </section>
      <section id="blog" class="section">
        <div class="section-index"><span>09</span>Blog</div>
        <div>
          <h2 class="reveal">${escapeHtml(profile.blogTitle)}</h2>
          <p class="section-note reveal">${escapeHtml(profile.blogNote)}</p>
          <div class="posts">${posts}</div>
          ${viewMoreBuilding}
        </div>
      </section>
      <section id="connect" class="section section-connect">
        <div class="section-index"><span>10</span>Connect</div>
        <div class="connect-panel">
          <h2 class="reveal">${escapeHtml(profile.connectTitle)}</h2>
          <p class="connect-note reveal">${escapeHtml(profile.connectNote)}</p>
          <form class="brief reveal" id="brief-form" novalidate>
            <div class="brief-head">
              <strong>${escapeHtml(profile.form.title)}</strong>
              <span>Sends to my WhatsApp (+91 95209 75907)</span>
            </div>
            <label>
              <span>Name</span>
              <input name="name" type="text" autocomplete="name" placeholder="Your name" required />
            </label>
            <label>
              <span>WhatsApp number</span>
              <input
                name="phone"
                type="tel"
                inputmode="tel"
                autocomplete="tel"
                placeholder="+91 98765 43210"
                required
              />
            </label>
            <label>
              <span>What do you need?</span>
              <select name="need" required>
                <option value="" disabled selected>Select one</option>
                ${needOptions}
              </select>
            </label>
            <label>
              <span>Budget</span>
              <select name="budget" required>
                <option value="" disabled selected>Select a range</option>
                ${budgetOptions}
              </select>
            </label>
            <button type="submit">${escapeHtml(profile.form.submit)}</button>
            <p class="form-status" hidden></p>
          </form>
          <div class="socials">${socials}</div>
          <div class="connect-foot">
            <button type="button" data-top>Back to top</button>
          </div>
        </div>
      </section>
    </main>
    <footer class="footer">
      <span>© ${new Date().getFullYear()} ${escapeHtml(profile.name)}</span>
      <span>${escapeHtml(profile.role)}</span>
    </footer>
  </div>
`;

const page = document.querySelector(".page");
const hero = document.querySelector(".hero");
const loader = document.querySelector(".loader");
const menu = document.querySelector(".menu");
const menuButton = document.querySelector(".menu-btn");
let lockedScroll = 0;

menu.inert = true;

const lockPage = (locked) => {
  if (locked) {
    lockedScroll = window.scrollY;
    document.body.classList.add("menu-lock");
    document.body.style.position = "fixed";
    document.body.style.top = `-${lockedScroll}px`;
    document.body.style.width = "100%";
    return;
  }

  document.body.classList.remove("menu-lock");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  window.scrollTo(0, lockedScroll);
};

const progress = document.querySelector(".progress");
const clock = document.querySelector("[data-clock]");

const boot = () => {
  hero.classList.add("is-booted");
  if (loader) loader.classList.add("is-done");
};

if (reduce) boot();
else window.setTimeout(boot, 1150);

const tick = () => {
  clock.textContent = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};
tick();
window.setInterval(tick, 1000);

const go = (href) => {
  closeMenu();
  document.querySelector(href)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
};

const closeMenu = () => {
  const wasOpen = menu.classList.contains("is-open");
  menu.classList.remove("is-open");
  menu.setAttribute("aria-hidden", "true");
  menu.inert = true;
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.querySelector("span").textContent = "Menu";
  document.querySelector(".nav").classList.remove("is-open");
  if (wasOpen) lockPage(false);
};

document.querySelectorAll("[data-nav]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    go(link.getAttribute("href"));
  });
});

document.querySelector("[data-top]").addEventListener("click", () => go("#top"));

menuButton.addEventListener("click", () => {
  const open = !menu.classList.contains("is-open");
  menu.classList.toggle("is-open", open);
  menu.setAttribute("aria-hidden", String(!open));
  menu.inert = !open;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.querySelector("span").textContent = open ? "Close" : "Menu";
  document.querySelector(".nav").classList.toggle("is-open", open);
  lockPage(open);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});

const onScroll = () => {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  const y = window.scrollY;
  progress.style.transform = `scaleX(${max > 0 ? y / max : 0})`;
  page.classList.toggle("is-scrolled", y > 12);
};
onScroll();
window.addEventListener("scroll", onScroll, { passive: true });

const sections = ["#top", ...nav.map((item) => item.href)]
  .map((href) => document.querySelector(href))
  .filter(Boolean);

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll(".desk-nav [data-nav]").forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${entry.target.id}`);
      });
    });
  },
  { rootMargin: "-45% 0px -45% 0px" }
);
sections.forEach((section) => observer.observe(section));

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in");
      revealObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.12 }
);
document.querySelectorAll(".reveal").forEach((node) => revealObserver.observe(node));

if (window.matchMedia("(pointer: fine)").matches) {
  const dot = document.querySelector(".cursor-dot");
  const ring = document.querySelector(".cursor-ring");
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let rx = x;
  let ry = y;

  window.addEventListener("pointermove", (event) => {
    x = event.clientX;
    y = event.clientY;
    document.body.classList.remove("cursor-hidden");
  });
  window.addEventListener("pointerover", (event) => {
    document.body.classList.toggle(
      "cursor-grow",
      Boolean(event.target.closest("a, button, input, select, label"))
    );
  });
  document.addEventListener("mouseleave", () => document.body.classList.add("cursor-hidden"));

  const loop = () => {
    rx += (x - rx) * 0.16;
    ry += (y - ry) * 0.16;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

document.querySelectorAll(".gallery-card, .brand-card").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    card.style.setProperty("--x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--y", `${event.clientY - rect.top}px`);
  });
});

const openAppLink = (appUrl, webUrl) => {
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (!mobile || !appUrl) {
    window.open(webUrl, "_blank", "noopener,noreferrer");
    return;
  }

  let settled = false;
  const fallback = window.setTimeout(() => {
    if (!settled) window.location.href = webUrl;
  }, 1100);

  const cancel = () => {
    settled = true;
    window.clearTimeout(fallback);
  };

  window.addEventListener("pagehide", cancel, { once: true });
  window.addEventListener("blur", cancel, { once: true });
  window.location.href = appUrl;
};

document.querySelectorAll(".app-link").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openAppLink(link.dataset.app, link.dataset.web || link.href);
  });
});

const whatsapp = profile.socials.find((item) => item.label === "WhatsApp");
const whatsappBase = whatsapp?.href || "https://wa.me/";
const whatsappApp = whatsapp?.app || "";

document.getElementById("brief-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = form.querySelector(".form-status");
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  const phone = String(data.get("phone") || "").trim();
  const need = String(data.get("need") || "").trim();
  const budget = String(data.get("budget") || "").trim();
  const phoneDigits = phone.replace(/\D/g, "");

  if (!name || !phone || !need || !budget) {
    status.hidden = false;
    status.textContent = "Please fill name, WhatsApp number, need, and budget.";
    return;
  }

  if (phoneDigits.length < 10) {
    status.hidden = false;
    status.textContent = "Enter a valid WhatsApp number (at least 10 digits).";
    return;
  }

  const message = [
    "Hi Altmash — project brief from your website.",
    `Name: ${name}`,
    `WhatsApp: ${phone}`,
    `Need: ${need}`,
    `Budget: ${budget}`,
  ].join("\n");

  const webUrl = `${whatsappBase}?text=${encodeURIComponent(message)}`;
  const appUrl = whatsappApp
    ? `${whatsappApp}${whatsappApp.includes("?") ? "&" : "?"}text=${encodeURIComponent(message)}`
    : "";

  status.hidden = false;
  status.textContent = "Opening WhatsApp…";
  openAppLink(appUrl, webUrl);
});
