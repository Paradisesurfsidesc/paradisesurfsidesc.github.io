// site.js
// Date - 2026-04-19
// Version - 1.3.4
// Notes - GA4 restored; guest/public menu split; logo links to guest hub on guest pages
// Author - David Taylor

document.addEventListener('DOMContentLoaded', () => {
  injectHeader();
  setupMenu();
  applyHeaderTheme();
  setupScrollTheme();
  applyHeroImage();
  loadWeather();
  loadGA4();
  loadKlaviyo();
});

function injectHeader() {
  const headerHost = document.getElementById('siteHeader');
  if (!headerHost) return;

  const isGuest = window.location.pathname.includes('/guest/');

  const guestMenu = `
    <a href="/guest/index.html">🏠 Welcome <span>›</span></a>
    <a href="/guest/checkin.html">🏠 Check-In <span>›</span></a>
    <a href="/guest/checkout.html">✅ Checkout <span>›</span></a>
    <a href="/guest/wifi.html">📶 WiFi <span>›</span></a>
    <a href="/dining-entertainment.html">🍽️ Dining & Entertainment <span>›</span></a>
    <a href="/guest/pool.html">🏊 Pool <span>›</span></a>
    <a href="/guest/house.html">🏡 The House <span>›</span></a>
    <a href="/guest/trash.html">🗑️ Trash & Recycling <span>›</span></a>
    <a href="/guest/parking.html">🚗 Parking <span>›</span></a>
    <a href="/guest/help.html">🙋 Help & Contacts <span>›</span></a>
    <hr style="border-color:rgba(255,255,255,.12); margin:.25rem 0;">
    <a href="/plan-your-stay.html">🧭 Plan Your Stay <span>›</span></a>
    <a href="/paradise-info.html">🏠 Paradise Info <span>›</span></a>
    <a href="/index.html">🌐 Paradise Home <span>›</span></a>
  `;

  const publicMenu = `
    <a href="/index.html">Home <span>›</span></a>
    <a href="/paradise-info.html">Paradise Info <span>›</span></a>
    <a href="/plan-your-stay.html">Plan Your Stay <span>›</span></a>
    <a href="/local-cams.html">📷 Live Cams <span>›</span></a>
    <a href="/signup.html">📧 Sign Up — Stay in the Loop <span>›</span></a>
    <a
      href="https://www.southerncoastvacations.com/myrtle-beach-vacation-rentals/paradise"
      target="_blank"
      rel="noopener noreferrer"
    >Book Now <span>↗</span></a>
  `;

  headerHost.innerHTML = `
    <div class="site-header is-dark">
      <a class="site-brand" href="${isGuest ? '/guest/index.html' : '/index.html'}" aria-label="Paradise home">
        <img
          class="site-logo logo-dark"
          src="/images/Paradise.png"
          alt="Paradise Surfside Beach, SC"
          decoding="async"
          fetchpriority="high"
        >
        <img
          class="site-logo logo-light"
          src="/images/Paradise-white.png"
          alt="Paradise Surfside Beach, SC"
          decoding="async"
          fetchpriority="high"
        >
      </a>

      <div class="site-header-actions">
        <a
          class="weather"
          id="weatherChip"
          href="/weather.html"
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
        ${isGuest ? guestMenu : publicMenu}
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

function applyHeroImage() {
  const heroBg = document.querySelector('.hero-bg');
  if (!heroBg) return;

  const hour = new Date().getHours();
  const isNight = hour < 7 || hour >= 19;

  heroBg.style.backgroundImage = isNight
    ? 'url("/images/night.jpg")'
    : 'url("/images/day.jpg")';
}

async function loadWeather() {
  const tempEl = document.getElementById('weatherTemp');
  const condEl = document.getElementById('weatherCond');
  const iconEl = document.getElementById('weatherIcon');

  if (!tempEl || !condEl) return;

  try {
    const response = await fetch('https://paradise-weather.paradise-surfsidesc.workers.dev/api/weather', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Status ${response.status}`);

    const data = await response.json();
    if (!data || data.ok !== true) throw new Error('Bad payload');

    const temp = Number.isFinite(Number(data.temp_f)) ? `${Math.round(data.temp_f)}°` : '--°';
    tempEl.textContent = temp;
    condEl.textContent = data.condition || 'Live Weather';
    if (iconEl) iconEl.textContent = data.icon || '⛅';
  } catch {
    tempEl.textContent = '--°';
    condEl.textContent = 'Live Weather';
  }

  setTimeout(loadWeather, 5 * 60 * 1000);
}

function loadKlaviyo() {
  const s = document.createElement('script');
  s.src = 'https://static.klaviyo.com/onsite/js/UhvABe/klaviyo.js?company_id=UhvABe';
  s.async = true;
  s.type = 'text/javascript';
  document.head.appendChild(s);

  if (!window.klaviyo) {
    window._klOnsite = window._klOnsite || [];
    try {
      window.klaviyo = new Proxy({}, { get: function(n, i) { return 'push' === i ? function() { var n; (n = window._klOnsite).push.apply(n, arguments); } : function() { for (var n = arguments.length, o = new Array(n), w = 0; w < n; w++) o[w] = arguments[w]; var t = 'function' == typeof o[o.length - 1] ? o.pop() : void 0, e = new Promise((function(n) { window._klOnsite.push([i].concat(o, [function(i) { t && t(i), n(i); }])); })); return e; }; } });
    } catch(n) {
      window.klaviyo = window.klaviyo || [];
      window.klaviyo.push = function() { var n; (n = window._klOnsite).push.apply(n, arguments); };
    }
  }
}

function loadGA4() {
  const s = document.createElement('script');
  s.src = 'https://www.googletagmanager.com/gtag/js?id=G-HFN4RF1QVT';
  s.async = true;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-HFN4RF1QVT');
}