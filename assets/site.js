// assets/site.js
// Date - 2026-02-03
// Version - 1.0.0
// Notes - Global header/menu behavior + optional weather pill updater
// Author - David Taylor

(() => {
  // =========================
  // Hamburger Menu
  // =========================
  const openBtn = document.getElementById("menuBtn");
  const overlay = document.getElementById("menuOverlay");
  const closeBtn = document.getElementById("menuClose");

  function openMenu() {
    if (!overlay) return;
    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    // focus close for accessibility
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
      if (e.target === overlay) closeMenu(); // click outside panel
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  // =========================
  // Weather Pill (optional across pages)
  // =========================
  const WEATHER_ENDPOINT =
    "https://paradise-weather.paradise-surfsidesc.workers.dev/api/weather";

  async function loadWeather() {
    const tempEl = document.getElementById("weatherTemp");
    const iconEl = document.getElementById("weatherIcon");
    const pillEl = document.getElementById("weather");

    // If a page doesn't include the IDs, do nothing.
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
