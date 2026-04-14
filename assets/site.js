// site.js
// Date - 2026-04-14
// Version - 1.1.0
// Notes - Injected header/menu with Paradise logo, weather chip, simplified nav, and dark hero logo switching
// Author - David Taylor

document.addEventListener('DOMContentLoaded', () => {
  injectHeader();
  setupMenu();
  applyHeaderTheme();
  setupScrollTheme();
});

function injectHeader() {
  const headerHost = document.getElementById('siteHeader');
  if (!headerHost) return;

  headerHost.innerHTML = `
    <div class="site-header">
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
          href="https://tempestwx.com/station/204460/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View live weather for Surfside Beach"
        >
          Weather
        </a>

        <button
          class="menu-toggle"
          type="button"
          aria-label="Open menu"
          aria-expanded="false"
          aria-controls="siteMenu"
        >
          Menu
        </button>
      </div>

      <nav id="siteMenu" class="site-menu" aria-label="Main navigation">
        <a href="index.html">Home</a>
        <a href="paradise-info.html">Paradise Info</a>
        <a href="plan-your-stay.html">Plan Your Stay</a>
        <a
          href="https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise"
          target="_blank"
          rel="noopener noreferrer"
        >Book Now</a>
      </nav>
    </div>
  `;
}

function setupMenu() {
  const toggle = document.querySelector('.menu-toggle');
  const menu = document.querySelector('.site-menu');

  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    const isOpen = menu.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(isOpen));
  });

  document.addEventListener('click', (event) => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    if (header.contains(event.target)) return;

    menu.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  });
}

function applyHeaderTheme() {
  const header = document.querySelector('.site-header');
  if (!header) return;

  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const darkPages = ['index.html'];

  if (darkPages.includes(currentPage)) {
    header.classList.add('is-dark');
  } else {
    header.classList.remove('is-dark');
  }
}

function setupScrollTheme() {
  const header = document.querySelector('.site-header');
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
