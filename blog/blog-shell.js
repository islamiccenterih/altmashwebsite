/**
 * Shared chrome for blog pages: site menu + custom cursor.
 */
(() => {
  const menuBtn = document.querySelector(".menu-btn");
  const menu = document.querySelector(".menu");
  const nav = document.querySelector(".nav");

  const closeMenu = () => {
    document.body.classList.remove("menu-lock");
    menuBtn?.setAttribute("aria-expanded", "false");
    nav?.classList.remove("is-open");
    menu?.setAttribute("aria-hidden", "true");
  };

  menuBtn?.addEventListener("click", () => {
    const open = menuBtn.getAttribute("aria-expanded") !== "true";
    menuBtn.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("menu-lock", open);
    nav?.classList.toggle("is-open", open);
    menu?.setAttribute("aria-hidden", String(!open));
  });

  document.querySelectorAll(".menu a, .desk-nav a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  const onScroll = () => {
    nav?.classList.toggle("is-scrolled", window.scrollY > 12);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  if (!window.matchMedia("(pointer: fine)").matches) return;

  const root = document.body;
  if (!root.querySelector(".cursor-dot")) {
    root.insertAdjacentHTML(
      "afterbegin",
      `<div class="cursor-ring" aria-hidden="true"></div><div class="cursor-dot" aria-hidden="true"></div>`
    );
  }

  const dot = root.querySelector(".cursor-dot");
  const ring = root.querySelector(".cursor-ring");
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  let rx = x;
  let ry = y;

  window.addEventListener("pointermove", (event) => {
    x = event.clientX;
    y = event.clientY;
    root.classList.remove("cursor-hidden");
  });
  window.addEventListener("pointerover", (event) => {
    root.classList.toggle(
      "cursor-grow",
      Boolean(event.target.closest("a, button, input, select, label"))
    );
  });
  document.addEventListener("mouseleave", () => root.classList.add("cursor-hidden"));

  const loop = () => {
    rx += (x - rx) * 0.16;
    ry += (y - ry) * 0.16;
    dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
