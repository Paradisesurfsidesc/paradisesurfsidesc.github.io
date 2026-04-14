// site.js
// Date - 2026-04-14
// Version - 1.2.0
// Notes - Restored hamburger overlay menu, live weather chip support, Paradise logo switching, simplified top nav
// Author - David Taylor

document.addEventListener('DOMContentLoaded', () => {
  injectHeader();
  injectMenuOverlay();
  setupMenu();
  applyHeaderTheme();
  setupScrollTheme();
  loadWeather();
});

function injectHeader() {
  const headerHost = document.getElementById('siteHeader');
  if (!headerHost) return;

  headerHost.innerHTML = `
    <div class="topbar">
      <a class="brand" href="index.html" aria-label="Paradise home">
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

      <div class="header-actions">
        <a
          class="weather"
          id="weatherChip"
          href="https://tempestwx.com/station/204460/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Live weather for Surfside Beach"
        >
          <span id="weatherTemp">--°</span>
          <span id="weatherCond">Loading</span>
        </a>

        <button
          class="menu-btn"
          id="menuBtn"
          type="button"
          aria-label="Open menu"
          aria-expanded="false"
          aria-controls="menuOverlay"
        >
          ☰
        </button>
      </div>
    </div>
  `;
}

function injectMenuOverlay() {
  if (document.getElementById('menuOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'menuOverlay';
  overlay.className = 'menu-overlay';
  overlay.setAttribute('aria-hidden', 'true');

  overlay.innerHTML = `
    <div class="menu-panel" role="dialog" aria-modal="true" aria-label="Site menu">
      <div class="menu-head">
        <h2 class="menu-title">Menu</h2>
        <button class="menu-close" id="menuClose" type="button" aria-label="Close menu">✕</button>
      </div>

      <div class="menu-grid">
        <a class="menu-link" href="index.html">
          <span>
            Home
            <span class="menu-sub">Return to the main page</span>
          </span>
          <span>›</span>
        </a>

        <a class="menu-link" href="paradise-info.html">
          <span>
            Paradise Info
            <span class="menu-sub">House details, photos, floor plan, and video</span>
          </span>
          <span>›</span>
        </a>

        <a class="menu-link" href="plan-your-stay.html">
          <span>
            Plan Your Stay
            <span class="menu-sub">Things to do, events, dining, and local tips</span>
          </span>
          <span>›</span>
        </a>

        <a
          class="menu-link"
          href="https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span>
            Book Now
            <span class="menu-sub">Reserve your stay</span>
          </span>
          <span>↗</span>
        </a>
      </div>

      <div class="menu-foot">
        <span>Surfside Beach, SC</span>
        <span>Paradise</span>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
}

function setupMenu() {
  const menuBtn = document.getElementById('menuBtn');
  const menuClose = document.getElementById('menuClose');
  const menuOverlay = document.getElementById('menuOverlay');

  if (!menuBtn || !menuClose || !menuOverlay) return;

  function openMenu() {
    menuOverlay.classList.add('open');
    menuOverlay.setAttribute('aria-hidden', 'false');
    menuBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    menuOverlay.classList.remove('open');
    menuOverlay.setAttribute('aria-hidden', 'true');
    menuBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  }

  menuBtn.addEventListener('click', openMenu);
  menuClose.addEventListener('click', closeMenu);

  menuOverlay.addEventListener('click', (event) => {
    if (event.target === menuOverlay) closeMenu();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menuOverlay.classList.contains('open')) {
      closeMenu();
    }
  });
}

function applyHeaderTheme() {
  const header = document.querySelector('header');
  if (!header) return;

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const darkPages = ['index.html', 'videos.html'];

  header.classList.toggle('is-dark', darkPages.includes(currentPage));
}

function setupScrollTheme() {
  const header = document.querySelector('header');
  const hero = document.querySelector('.hero');

  if (!header) return;

  if (!hero) {
    header.classList.remove('is-dark');
    header.classList.add('is-solid');
    return;
  }

  function updateTheme() {
    const triggerPoint = Math.max(hero.offsetHeight - 100, 120);
    const useDarkLogo = window.scrollY < triggerPoint;

    header.classList.toggle('is-dark', useDarkLogo);
    header.classList.toggle('is-solid', window.scrollY > 20 || !useDarkLogo);
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
    // Replace this URL with your secure weather endpoint if you have one.
    // Do NOT put your private Tempest API token directly into public site.js.
    const response = await fetch('assets/weather.json', { cache: 'no-store' });

    if (!response.ok) {
      throw new Error(`Weather request failed: ${response.status}`);
    }

    const data = await response.json();

    const temp = typeof data.tempF === 'number' ? `${Math.round(data.tempF)}°` : '--°';
    const cond = data.condition || 'Live Weather';

    tempEl.textContent = temp;
    condEl.textContent = cond;
  } catch (error) {
    tempEl.textContent = '--°';
    condEl.textContent = 'Live Weather';
    console.warn('Weather load failed:', error);
  }
}
