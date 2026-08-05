# Double Feature 🎟️

A small shared watchlist for two people. Static site, hosted free on GitHub
Pages, no backend — data lives in `data/movies.json` in this repo.

- **Watchlist** — ticket-style cards, filter by watched/unwatched, who added it, sort by rating
- **Dashboard** — how many watched, when, average rating per person, top genres
- **Add** — search TMDB for posters/genres, or add a YouTube link, or add anything else untracked; can log something you watched weeks ago with a backdated rating
- **Quick add from your phone** — open a GitHub Issue from the mobile app and a GitHub Action adds it to the list automatically

---

## 1. Get the repo up

1. Create a new **public** GitHub repo (Pages on the free tier needs public, unless you have GitHub Pro/Team/Enterprise) and push all these files to the `main` branch.
2. Go to **Settings → Pages** → under "Build and deployment", set Source to **Deploy from a branch**, branch `main`, folder `/ (root)`. Save.
3. Your site will be live in a minute or two at `https://<owner>.github.io/<repo>/`.

## 2. Get a TMDB API token (free)

1. Go to [themoviedb.org](https://www.themoviedb.org) → create an account.
2. **Settings → API** → request a key (choose "Developer", fill in anything reasonable for the app details).
3. Copy the **"API Read Access Token"** (long string starting with `eyJ...`) — that's what the site uses.

You'll paste this into the site's **Settings** tab once it's live (stored only in your browser).

## 3. Turn on the quick-add Action (optional but recommended)

This lets you open the GitHub app on your phone → Issues → new issue → fill in a title → the movie gets added automatically, no need to open the site.

1. **Settings → Secrets and variables → Actions → New repository secret.**
   Name: `TMDB_TOKEN`, value: the same TMDB Read Access Token from step 2.
   (Without this secret, quick-add issues still work — they just add the title without a poster/genres, and you can fill those in later from the site.)
2. That's it — `.github/workflows/add-movie.yml` and the issue form in `.github/ISSUE_TEMPLATE/add-movie.yml` are already wired up.
3. To add a movie: **GitHub app → your repo → Issues → +  → "🎬 Add a movie"** → fill in the title and who's adding it → Submit. The Action searches TMDB, commits the movie to `data/movies.json`, comments on the issue confirming, and closes it. Give it 10–20 seconds.

## 4. Let the site write back to GitHub (for ratings, watched status, adding from the site itself)

Rating movies, marking them watched, and adding from the **Add** tab all save straight to GitHub from your browser, which needs a token with write access.

1. **github.com → your avatar → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.**
2. Give it a name like "Double Feature site", set expiration however you like, and under **Repository access** choose "Only select repositories" → this repo.
3. Under **Permissions → Repository permissions**, set **Contents: Read and write**. Nothing else is needed.
4. Copy the token (starts with `github_pat_...`) — GitHub only shows it once.
5. On the site, go to the ⚙️ **Settings** tab and fill in: this token, your GitHub username (repo owner), the repo name, and branch (`main`). Save.

Each person can save their own token in their own browser — there's nothing to share except the repo itself.

**Heads up:** this token lives in `localStorage` in your browser, not anywhere more secure than that. That's a fine tradeoff for a two-person personal project on a token scoped to just this repo, but don't reuse a broad/all-repo token here.

## 5. Restyling

Everything visual lives in `style.css`. The **TOKENS** section at the very top of the file has all the colors and fonts as CSS variables — change a value there and it updates everywhere. Sections below are organized by component (header, nav, cards, modal, dashboard, etc.) and commented.

## How the data is structured

`data/movies.json`:

```json
{
  "movies": [
    {
      "id": "m_abc123",
      "mediaType": "tmdb",        // "tmdb" | "youtube" | "other"
      "title": "Chinatown",
      "year": "1974",
      "posterUrl": "https://image.tmdb.org/t/p/w342/...jpg",
      "genres": ["Drama", "Mystery"],
      "tmdbId": 695,
      "youtubeUrl": null,
      "addedBy": "Angelo",        // "Mary" | "Angelo"
      "addedDate": "2026-07-01",
      "watched": true,
      "watchedDate": "2026-07-10",
      "ratings": { "Mary": 5, "Angelo": 4 },
      "notes": ""
    }
  ]
}
```

## Known limitations

- No login/auth — anyone with the repo URL can view the site, and anyone with a write-scoped token can edit. Fine for a private two-person project; don't put anything sensitive in it.
- No conflict resolution if you both edit at the exact same moment — last write wins. In practice, for a couple adding/rating movies, this basically never comes up.
- Quick-add issues always create an `"other"`-type entry if no TMDB match is found or `TMDB_TOKEN` isn't set — you can search-and-fix it from the site's card later, or just leave it (untracked entries display and filter fine either way).
