// assets/site.js
// Date - 2026-02-03
// Version - 1.1.0
// Notes - Injects normalized header + hamburger menu on any page with <header id="siteHeader"></header>.
//         Then wires menu behavior and updates the weather pill across pages.
// Author - David Taylor

(() => {
  // =========================
  // Render Header + Menu (Single Source of Truth)
  // Requirement: each page should include: <header id="siteHeader"></header>
  // =========================
  function renderHeaderAndMenu() {
    const headerMount = document.getElementById("siteHeader");
    if (!headerMount) return;

    headerMount.innerHTML = `
      <div class="topbar">
        <a class="brand" href="index.html" aria-label="Return to home">Paradise</a>

        <div class="header-actions">
          <a
            class="weather"
            id="weather"
            href="https://tempestwx.com/station/204460/grid"
            target="_blank"
            rel="noopener noreferrer"
            title="Live on-site weather station (opens in a new tab)"
            aria-label="View current on-site weather from the Paradise Tempest weather station"
          >
            <span>Current Weather</span>
            <span id="weatherIcon">⛅</span>
            <span id="weatherTemp">—</span>
          </a>

          <button
            class="menu-btn"
            id="menuBtn"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-controls="menuOverlay"
          >☰</button>
        </div>
      </div>

      <div class="menu-overlay" id="menuOverlay" aria-hidden="true">
        <div class="menu-panel" role="dialog" aria-modal="true" aria-label="Site menu">
          <div class="menu-head">
            <p class="menu-title">Menu</p>
            <button class="menu-close" id="menuClose" aria-label="Close menu">✕</button>
          </div>

          <div class="menu-grid">
            <a class="menu-link" href="plan-your-stay.html">
              <div>
                Plan Your Stay
                <span class="menu-sub">Start here — food, events, and essentials</span>
              </div>
              <span>›</span>
            </a>

            <a class="menu-link" href="things-to-do.html">
              <div>
                Things To Do
                <span class="menu-sub">Nearby, parks, mini golf, golf, and more</span>
              </div>
              <span>›</span>
            </a>

            <a class="menu-link" href="paradise-info.html">
              <div>
                Paradise Info
                <span class="menu-sub">House details, amenities, quick answers</span>
              </div>
              <span>›</span>
            </a>

            <a class="menu-link" href="events.html">
              <div>
                Events
                <span class="menu-sub">Live music, shows, and annual events</span>
              </div>
              <span>›</span>
            </a>

            <a class="menu-link" href="photos.html">
              <div>
                Photos
                <span class="menu-sub">Explore the home</span>
              </div>
              <span>›</span>
            </a>

            <a class="menu-link" href="videos.html">
              <div>
                Videos
                <span class="menu-sub">Walkthroughs & highlights</span>
              </div>
              <span>›</span>
            </a>

            <a class="menu-link" href="floor-plans.html">
              <div>
                Floor Plans
                <span class="menu-sub">Layout and room flow</span>
              </div>
              <span>›</span>
            </a>

            <a
              class="menu-link"
              href="https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise"
              target="_blank"
              rel="noopener noreferrer"
            >
              <div>
                Book Now
                <span class="menu-sub">Check availability / reserve</span>
              </div>
              <span>↗</span>
            </a>
          </div>

          <div class="menu-foot">
            <span>Surfside Beach, SC</span>
            <a
              class="btn primary"
              href="https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book Now
            </a>
          </div>
        </div>
      </div>
    `;
  }

  // Render first so the DOM contains the elements we wire up next.
  renderHeaderAndMenu();

  // =========================
  // Hamburger Menu (wired after render)
  // =========================
  const openBtn = document.getElementById("menuBtn");
  const overlay = document.getElementById("menuOverlay");
  const closeBtn = document.getElementById("menuClose");

  function openMenu() {
    if (!overlay) return;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (closeBtn) closeBtn.focus();
  }

  function closeMenu() {
    if (!overlay) return;
    overlay.classList.remove("open");
    overlay.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    if (openBtn) openBtn.focus();
  }

  if (openBtn && overlay) {
    openBtn.addEventListener("click", openMenu);
  }
  if (closeBtn) {
    closeBtn.addEventListener("click", closeMenu);
  }
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeMenu();
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // =========================
  // Weather Pill (works on any page with injected header)
  // =========================
  const WEATHER_ENDPOINT =
    "https://paradise-weather.paradise-surfsidesc.workers.dev/api/weather";

  async function loadWeather() {
    const tempEl = document.getElementById("weatherTemp");
    const iconEl = document.getElementById("weatherIcon");
    const pillEl = document.getElementById("weather");

    if (!tempEl || !iconEl || !pillEl) return;

    try {
      const res = await fetch(WEATHER_ENDPOINT, { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);

      const data = await res.json();
      if (!data || data.ok !== true) throw new Error("Bad payload");

      const tempNum = Number(data.temp_f);
      const tempText = Number.isFinite(tempNum) ? Math.round(tempNum) + "°" : "—";

      tempEl.textContent = tempText;
      iconEl.textContent = data.icon || "⛅";

      const condition = data.condition ? `, ${data.condition}` : "";
      pillEl.setAttribute(
        "aria-label",
        `Current Weather at the House from the on-site weather station: ${tempText}${condition}`
      );
    } catch (e) {
      tempEl.textContent = "—";
    }
  }

  loadWeather();
  setInterval(loadWeather, 5 * 60 * 1000);
})();
