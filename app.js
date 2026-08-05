/* ============================================================
   DOUBLE FEATURE — app.js
   ============================================================ */
(function () {
  "use strict";

  /* ---------------------------------------------------------
     CONSTANTS
     --------------------------------------------------------- */
  const DATA_PATH = "data/movies.json";
  const TMDB_IMG = "https://image.tmdb.org/t/p/w342";
  const TMDB_IMG_SM = "https://image.tmdb.org/t/p/w92";
  const GENRE_MAP = {
    28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
    27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
    878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western"
  };
  const GENRE_MAP_TV = {
    10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
    99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids", 9648: "Mystery",
    10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy", 10766: "Soap",
    10767: "Talk", 10768: "War & Politics", 37: "Western"
  };
  const SETTINGS_KEY = "df_settings_v1";
  const THEME_KEY = "df_theme_v1";

  /* ---------------------------------------------------------
     THEME
     --------------------------------------------------------- */
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) return saved;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  /* ---------------------------------------------------------
     SETTINGS (localStorage — never touches the repo)
     --------------------------------------------------------- */
  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  let settings = loadSettings();

  /* ---------------------------------------------------------
     APP STATE
     --------------------------------------------------------- */
  const state = {
    movies: [],
    filters: { status: "all", addedBy: "all", genre: "all", familiarity: "all", sort: "recent" },
    addMode: "tmdb",
    mediaKind: "movie",
    addedBy: null,
    backfill: false,
    backfillRatings: { Mary: 0, Angelo: 0 },
  };

  /* ---------------------------------------------------------
     UTILITIES
     --------------------------------------------------------- */
  function uid() { return "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDateShort(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  function avg(nums) {
    const v = nums.filter((n) => typeof n === "number" && !isNaN(n));
    if (!v.length) return null;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }
  function escapeHTML(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function utf8ToBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function movieAvg(m) { return avg([m.ratings && m.ratings.Mary, m.ratings && m.ratings.Angelo]); }
  function genreMapFor(kind) { return kind === "tv" ? GENRE_MAP_TV : GENRE_MAP; }

  function toast(msg) {
    let el = document.getElementById("df-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "df-toast";
      el.className = "df-toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add("is-visible"));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove("is-visible"), 2600);
  }

  function wireStarRow(el, initial, onChange) {
    let value = initial || 0;
    function draw() {
      el.innerHTML = [1, 2, 3, 4, 5].map((n) =>
        `<button type="button" class="star-btn${n <= value ? " is-filled" : ""}" data-n="${n}" aria-label="${n} star${n === 1 ? "" : "s"}">★</button>`
      ).join("");
    }
    draw();
    el.addEventListener("click", (e) => {
      const btn = e.target.closest(".star-btn");
      if (!btn) return;
      const n = Number(btn.dataset.n);
      value = value === n ? 0 : n;
      draw();
      onChange(value || null);
    });
    return { set: (v) => { value = v || 0; draw(); } };
  }

  /* ---------------------------------------------------------
     DATA LOAD
     --------------------------------------------------------- */
  async function loadMovies() {
    try {
      const res = await fetch(DATA_PATH + "?_=" + Date.now());
      const json = await res.json();
      state.movies = json.movies || [];
    } catch (e) {
      console.error("Failed to load movies.json", e);
      state.movies = [];
    }
    render();
  }

  /* ---------------------------------------------------------
     GITHUB SYNC
     --------------------------------------------------------- */
  async function githubGetFile() {
    const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/data/movies.json?ref=${settings.branch || "main"}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${settings.ghToken}`, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error("GitHub read failed (" + res.status + ")");
    return res.json();
  }

  async function persistMovies(message) {
    if (!settings.ghToken || !settings.owner || !settings.repo) {
      toast("Add your GitHub info in Settings to sync");
      return false;
    }
    try {
      const file = await githubGetFile();
      const content = JSON.stringify({ movies: state.movies }, null, 2) + "\n";
      const res = await fetch(
        `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/data/movies.json`,
        {
          method: "PUT",
          headers: { Authorization: `Bearer ${settings.ghToken}`, Accept: "application/vnd.github+json" },
          body: JSON.stringify({
            message: message || "Update movies.json",
            content: utf8ToBase64(content),
            sha: file.sha,
            branch: settings.branch || "main",
          }),
        }
      );
      if (!res.ok) throw new Error("GitHub write failed (" + res.status + ")");
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  /* ---------------------------------------------------------
     RENDER — WATCHLIST
     --------------------------------------------------------- */
  function posterEl(m, cls) {
    if (m.posterUrl) return `<img class="${cls}" src="${escapeHTML(m.posterUrl)}" alt="" loading="lazy">`;
    return `<div class="${cls} is-placeholder">${m.mediaKind === "tv" ? "📺" : "🎬"}</div>`;
  }

  function cardHTML(m) {
    const isTv = m.mediaKind === "tv";
    const addedTag = `<span class="tag tag-${m.addedBy.toLowerCase()}">${escapeHTML(m.addedBy)}</span>`;

    let statusTag = "";
    if (m.status === "finished") {
      const mr = m.ratings && m.ratings.Mary, ar = m.ratings && m.ratings.Angelo;
      let pills = "";
      if (typeof mr === "number") pills += `<span class="rating-pill is-mary"><span class="star">★</span>${mr}</span>`;
      if (typeof ar === "number") pills += `<span class="rating-pill is-angelo"><span class="star">★</span>${ar}</span>`;
      statusTag = pills || `<span class="tag tag-watched">Finished</span>`;
    } else if (m.status === "watching") {
      const prog = isTv && m.tv && (m.tv.season || m.tv.episode) ? ` S${m.tv.season || 1}E${m.tv.episode || 1}` : "";
      statusTag = `<span class="tag tag-watched">Watching${escapeHTML(prog)}</span>`;
    } else {
      statusTag = `<span class="tag tag-watched">To watch</span>`;
    }

    const rf = m.rewatchFor || {};
    let rewatchTag = "";
    if (rf.Mary && rf.Angelo) rewatchTag = `<span class="tag tag-rewatch">Rewatch</span>`;
    else if (rf.Mary) rewatchTag = `<span class="tag tag-rewatch">Rewatch · Mary</span>`;
    else if (rf.Angelo) rewatchTag = `<span class="tag tag-rewatch">Rewatch · Angelo</span>`;

    const metaParts = [m.year || null, isTv ? "TV" : null];
    if (m.status === "finished" && m.watchedDate) metaParts.push("watched " + fmtDate(m.watchedDate));
    const meta = metaParts.filter(Boolean).join(" · ");

    return `<button class="ticket-card" data-id="${m.id}">
      ${posterEl(m, "ticket-poster")}
      <div class="ticket-divider"></div>
      <div class="ticket-info">
        <div class="ticket-title">${escapeHTML(m.title)}</div>
        <div class="ticket-meta">${escapeHTML(meta)}</div>
        <div class="ticket-tags">${addedTag}${statusTag}${rewatchTag}</div>
      </div>
    </button>`;
  }

  function populateGenreFilter() {
    const sel = document.getElementById("filter-genre");
    const current = sel.value || "all";
    const genres = new Set();
    state.movies.forEach((m) => (m.genres || []).forEach((g) => genres.add(g)));
    const sorted = Array.from(genres).sort((a, b) => a.localeCompare(b));
    sel.innerHTML = `<option value="all">All genres</option>` + sorted.map((g) => `<option value="${escapeHTML(g)}">${escapeHTML(g)}</option>`).join("");
    if (sorted.includes(current)) sel.value = current;
    else { sel.value = "all"; state.filters.genre = "all"; }
  }

  function getFiltered() {
    let list = state.movies.slice();
    if (state.filters.status !== "all") list = list.filter((m) => m.status === state.filters.status);
    if (state.filters.addedBy !== "all") list = list.filter((m) => m.addedBy === state.filters.addedBy);
    if (state.filters.genre !== "all") list = list.filter((m) => (m.genres || []).includes(state.filters.genre));
    if (state.filters.familiarity !== "all") {
      list = list.filter((m) => {
        const rf = m.rewatchFor || { Mary: false, Angelo: false };
        switch (state.filters.familiarity) {
          case "both-new": return !rf.Mary && !rf.Angelo;
          case "mary-new": return !rf.Mary;
          case "angelo-new": return !rf.Angelo;
          case "both-rewatch": return !!(rf.Mary && rf.Angelo);
          default: return true;
        }
      });
    }
    switch (state.filters.sort) {
      case "rating-desc": list.sort((a, b) => (movieAvg(b) ?? -1) - (movieAvg(a) ?? -1)); break;
      case "rating-asc": list.sort((a, b) => (movieAvg(a) ?? 999) - (movieAvg(b) ?? 999)); break;
      case "title": list.sort((a, b) => a.title.localeCompare(b.title)); break;
      case "watched-date": list.sort((a, b) => (b.watchedDate || "").localeCompare(a.watchedDate || "")); break;
      default: list.sort((a, b) => (b.addedDate || "").localeCompare(a.addedDate || ""));
    }
    return list;
  }

  function updateEmptyState(count) {
    const emptyEl = document.getElementById("watchlist-empty");
    const gridEl = document.getElementById("watchlist-grid");
    if (count > 0) { emptyEl.hidden = true; gridEl.hidden = false; return; }
    gridEl.hidden = true;
    emptyEl.hidden = false;
    if (state.movies.length === 0) {
      emptyEl.innerHTML = `<div class="empty-title">The list is empty</div><div class="empty-body">Tap "Add" below to queue up your first movie night.</div>`;
    } else {
      emptyEl.innerHTML = `<div class="empty-title">No matches</div><div class="empty-body">Try a different filter combination.</div>`;
    }
  }

  function renderWatchlist() {
    populateGenreFilter();
    const list = getFiltered();
    document.getElementById("watchlist-count").textContent = `${list.length} title${list.length === 1 ? "" : "s"}`;
    const grid = document.getElementById("watchlist-grid");
    grid.innerHTML = list.map(cardHTML).join("");
    updateEmptyState(list.length);
    grid.querySelectorAll(".ticket-card").forEach((card) => {
      card.addEventListener("click", () => openModal(card.dataset.id));
    });
  }

  /* ---------------------------------------------------------
     RENDER — DASHBOARD
     --------------------------------------------------------- */
  function barRow(label, value, max) {
    const pct = max ? Math.round((value / max) * 100) : 0;
    return `<div class="bar-row">
      <div class="bar-row-label">${escapeHTML(label)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <div class="bar-row-value">${value}</div>
    </div>`;
  }

  function buildCumulativeChart(finished) {
    const withDates = finished.filter((m) => m.watchedDate).sort((a, b) => a.watchedDate.localeCompare(b.watchedDate));
    if (!withDates.length) return `<div class="chart-empty">No finished dates logged yet.</div>`;
    const width = 320, height = 140, padL = 6, padR = 6, padT = 10, padB = 20;
    const times = withDates.map((m) => new Date(m.watchedDate + "T00:00:00").getTime());
    const xMin = times[0], xMax = times[times.length - 1];
    const xScale = (v) => (xMax === xMin ? (padL + width - padR) / 2 : padL + ((v - xMin) / (xMax - xMin)) * (width - padL - padR));
    const n = withDates.length;
    const yScale = (v) => (height - padB) - (v / n) * (height - padB - padT);
    let coords = withDates.map((m, i) => `${xScale(new Date(m.watchedDate + "T00:00:00").getTime())},${yScale(i + 1)}`);
    coords.unshift(`${xScale(xMin)},${yScale(0)}`);
    const line = coords.join(" ");
    const area = line + ` ${xScale(xMax)},${height - padB} ${xScale(xMin)},${height - padB}`;
    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative titles finished over time">
        <polygon points="${area}" fill="var(--color-accent)" opacity="0.15"></polygon>
        <polyline points="${line}" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>
      </svg>
      <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:0.65rem;color:var(--color-text-soft);margin-top:2px;">
        <span>${escapeHTML(fmtDateShort(withDates[0].watchedDate))}</span>
        <span>${n} total</span>
        <span>${escapeHTML(fmtDateShort(withDates[n - 1].watchedDate))}</span>
      </div>`;
  }

  function buildRatingsChart(finished) {
    const withRatings = finished.filter((m) => m.watchedDate && m.ratings && (typeof m.ratings.Mary === "number" || typeof m.ratings.Angelo === "number"))
      .sort((a, b) => a.watchedDate.localeCompare(b.watchedDate));
    if (!withRatings.length) return `<div class="chart-empty">No ratings logged yet.</div>`;
    const width = 320, height = 150, padL = 14, padR = 10, padT = 10, padB = 20;
    const times = withRatings.map((m) => new Date(m.watchedDate + "T00:00:00").getTime());
    const xMin = times[0], xMax = times[times.length - 1];
    const xScale = (v) => (xMax === xMin ? (padL + width - padR) / 2 : padL + ((v - xMin) / (xMax - xMin)) * (width - padL - padR));
    const yScale = (v) => (height - padB) - ((v - 1) / 4) * (height - padB - padT);

    const maryPts = [], angeloPts = [];
    withRatings.forEach((m) => {
      const t = new Date(m.watchedDate + "T00:00:00").getTime();
      if (typeof m.ratings.Mary === "number") maryPts.push({ x: xScale(t), y: yScale(m.ratings.Mary) });
      if (typeof m.ratings.Angelo === "number") angeloPts.push({ x: xScale(t), y: yScale(m.ratings.Angelo) });
    });

    const gridlines = [1, 2, 3, 4, 5].map((v) =>
      `<line x1="${padL}" x2="${width - padR}" y1="${yScale(v)}" y2="${yScale(v)}" stroke="var(--color-text-soft)" stroke-width="1" opacity="0.15"></line>`
    ).join("");

    function seriesMarkup(points, color) {
      if (!points.length) return "";
      const line = points.map((p) => `${p.x},${p.y}`).join(" ");
      const circles = points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="3.4" fill="${color}"></circle>`).join("");
      return `<polyline points="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"></polyline>${circles}`;
    }

    return `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ratings over time">
        ${gridlines}
        ${seriesMarkup(maryPts, "var(--color-mary)")}
        ${seriesMarkup(angeloPts, "var(--color-angelo)")}
      </svg>
      <div class="chart-legend">
        <span class="chart-legend-item"><span class="chart-legend-dot" style="background:var(--color-mary)"></span>Mary</span>
        <span class="chart-legend-item"><span class="chart-legend-dot" style="background:var(--color-angelo)"></span>Angelo</span>
      </div>`;
  }

  function renderDashboard() {
    const host = document.getElementById("dashboard-content");
    const movies = state.movies;
    if (!movies.length) {
      host.innerHTML = `<div class="empty-state"><div class="empty-title">Nothing to crunch yet</div><div class="empty-body">Once you've logged a few finished titles, stats will show up here.</div></div>`;
      return;
    }
    const finished = movies.filter((m) => m.status === "finished");
    const watching = movies.filter((m) => m.status === "watching");
    const unwatched = movies.filter((m) => m.status === "unwatched");

    const maryRatings = finished.map((m) => m.ratings && m.ratings.Mary).filter((n) => typeof n === "number");
    const angeloRatings = finished.map((m) => m.ratings && m.ratings.Angelo).filter((n) => typeof n === "number");
    const maryAvg = avg(maryRatings);
    const angeloAvg = avg(angeloRatings);
    const combinedAvg = avg(finished.flatMap((m) => [m.ratings && m.ratings.Mary, m.ratings && m.ratings.Angelo]));

    const genreCounts = {};
    finished.forEach((m) => (m.genres || []).forEach((g) => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const genreMax = topGenres.length ? topGenres[0][1] : 1;

    const maryAdded = movies.filter((m) => m.addedBy === "Mary").length;
    const angeloAdded = movies.filter((m) => m.addedBy === "Angelo").length;
    const addedMax = Math.max(1, maryAdded, angeloAdded);

    host.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-value">${finished.length}</div><div class="stat-label">Finished</div></div>
        <div class="stat-card"><div class="stat-value">${watching.length}</div><div class="stat-label">Watching</div></div>
        <div class="stat-card"><div class="stat-value">${unwatched.length}</div><div class="stat-label">On the list</div></div>
        <div class="stat-card"><div class="stat-value">${combinedAvg ? combinedAvg.toFixed(1) : "—"}</div><div class="stat-label">Avg rating</div></div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Average rating by person</div>
        <div class="rating-compare">
          <div class="stat-card" data-who="Mary"><div class="stat-value">${maryAvg ? maryAvg.toFixed(1) : "—"}</div><div class="stat-label">Mary · ${maryRatings.length} rated</div></div>
          <div class="stat-card" data-who="Angelo"><div class="stat-value">${angeloAvg ? angeloAvg.toFixed(1) : "—"}</div><div class="stat-label">Angelo · ${angeloRatings.length} rated</div></div>
        </div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Finished over time</div>
        <div class="chart-card">${buildCumulativeChart(finished)}</div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Ratings over time</div>
        <div class="chart-card">${buildRatingsChart(finished)}</div>
      </div>

      ${topGenres.length ? `<div class="dash-section">
        <div class="dash-section-title">Top genres</div>
        ${topGenres.map(([g, count]) => barRow(g, count, genreMax)).join("")}
      </div>` : ""}

      ${watching.length ? `<div class="dash-section">
        <div class="dash-section-title">Currently watching</div>
        ${watching.map((m) => `<div class="bar-row">
          <div class="bar-row-label" style="width:auto;flex:1;text-transform:none;">${escapeHTML(m.title)}</div>
          <div class="bar-row-value" style="width:auto;">${m.mediaKind === "tv" && m.tv ? "S" + (m.tv.season || 1) + "E" + (m.tv.episode || 1) : ""}</div>
        </div>`).join("")}
      </div>` : ""}

      <div class="dash-section">
        <div class="dash-section-title">Who's been adding titles</div>
        ${barRow("Mary", maryAdded, addedMax)}
        ${barRow("Angelo", angeloAdded, addedMax)}
      </div>
    `;
  }

  function render() { renderWatchlist(); renderDashboard(); }

  /* ---------------------------------------------------------
     MOVIE DETAIL MODAL
     --------------------------------------------------------- */
  function openModal(id) {
    const movie = state.movies.find((m) => m.id === id);
    if (!movie) return;
    const draft = JSON.parse(JSON.stringify(movie));
    draft.ratings = draft.ratings || { Mary: null, Angelo: null };
    draft.rewatchFor = draft.rewatchFor || { Mary: false, Angelo: false };
    draft.tv = draft.tv || { season: null, episode: null };
    const isTv = draft.mediaKind === "tv";

    const root = document.getElementById("modal-root");
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="${escapeHTML(draft.title)}">
          <div class="modal-grabber"></div>
          <div class="modal-header">
            ${posterEl(draft, "modal-poster")}
            <div>
              <div class="modal-title">${escapeHTML(draft.title)}</div>
              <div class="modal-meta">${escapeHTML([draft.year, isTv ? "TV Show" : "Movie", draft.addedBy + " added it · " + fmtDate(draft.addedDate)].filter(Boolean).join(" · "))}</div>
            </div>
          </div>

          <div class="modal-section">
            <div class="modal-section-title">Status</div>
            <div class="status-picker" id="modal-status-picker">
              <button type="button" class="status-option${draft.status === "unwatched" ? " is-active" : ""}" data-status="unwatched">To watch</button>
              <button type="button" class="status-option${draft.status === "watching" ? " is-active" : ""}" data-status="watching">Watching</button>
              <button type="button" class="status-option${draft.status === "finished" ? " is-active" : ""}" data-status="finished">Finished</button>
            </div>
          </div>

          ${isTv ? `
          <div class="modal-section">
            <div class="modal-section-title">Progress</div>
            <div class="field-row-2">
              <label class="field"><span>Season</span><input type="number" min="1" id="modal-tv-season" value="${draft.tv.season || ""}"></label>
              <label class="field"><span>Episode</span><input type="number" min="1" id="modal-tv-episode" value="${draft.tv.episode || ""}"></label>
            </div>
          </div>` : ""}

          <div class="modal-section" id="modal-completion-fields" ${draft.status === "finished" ? "" : 'style="display:none;"'}>
            <div class="modal-section-title">Watched</div>
            <label class="field">
              <span>Date watched</span>
              <input type="date" id="modal-watched-date" value="${draft.watchedDate || ""}">
            </label>
            <div class="rater">
              <div class="rater-label"><span class="rater-dot is-mary"></span> Mary's rating</div>
              <div class="star-row" id="modal-star-Mary"></div>
            </div>
            <div class="rater">
              <div class="rater-label"><span class="rater-dot is-angelo"></span> Angelo's rating</div>
              <div class="star-row" id="modal-star-Angelo"></div>
            </div>
          </div>

          <div class="modal-section">
            <div class="modal-section-title">Already seen before?</div>
            <div class="rewatch-row" style="margin-bottom:0;">
              <label class="checkbox-pill"><input type="checkbox" id="modal-rewatch-mary" ${draft.rewatchFor.Mary ? "checked" : ""}><span>Mary's seen it before</span></label>
              <label class="checkbox-pill"><input type="checkbox" id="modal-rewatch-angelo" ${draft.rewatchFor.Angelo ? "checked" : ""}><span>Angelo's seen it before</span></label>
            </div>
          </div>

          <div class="modal-actions">
            <button class="btn btn-primary btn-block" id="modal-save-btn">Save changes</button>
          </div>
          <div class="modal-actions">
            <button class="btn btn-danger btn-block" id="modal-delete-btn">Remove from list</button>
          </div>
        </div>
      </div>
    `;

    wireStarRow(document.getElementById("modal-star-Mary"), draft.ratings.Mary, (v) => { draft.ratings.Mary = v; });
    wireStarRow(document.getElementById("modal-star-Angelo"), draft.ratings.Angelo, (v) => { draft.ratings.Angelo = v; });

    document.querySelectorAll("#modal-status-picker .status-option").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#modal-status-picker .status-option").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        draft.status = btn.dataset.status;
        const fieldsEl = document.getElementById("modal-completion-fields");
        const show = draft.status === "finished";
        fieldsEl.style.display = show ? "" : "none";
        if (show && !draft.watchedDate) {
          draft.watchedDate = todayISO();
          const dateInput = document.getElementById("modal-watched-date");
          if (dateInput) dateInput.value = draft.watchedDate;
        }
      });
    });

    const watchedDateInput = document.getElementById("modal-watched-date");
    if (watchedDateInput) watchedDateInput.addEventListener("change", (e) => { draft.watchedDate = e.target.value; });

    if (isTv) {
      document.getElementById("modal-tv-season").addEventListener("change", (e) => { draft.tv.season = e.target.value ? Number(e.target.value) : null; });
      document.getElementById("modal-tv-episode").addEventListener("change", (e) => { draft.tv.episode = e.target.value ? Number(e.target.value) : null; });
    }

    document.getElementById("modal-rewatch-mary").addEventListener("change", (e) => { draft.rewatchFor.Mary = e.target.checked; });
    document.getElementById("modal-rewatch-angelo").addEventListener("change", (e) => { draft.rewatchFor.Angelo = e.target.checked; });

    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });

    document.getElementById("modal-save-btn").addEventListener("click", async () => {
      const idx = state.movies.findIndex((m) => m.id === id);
      if (idx > -1) state.movies[idx] = draft;
      closeModal();
      render();
      toast("Saving…");
      const ok = await persistMovies(`Update "${draft.title}"`);
      toast(ok ? "Saved ✓" : "Saved locally — GitHub sync failed");
    });

    document.getElementById("modal-delete-btn").addEventListener("click", async () => {
      if (!confirm(`Remove "${draft.title}" from the list?`)) return;
      state.movies = state.movies.filter((m) => m.id !== id);
      closeModal();
      render();
      toast("Removing…");
      const ok = await persistMovies(`Remove "${draft.title}"`);
      toast(ok ? "Removed ✓" : "Removed locally — GitHub sync failed");
    });
  }
  function closeModal() { document.getElementById("modal-root").innerHTML = ""; }

  /* ---------------------------------------------------------
     ADD FLOW
     --------------------------------------------------------- */
  function updateCompletionFieldsVisibility() {
    const isTv = state.mediaKind === "tv";
    document.getElementById("backfill-checkbox-row").hidden = isTv;
    document.getElementById("tv-progress-fields").hidden = !isTv;
    const show = isTv ? document.getElementById("tv-status-select").value === "finished" : state.backfill;
    const fieldsEl = document.getElementById("backfill-fields");
    fieldsEl.classList.toggle("is-visible", show);
    if (show && !document.getElementById("backfill-watched-date").value) {
      document.getElementById("backfill-watched-date").value = todayISO();
    }
  }

  function addMovieObject(partial) {
    if (!state.addedBy) { toast("Pick who's adding this first"); return; }
    const isTv = state.mediaKind === "tv";
    const m = Object.assign({
      id: uid(),
      mediaType: "tmdb",
      mediaKind: state.mediaKind,
      title: "", year: null, posterUrl: null, genres: [],
      tmdbId: null, youtubeUrl: null,
      addedBy: state.addedBy,
      addedDate: todayISO(),
      status: "unwatched",
      watchedDate: null,
      ratings: { Mary: null, Angelo: null },
      rewatchFor: {
        Mary: document.getElementById("rewatch-mary").checked,
        Angelo: document.getElementById("rewatch-angelo").checked,
      },
      tv: { season: null, episode: null },
      notes: "",
    }, partial);

    if (isTv) {
      const season = document.getElementById("tv-season-input").value;
      const episode = document.getElementById("tv-episode-input").value;
      m.tv = { season: season ? Number(season) : null, episode: episode ? Number(episode) : null };
      m.status = document.getElementById("tv-status-select").value;
      if (m.status === "finished") {
        m.watchedDate = document.getElementById("backfill-watched-date").value || todayISO();
        m.ratings.Mary = state.backfillRatings.Mary || null;
        m.ratings.Angelo = state.backfillRatings.Angelo || null;
        m.addedDate = document.getElementById("backfill-added-date").value || m.addedDate;
      }
    } else if (state.backfill) {
      m.status = "finished";
      m.watchedDate = document.getElementById("backfill-watched-date").value || todayISO();
      m.addedDate = document.getElementById("backfill-added-date").value || m.watchedDate;
      m.ratings.Mary = state.backfillRatings.Mary || null;
      m.ratings.Angelo = state.backfillRatings.Angelo || null;
    }

    state.movies.unshift(m);
    render();
    resetAddForm();
    toast("Saving…");
    persistMovies(`Add "${m.title}"`).then((ok) => {
      toast(ok ? "Added ✓" : "Added locally — GitHub sync failed");
    });
  }

  function resetAddForm() {
    document.getElementById("tmdb-search-input").value = "";
    document.getElementById("tmdb-results").innerHTML = "";
    document.getElementById("youtube-url-input").value = "";
    document.getElementById("youtube-preview").innerHTML = "";
    document.getElementById("other-title-input").value = "";
    document.getElementById("other-poster-input").value = "";
    document.getElementById("rewatch-mary").checked = false;
    document.getElementById("rewatch-angelo").checked = false;
    document.getElementById("tv-season-input").value = "";
    document.getElementById("tv-episode-input").value = "";
    document.getElementById("tv-status-select").value = "unwatched";
    document.getElementById("backfill-checkbox").checked = false;
    state.backfill = false;
    document.getElementById("backfill-watched-date").value = "";
    document.getElementById("backfill-added-date").value = "";
    state.backfillRatings = { Mary: 0, Angelo: 0 };
    backfillStarsMary.set(0);
    backfillStarsAngelo.set(0);
    updateCompletionFieldsVisibility();
  }

  async function doTmdbSearch(q) {
    const box = document.getElementById("tmdb-results");
    if (!settings.tmdbToken) {
      box.innerHTML = `<p class="view-sub">Add a TMDB token in Settings to search.</p>`;
      return;
    }
    box.innerHTML = `<p class="view-sub">Searching…</p>`;
    const endpoint = state.mediaKind === "tv" ? "tv" : "movie";
    try {
      const res = await fetch(`https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(q)}&include_adult=false`, {
        headers: { Authorization: `Bearer ${settings.tmdbToken}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error("TMDB error " + res.status);
      const data = await res.json();
      const existingIds = new Set(state.movies.filter((m) => m.tmdbId).map((m) => m.mediaKind + ":" + m.tmdbId));
      const results = (data.results || []).slice(0, 12);
      box.innerHTML = results.map((r) => {
        const title = r.title || r.name;
        const dateStr = r.release_date || r.first_air_date || "";
        const already = existingIds.has(state.mediaKind + ":" + r.id);
        return `<button type="button" class="tmdb-result" data-tmdb-id="${r.id}">
          <img src="${r.poster_path ? TMDB_IMG_SM + r.poster_path : ""}" alt="">
          <div>
            <div class="tmdb-result-title">${escapeHTML(title)}</div>
            <div class="tmdb-result-year">${escapeHTML(dateStr.slice(0, 4))}</div>
          </div>
          ${already ? '<span class="tmdb-result-added">On list</span>' : ""}
        </button>`;
      }).join("") || `<p class="view-sub">No results for "${escapeHTML(q)}".</p>`;

      box.querySelectorAll(".tmdb-result").forEach((btn) => {
        btn.addEventListener("click", () => {
          const r = results.find((x) => String(x.id) === btn.dataset.tmdbId);
          if (!r) return;
          const gmap = genreMapFor(state.mediaKind);
          addMovieObject({
            mediaType: "tmdb",
            tmdbId: r.id,
            title: r.title || r.name,
            year: (r.release_date || r.first_air_date || "").slice(0, 4) || null,
            posterUrl: r.poster_path ? TMDB_IMG + r.poster_path : null,
            genres: (r.genre_ids || []).map((gid) => gmap[gid]).filter(Boolean),
          });
        });
      });
    } catch (e) {
      box.innerHTML = `<p class="view-sub">Couldn't reach TMDB. Check your token in Settings.</p>`;
    }
  }

  /* ---------------------------------------------------------
     WIRING — runs once on load (script has `defer`, DOM is ready)
     --------------------------------------------------------- */
  applyTheme(getPreferredTheme());
  document.getElementById("theme-toggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  function buildBulbs(count) {
    return Array.from({ length: count }).map((_, i) => `<span class="bulb" style="animation-delay:${(i % 6) * 0.22}s"></span>`).join("");
  }
  document.getElementById("bulb-strip-top").innerHTML = buildBulbs(16);
  document.getElementById("bulb-strip-bottom").innerHTML = buildBulbs(16);

  // nav
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
  document.querySelector(".settings-trigger").addEventListener("click", () => {
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === "view-settings"));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("is-active"));
    window.scrollTo(0, 0);
  });
  function switchView(viewId) {
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("is-active", v.id === viewId));
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === viewId));
    if (viewId === "view-dashboard") renderDashboard();
    window.scrollTo(0, 0);
  }

  // watchlist filters
  document.getElementById("filter-status").addEventListener("change", (e) => { state.filters.status = e.target.value; renderWatchlist(); });
  document.getElementById("filter-addedby").addEventListener("change", (e) => { state.filters.addedBy = e.target.value; renderWatchlist(); });
  document.getElementById("filter-genre").addEventListener("change", (e) => { state.filters.genre = e.target.value; renderWatchlist(); });
  document.getElementById("filter-familiarity").addEventListener("change", (e) => { state.filters.familiarity = e.target.value; renderWatchlist(); });
  document.getElementById("filter-sort").addEventListener("change", (e) => { state.filters.sort = e.target.value; renderWatchlist(); });

  // media kind (movie/tv)
  document.querySelectorAll("[data-mediakind]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-mediakind]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.mediaKind = btn.dataset.mediakind;
      updateCompletionFieldsVisibility();
    });
  });

  // add-mode tabs
  document.querySelectorAll("[data-addmode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-addmode]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.addMode = btn.dataset.addmode;
      document.querySelectorAll(".add-panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === state.addMode));
    });
  });

  // who's adding
  document.querySelectorAll(".addedby-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".addedby-option").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.addedBy = btn.dataset.who;
    });
  });

  // TV status select
  document.getElementById("tv-status-select").addEventListener("change", updateCompletionFieldsVisibility);

  // backfill (log a past watch — movies only, TV uses the status select above)
  document.getElementById("backfill-checkbox").addEventListener("change", (e) => {
    state.backfill = e.target.checked;
    updateCompletionFieldsVisibility();
  });
  const backfillStarsMary = wireStarRow(document.getElementById("backfill-stars-Mary"), 0, (v) => { state.backfillRatings.Mary = v; });
  const backfillStarsAngelo = wireStarRow(document.getElementById("backfill-stars-Angelo"), 0, (v) => { state.backfillRatings.Angelo = v; });

  // tmdb search
  let searchTimer;
  document.getElementById("tmdb-search-input").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (!q) { document.getElementById("tmdb-results").innerHTML = ""; return; }
    searchTimer = setTimeout(() => doTmdbSearch(q), 350);
  });

  // youtube
  document.getElementById("youtube-fetch-btn").addEventListener("click", async () => {
    const url = document.getElementById("youtube-url-input").value.trim();
    const box = document.getElementById("youtube-preview");
    if (!url) return;
    box.innerHTML = `<p class="view-sub">Looking it up…</p>`;
    try {
      const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      box.innerHTML = `
        <div class="tmdb-result">
          <img src="${escapeHTML(data.thumbnail_url)}" alt="">
          <div>
            <div class="tmdb-result-title">${escapeHTML(data.title)}</div>
            <div class="tmdb-result-year">${escapeHTML(data.author_name || "")}</div>
          </div>
        </div>
        <button class="btn btn-primary btn-block" id="youtube-add-btn" style="margin-top:10px;">Add to list</button>
      `;
      document.getElementById("youtube-add-btn").addEventListener("click", () => {
        addMovieObject({ mediaType: "youtube", youtubeUrl: url, title: data.title, posterUrl: data.thumbnail_url, genres: [] });
      });
    } catch (e) {
      box.innerHTML = `<p class="view-sub">Couldn't find that video — double check the link.</p>`;
    }
  });

  // other / untracked media
  document.getElementById("other-add-btn").addEventListener("click", () => {
    const title = document.getElementById("other-title-input").value.trim();
    if (!title) { toast("Give it a title first"); return; }
    const poster = document.getElementById("other-poster-input").value.trim();
    addMovieObject({ mediaType: "other", title, posterUrl: poster || null, genres: [] });
  });

  // settings
  function fillSettingsForm() {
    document.getElementById("setting-tmdb-token").value = settings.tmdbToken || "";
    document.getElementById("setting-gh-token").value = settings.ghToken || "";
    document.getElementById("setting-owner").value = settings.owner || "";
    document.getElementById("setting-repo").value = settings.repo || "";
    document.getElementById("setting-branch").value = settings.branch || "main";
  }
  document.getElementById("settings-form").addEventListener("submit", (e) => {
    e.preventDefault();
    settings = {
      tmdbToken: document.getElementById("setting-tmdb-token").value.trim(),
      ghToken: document.getElementById("setting-gh-token").value.trim(),
      owner: document.getElementById("setting-owner").value.trim(),
      repo: document.getElementById("setting-repo").value.trim(),
      branch: document.getElementById("setting-branch").value.trim() || "main",
    };
    saveSettings(settings);
    const statusEl = document.getElementById("settings-status");
    statusEl.textContent = "Saved ✓";
    setTimeout(() => { statusEl.textContent = ""; }, 2000);
  });

  /* ---------------------------------------------------------
     INIT
     --------------------------------------------------------- */
  updateCompletionFieldsVisibility();
  fillSettingsForm();
  loadMovies();
})();
