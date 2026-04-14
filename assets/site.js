// site.js
// Date - 2026-04-14
// Version - 1.3.1
// Notes - Fixed applyHeroImage scope; all functions now correctly outside DOMContentLoaded
// Author - David Taylor

document.addEventListener('DOMContentLoaded', () => {
  injectHeader();
  setupMenu();
  applyHeaderTheme();
  setupScrollTheme();
  applyHeroImage();
  loadWeather();
});

function applyHeroImage() {
  const heroBg = document.querySelector('.hero-bg');
  if (!heroBg) return;

  const hour = new Date().getHours();
  const isNight = hour < 7 || hour >= 19;

  heroBg.style.backgroundImage = isNight
    ? 'url("images/night.jpg")'
    : 'url("images/day.jpg")';
}

function injectHeader() {
  const headerHost = document.getElementById('siteHeader');
  if (!headerHost) return;

  headerHost.innerHTML = `
    <div class="site-header is-dark">
      <a class="site-brand" href="index.html" aria-label="Paradise home">
        <img
          class="site-logo logo-dark"
          src="images/Paradise.png"
          alt="Paradise Surfside Beach, SC"
          decoding="async"
          fetchpriority="high"
        >
        <img
          class="site-logo logo-light"
          src="images/Paradise-white.png"
          alt="Paradise Surfside Beach, SC"
          decoding="async"
          fetchpriority="high"
        >
      </a>

      <div class="site-header-actions">
        <a
          class="weather"
          id="weatherChip"
          href="https://tempestwx.com/station/204460/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Live weather for Surfside Beach"
        >
          <span id="weatherIcon">⛅</span>
          <span id="weatherTemp">--°</span>
          <span id="weatherCond">Live Weather</span>
        </a>

        <button
          class="menu-toggle"
          id="menuBtn"
          type="button"
          aria-label="Open menu"
          aria-expanded="false"
          aria-controls="siteMenu"
        >
          ☰
        </button>
      </div>

      <nav class="site-menu" id="siteMenu" aria-label="Site navigation">
        <a href="index.html">Home <span>›</span></a>
        <a href="paradise-info.html">Paradise Info <span>›</span></a>
        <a href="plan-your-stay.html">Plan Your Stay <span>›</span></a>
        <a href="signup.html">📧 Stay in the Loop <span>›</span></a>
        <a
          href="https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise"
          target="_blank"
          rel="noopener noreferrer"
        >Book Now <span>↗</span></a>
      </nav>
    </div>
  `;
}

function setupMenu() {
  const menuBtn = document.getElementById('menuBtn');
  const siteMenu = document.getElementById('siteMenu');

  if (!menuBtn || !siteMenu) return;

  function openMenu() {
    siteMenu.classList.add('is-open');
    menuBtn.setAttribute('aria-expanded', 'true');
    menuBtn.setAttribute('aria-label', 'Close menu');
  }

  function closeMenu() {
    siteMenu.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.setAttribute('aria-label', 'Open menu');
  }

  function toggleMenu() {
    siteMenu.classList.contains('is-open') ? closeMenu() : openMenu();
  }

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.addEventListener('click', (e) => {
    const header = document.querySelector('.site-header');
    if (header && !header.contains(e.target)) closeMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

function applyHeaderTheme() {
  const siteHeader = document.querySelector('.site-header');
  if (!siteHeader) return;

  const page = window.location.pathname.split('/').pop() || 'index.html';
  const isHeroPage = ['index.html', ''].includes(page);

  if (!isHeroPage) {
    siteHeader.classList.remove('is-dark');
    siteHeader.classList.add('is-solid');
  }
}

function setupScrollTheme() {
  const siteHeader = document.querySelector('.site-header');
  const hero = document.querySelector('.hero');

  if (!siteHeader || !hero) return;

  function updateTheme() {
    const triggerPoint = Math.max(hero.offsetHeight - 100, 120);
    const pastHero = window.scrollY >= triggerPoint;
    siteHeader.classList.toggle('is-dark', !pastHero);
    siteHeader.classList.toggle('is-solid', pastHero);
  }

  updateTheme();
  window.addEventListener('scroll', updateTheme, { passive: true });
  window.addEventListener('resize', updateTheme);
}

async function loadWeather() {
  const tempEl = document.getElementById('weatherTemp');
  const condEl = document.getElementById('weatherCond');

  if (!tempEl || !condEl) return;

  try {
    const response = await fetch('https://paradise-weather.paradise-surfsidesc.workers.dev/api/weather', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    if (!data || data.ok !== true) throw new Error('Bad payload');

    const iconEl = document.getElementById('weatherIcon');
    const temp = Number.isFinite(Number(data.temp_f)) ? `${Math.round(data.temp_f)}°` : '--°';
    tempEl.textContent = temp;
    condEl.textContent = data.condition || 'Live Weather';
    if (iconEl) iconEl.textContent = data.icon || '⛅';
  } catch {
    tempEl.textContent = '--°';
    condEl.textContent = 'Live Weather';
  }

  // Refresh every 5 minutes
  setTimeout(loadWeather, 5 * 60 * 1000);
}
