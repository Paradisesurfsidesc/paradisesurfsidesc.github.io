// site.js
// Date - 2026-04-14
// Version - 1.3.0
// Notes - Aligned with styles.css v1.2.0; replaced overlay menu with .site-menu dropdown; fixed header class injection
// Author - David Taylor

document.addEventListener('DOMContentLoaded', () => {
  injectHeader();
  setupMenu();
  applyHeaderTheme();
  setupScrollTheme();
  loadWeather();
});

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

  // Close on outside click
  document.addEventListener('click', (e) => {
    const header = document.querySelector('.site-header');
    if (header && !header.contains(e.target)) closeMenu();
  });

  // Close on Escape
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
    const response = await fetch('assets/weather.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    tempEl.textContent = typeof data.tempF === 'number' ? `${Math.round(data.tempF)}°` : '--°';
    condEl.textContent = data.condition || 'Live Weather';
  } catch {
    tempEl.textContent = '--°';
    condEl.textContent = 'Live Weather';
  }
}
