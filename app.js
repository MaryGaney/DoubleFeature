/* ============================================================
   DOUBLE FEATURE — app.js
   ------------------------------------------------------------
   No build step, no framework — just fetch/render against
   data/movies.json, with writes going straight to GitHub via
   the Contents API using a token you save in Settings.
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
  const SETTINGS_KEY = "df_settings_v1";

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
    filters: { status: "all", addedBy: "all", sort: "recent" },
    addMode: "tmdb",
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

  /* A tiny reusable 5-star picker. Renders into `el`, calls
     onChange(value) whenever it changes. Tapping the currently
     selected star clears the rating. */
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
    return `<div class="${cls} is-placeholder">🎬</div>`;
  }

  function cardHTML(m) {
    const addedTag = `<span class="tag tag-${m.addedBy.toLowerCase()}">${escapeHTML(m.addedBy)}</span>`;
    let ratingTags = "";
    if (m.watched) {
      const mr = m.ratings && m.ratings.Mary, ar = m.ratings && m.ratings.Angelo;
      if (typeof mr === "number") ratingTags += `<span class="rating-pill is-mary"><span class="star">★</span>${mr}</span>`;
      if (typeof ar === "number") ratingTags += `<span class="rating-pill is-angelo"><span class="star">★</span>${ar}</span>`;
      if (!ratingTags) ratingTags = `<span class="tag tag-watched">Not rated yet</span>`;
    } else {
      ratingTags = `<span class="tag tag-watched">To watch</span>`;
    }
    const metaParts = [m.year || null];
    if (m.watched && m.watchedDate) metaParts.push("watched " + fmtDate(m.watchedDate));
    const meta = metaParts.filter(Boolean).join(" · ");

    return `<button class="ticket-card" data-id="${m.id}">
      ${posterEl(m, "ticket-poster")}
      <div class="ticket-divider"></div>
      <div class="ticket-info">
        <div class="ticket-title">${escapeHTML(m.title)}</div>
        <div class="ticket-meta">${escapeHTML(meta)}</div>
        <div class="ticket-tags">${addedTag}${ratingTags}</div>
      </div>
    </button>`;
  }

  function getFiltered() {
    let list = state.movies.slice();
    if (state.filters.status === "watched") list = list.filter((m) => m.watched);
    if (state.filters.status === "unwatched") list = list.filter((m) => !m.watched);
    if (state.filters.addedBy !== "all") list = list.filter((m) => m.addedBy === state.filters.addedBy);

    switch (state.filters.sort) {
      case "rating-desc":
        list.sort((a, b) => (movieAvg(b) ?? -1) - (movieAvg(a) ?? -1));
        break;
      case "rating-asc":
        list.sort((a, b) => (movieAvg(a) ?? 999) - (movieAvg(b) ?? 999));
        break;
      case "title":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "watched-date":
        list.sort((a, b) => (b.watchedDate || "").localeCompare(a.watchedDate || ""));
        break;
      default: // recent
        list.sort((a, b) => (b.addedDate || "").localeCompare(a.addedDate || ""));
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
  function monthLabel(key) {
    const [y, m] = key.split("-");
    return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  }

  function renderDashboard() {
    const host = document.getElementById("dashboard-content");
    const movies = state.movies;
    if (!movies.length) {
      host.innerHTML = `<div class="empty-state"><div class="empty-title">Nothing to crunch yet</div><div class="empty-body">Once you've logged a few watched movies, stats will show up here.</div></div>`;
      return;
    }
    const watched = movies.filter((m) => m.watched);
    const unwatched = movies.length - watched.length;
    const maryRatings = watched.map((m) => m.ratings && m.ratings.Mary).filter((n) => typeof n === "number");
    const angeloRatings = watched.map((m) => m.ratings && m.ratings.Angelo).filter((n) => typeof n === "number");
    const maryAvg = avg(maryRatings);
    const angeloAvg = avg(angeloRatings);
    const combinedAvg = avg(watched.flatMap((m) => [m.ratings && m.ratings.Mary, m.ratings && m.ratings.Angelo]));

    const genreCounts = {};
    watched.forEach((m) => (m.genres || []).forEach((g) => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
    const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);

    const monthCounts = {};
    watched.forEach((m) => { if (m.watchedDate) { const k = m.watchedDate.slice(0, 7); monthCounts[k] = (monthCounts[k] || 0) + 1; } });
    const months = Object.entries(monthCounts).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
    const monthMax = Math.max(1, ...months.map((m) => m[1]));
    const genreMax = topGenres.length ? topGenres[0][1] : 1;

    const maryAdded = movies.filter((m) => m.addedBy === "Mary").length;
    const angeloAdded = movies.filter((m) => m.addedBy === "Angelo").length;
    const addedMax = Math.max(1, maryAdded, angeloAdded);

    host.innerHTML = `
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-value">${watched.length}</div><div class="stat-label">Watched</div></div>
        <div class="stat-card"><div class="stat-value">${unwatched}</div><div class="stat-label">On the list</div></div>
        <div class="stat-card"><div class="stat-value">${combinedAvg ? combinedAvg.toFixed(1) : "—"}</div><div class="stat-label">Avg rating</div></div>
        <div class="stat-card"><div class="stat-value">${movies.length}</div><div class="stat-label">Total added</div></div>
      </div>

      <div class="dash-section">
        <div class="dash-section-title">Average rating by person</div>
        <div class="rating-compare">
          <div class="stat-card" data-who="Mary"><div class="stat-value">${maryAvg ? maryAvg.toFixed(1) : "—"}</div><div class="stat-label">Mary · ${maryRatings.length} rated</div></div>
          <div class="stat-card" data-who="Angelo"><div class="stat-value">${angeloAvg ? angeloAvg.toFixed(1) : "—"}</div><div class="stat-label">Angelo · ${angeloRatings.length} rated</div></div>
        </div>
      </div>

      ${months.length ? `<div class="dash-section">
        <div class="dash-section-title">Watched by month</div>
        ${months.map(([key, count]) => barRow(monthLabel(key), count, monthMax)).join("")}
      </div>` : ""}

      ${topGenres.length ? `<div class="dash-section">
        <div class="dash-section-title">Top genres</div>
        ${topGenres.map(([g, count]) => barRow(g, count, genreMax)).join("")}
      </div>` : ""}

      <div class="dash-section">
        <div class="dash-section-title">Who's been adding movies</div>
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

    const root = document.getElementById("modal-root");
    root.innerHTML = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal-sheet" role="dialog" aria-modal="true" aria-label="${escapeHTML(draft.title)}">
          <div class="modal-grabber"></div>
          <div class="modal-header">
            ${posterEl(draft, "modal-poster")}
            <div>
              <div class="modal-title">${escapeHTML(draft.title)}</div>
              <div class="modal-meta">${escapeHTML([draft.year, draft.addedBy + " added it · " + fmtDate(draft.addedDate)].filter(Boolean).join(" · "))}</div>
            </div>
          </div>

          <div class="modal-section">
            <div class="watched-toggle-row">
              <div>
                <div style="font-weight:600;">Watched</div>
                <div style="font-size:0.78rem;color:var(--color-ink-soft);">Flip this on once you've seen it</div>
              </div>
              <label class="switch">
                <input type="checkbox" id="modal-watched-toggle" ${draft.watched ? "checked" : ""}>
                <span class="switch-track"></span>
                <span class="switch-thumb"></span>
              </label>
            </div>
          </div>

          <div class="modal-section" id="modal-watched-fields" ${draft.watched ? "" : "style=\"display:none;\""}>
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

    document.getElementById("modal-watched-toggle").addEventListener("change", (e) => {
      draft.watched = e.target.checked;
      document.getElementById("modal-watched-fields").style.display = draft.watched ? "" : "none";
      if (draft.watched && !draft.watchedDate) {
        draft.watchedDate = todayISO();
        document.getElementById("modal-watched-date").value = draft.watchedDate;
      }
    });
    document.getElementById("modal-watched-date").addEventListener("change", (e) => { draft.watchedDate = e.target.value; });

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
  function addMovieObject(partial) {
    if (!state.addedBy) { toast("Pick who's adding this first"); return; }
    const m = Object.assign({
      id: uid(),
      mediaType: "tmdb",
      title: "", year: null, posterUrl: null, genres: [],
      tmdbId: null, youtubeUrl: null,
      addedBy: state.addedBy,
      addedDate: todayISO(),
      watched: false,
      watchedDate: null,
      ratings: { Mary: null, Angelo: null },
      notes: "",
    }, partial);

    if (state.backfill) {
      m.watched = true;
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
    document.getElementById("backfill-checkbox").checked = false;
    state.backfill = false;
    document.getElementById("backfill-fields").classList.remove("is-visible");
    state.backfillRatings = { Mary: 0, Angelo: 0 };
    backfillStarsMary.set(0);
    backfillStarsAngelo.set(0);
  }

  async function doTmdbSearch(q) {
    const box = document.getElementById("tmdb-results");
    if (!settings.tmdbToken) {
      box.innerHTML = `<p class="view-sub">Add a TMDB token in Settings to search.</p>`;
      return;
    }
    box.innerHTML = `<p class="view-sub">Searching…</p>`;
    try {
      const res = await fetch(`https://api.themoviedb.org/3/search/movie?query=${encodeURIComponent(q)}&include_adult=false`, {
        headers: { Authorization: `Bearer ${settings.tmdbToken}`, accept: "application/json" },
      });
      if (!res.ok) throw new Error("TMDB error " + res.status);
      const data = await res.json();
      const existingIds = new Set(state.movies.filter((m) => m.tmdbId).map((m) => m.tmdbId));
      const results = (data.results || []).slice(0, 12);
      box.innerHTML = results.map((r) => {
        const already = existingIds.has(r.id);
        return `<button type="button" class="tmdb-result" data-tmdb-id="${r.id}">
          <img src="${r.poster_path ? TMDB_IMG_SM + r.poster_path : ""}" alt="">
          <div>
            <div class="tmdb-result-title">${escapeHTML(r.title)}</div>
            <div class="tmdb-result-year">${escapeHTML((r.release_date || "").slice(0, 4))}</div>
          </div>
          ${already ? '<span class="tmdb-result-added">On list</span>' : ""}
        </button>`;
      }).join("") || `<p class="view-sub">No results for "${escapeHTML(q)}".</p>`;

      box.querySelectorAll(".tmdb-result").forEach((btn) => {
        btn.addEventListener("click", () => {
          const r = results.find((x) => String(x.id) === btn.dataset.tmdbId);
          if (r) {
            addMovieObject({
              mediaType: "tmdb",
              tmdbId: r.id,
              title: r.title,
              year: (r.release_date || "").slice(0, 4) || null,
              posterUrl: r.poster_path ? TMDB_IMG + r.poster_path : null,
              genres: (r.genre_ids || []).map((id) => GENRE_MAP[id]).filter(Boolean),
            });
          }
        });
      });
    } catch (e) {
      box.innerHTML = `<p class="view-sub">Couldn't reach TMDB. Check your token in Settings.</p>`;
    }
  }

  /* ---------------------------------------------------------
     WIRING — runs once on load (script has `defer`, DOM is ready)
     --------------------------------------------------------- */

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
  document.querySelectorAll('[data-filter="status"]').forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll('[data-filter="status"]').forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.filters.status = btn.dataset.value;
      renderWatchlist();
    });
  });
  document.getElementById("filter-addedby").addEventListener("change", (e) => { state.filters.addedBy = e.target.value; renderWatchlist(); });
  document.getElementById("filter-sort").addEventListener("change", (e) => { state.filters.sort = e.target.value; renderWatchlist(); });

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

  // backfill (log a past watch)
  document.getElementById("backfill-checkbox").addEventListener("change", (e) => {
    state.backfill = e.target.checked;
    document.getElementById("backfill-fields").classList.toggle("is-visible", state.backfill);
    if (state.backfill && !document.getElementById("backfill-watched-date").value) {
      document.getElementById("backfill-watched-date").value = todayISO();
    }
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
  fillSettingsForm();
  loadMovies();
})();
