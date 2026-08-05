// Parses a "🎬 Add a movie" issue form submission, looks the title up on
// TMDB, appends it to data/movies.json, and writes add-result.json for the
// workflow's comment/close step to read.
//
// Requires Node 20+ (uses global fetch). No npm dependencies.

const fs = require("fs");
const path = require("path");

// Keep this in sync with GENRE_MAP in app.js
const GENRE_MAP = {
  28: "Action", 12: "Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 14: "Fantasy", 36: "History",
  27: "Horror", 10402: "Music", 9648: "Mystery", 10749: "Romance",
  878: "Science Fiction", 10770: "TV Movie", 53: "Thriller", 10752: "War", 37: "Western",
};

const DATA_FILE = path.join(__dirname, "..", "data", "movies.json");

function parseField(body, label) {
  // GitHub renders issue forms as "### Label\n\nanswer text\n\n### Next label..."
  const re = new RegExp("### " + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\r?\\n\\r?\\n([\\s\\S]*?)(?=\\r?\\n### |$)");
  const match = body.match(re);
  if (!match) return "";
  const val = match[1].trim();
  return val === "_No response_" ? "" : val;
}

function uid() {
  return "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function writeResult(success, message) {
  fs.writeFileSync(path.join(__dirname, "..", "add-result.json"), JSON.stringify({ success, message }, null, 2));
}

async function main() {
  const body = process.env.ISSUE_BODY || "";
  const tmdbToken = process.env.TMDB_TOKEN || "";

  const title = parseField(body, "Movie title");
  const addedBy = parseField(body, "Who's adding this?");
  const year = parseField(body, "Release year");
  const notes = parseField(body, "Notes");

  if (!title || !addedBy) {
    writeResult(false, "⚠️ Couldn't read the title or who's-adding-it field from this issue, so nothing was added. Please open a new issue using the **🎬 Add a movie** template.");
    return;
  }

  const store = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  store.movies = store.movies || [];

  const movie = {
    id: uid(),
    mediaType: "other",
    title,
    year: year || null,
    posterUrl: null,
    genres: [],
    tmdbId: null,
    youtubeUrl: null,
    addedBy,
    addedDate: new Date().toISOString().slice(0, 10),
    watched: false,
    watchedDate: null,
    ratings: { Mary: null, Angelo: null },
    notes: notes || "",
  };

  let lookupNote = "";

  if (tmdbToken) {
    try {
      const qs = new URLSearchParams({ query: title, include_adult: "false" });
      if (year) qs.set("year", year);
      const res = await fetch(`https://api.themoviedb.org/3/search/movie?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${tmdbToken}`, accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        const top = (data.results || [])[0];
        if (top) {
          const dup = store.movies.find((m) => m.tmdbId === top.id);
          if (dup) {
            writeResult(false, `ℹ️ **${top.title}** is already on the list (added by ${dup.addedBy}) — didn't add a duplicate.`);
            return;
          }
          movie.mediaType = "tmdb";
          movie.tmdbId = top.id;
          movie.title = top.title;
          movie.year = (top.release_date || "").slice(0, 4) || movie.year;
          movie.posterUrl = top.poster_path ? `https://image.tmdb.org/t/p/w342${top.poster_path}` : null;
          movie.genres = (top.genre_ids || []).map((id) => GENRE_MAP[id]).filter(Boolean);
        } else {
          lookupNote = " (no TMDB match found — added with just the title, you can edit it on the site)";
        }
      } else {
        lookupNote = " (TMDB lookup failed — added with just the title)";
      }
    } catch (e) {
      lookupNote = " (TMDB lookup failed — added with just the title)";
    }
  } else {
    lookupNote = " (no TMDB_TOKEN secret set — added with just the title)";
  }

  store.movies.unshift(movie);
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2) + "\n");

  writeResult(true, `✅ Added **${movie.title}**${movie.year ? " (" + movie.year + ")" : ""} to the watchlist, added by ${addedBy}${lookupNote}.`);
}

main().catch((e) => {
  writeResult(false, "⚠️ Something went wrong adding this movie: " + e.message);
  process.exit(0); // don't fail the workflow — we still want the comment step to run
});
