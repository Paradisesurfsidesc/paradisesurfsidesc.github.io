(function () {
  const API_BASE = (window.PARADISE_EVENTS_API_BASE || "").replace(/\/+$/, "");
  const weekEl = document.getElementById("events-week");
  const monthEl = document.getElementById("events-month");

  function esc(s){return String(s||"").replace(/[&<>"]/g, c=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c]));}
  function fmt(d){
    try {
      return new Date(d).toLocaleString([], { weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
    } catch { return ""; }
  }
  function render(items){
    if (!items || !items.length) return "<p class='muted'>No upcoming events found.</p>";
    return "<ul class='ul'>" + items.map(e=>{
      const title = esc(e.title);
      const when = e.start ? fmt(e.start) : "";
      const loc = e.location ? " · " + esc(e.location) : "";
      const link = e.url ? ` — <a href="${esc(e.url)}" target="_blank" rel="noopener">Details</a>` : "";
      return `<li><strong>${title}</strong><div class="muted">${when}${loc}${link}</div></li>`;
    }).join("") + "</ul>";
  }

  async function load(){
    if (!API_BASE || API_BASE.includes("YOUR-WORKER-URL")) {
      const msg = "<p class='muted'>Events feed not configured yet. Set <code>PARADISE_EVENTS_API_BASE</code> in <code>events/index.html</code>.</p>";
      weekEl.innerHTML = msg;
      monthEl.innerHTML = msg;
      return;
    }

    const res = await fetch(`${API_BASE}/api/events?days=30`, { cache: "no-store" });
    if (!res.ok) throw new Error("Bad response");
    const data = await res.json();
    const events = (data.events || []).map(e => ({...e, start: e.start ? new Date(e.start) : null }));

    const now = Date.now();
    const weekEnd = now + 7*24*60*60*1000;

    const week = events.filter(e => e.start && e.start.getTime() <= weekEnd);
    const month = events;

    weekEl.innerHTML = render(week);
    monthEl.innerHTML = render(month);
  }

  load().catch(() => {
    weekEl.innerHTML = "<p class='muted'>Unable to load events right now.</p><p><a class='btn' href='https://www.surfsidebeach.org/calendar.aspx?CID=29' target='_blank' rel='noopener'>View Surfside Town Events</a></p>";
    monthEl.innerHTML = "<p class='muted'>Use the full town calendar link above.</p>";
  });
})(); 
