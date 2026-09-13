# CineMatch

A content-based movie recommender: type in a title you like, and it finds
films with the closest-matching plot, genres, and tagline — no other users'
ratings required. Built on top of a TF-IDF + cosine-similarity pipeline,
served through a small Flask API, with a custom frontend on top.

> Add a screenshot or short GIF of the running app here once it's deployed.

## Features

- **Live search with autocomplete** — debounced, keyboard-navigable, ranked by relevance and popularity
- **"Now trending" shelf** on the homepage, sorted by catalog popularity
- **Similar-screenings grid** with a per-card match percentage (cosine similarity, visualized as a ring)
- **Genre filter chips** and a sort control (best match / rating / popularity) on the results view
- **"Surprise me"** — jumps straight to recommendations for a random trending title
- **Deterministic "reel plate" posters** — a unique colored plate generated from each title, so the UI looks complete with zero image dependencies or API keys
- **Dark/light theme toggle**, persisted locally
- Accessible: keyboard navigation, visible focus states, `prefers-reduced-motion` respected
- Graceful "setup required" state if the model files haven't been added yet, instead of crashing

## Tech stack

- **Backend:** Flask, pandas, scikit-learn (TF-IDF vectorizer + linear kernel similarity)
- **Frontend:** vanilla HTML/CSS/JS — no build step, no framework
- **Serving:** Gunicorn (production), Flask dev server (local)

## Project structure

```
movie-recommender/
├── app.py                 # Flask app + JSON API
├── train_model.py         # Regenerates the .pkl artifacts from a raw CSV
├── requirements.txt
├── Procfile                # `gunicorn app:app` for platforms that read it
├── .python-version
├── models/
│   ├── README.md           # what goes here and how to get it
│   ├── df.pkl               ┐
│   ├── indices.pkl          │  not included — see "Add your model files"
│   ├── tfidf.pkl             │
│   └── tfidf_matrix.pkl     ┘
├── static/
│   ├── css/style.css
│   ├── js/main.js
│   └── images/favicon.svg
└── templates/
    └── index.html
```

## Add your model files

This repo ships the app, not the trained artifacts — they're generated from
your dataset. Drop these four files into `models/` (see `models/README.md`
for exact details, and for how to regenerate them with `train_model.py` if
you only have the raw CSV):

- `df.pkl`
- `indices.pkl`
- `tfidf.pkl`
- `tfidf_matrix.pkl`

Until they're present, the app still runs — it just shows a "setup required"
banner and every endpoint returns a clear message instead of an error page.

## Run it locally

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# add your model files to models/, then:
python app.py
```

Visit `http://localhost:5000`.

## Deploying

Any host that runs a standard Python web app works. Two straightforward, free-tier-friendly options:

### Render

1. Push this repo to GitHub.
2. On [render.com](https://render.com), create a **New Web Service** from the repo.
3. Build command: `pip install -r requirements.txt`
4. Start command: `gunicorn app:app`
5. Make sure `models/*.pkl` are committed (or fetched via a build hook — see the note on file size below).

### Railway

1. Push this repo to GitHub, then **New Project → Deploy from GitHub repo** on [railway.app](https://railway.app).
2. Railway detects the `Procfile` automatically; no extra config needed.

### A note on the model files' size

GitHub rejects any single file over 100 MB. Before pushing, check:

```bash
ls -lh models/
```

If `tfidf_matrix.pkl` (usually the largest) is near that limit, use
[Git LFS](https://git-lfs.com/) or host it externally and download it at
startup instead of committing it directly.

### A note on library versions

The `.pkl` files are tied to the scikit-learn/pandas versions that created
them. If you see an unpickling error after deploying, either pin
`requirements.txt` to match the versions used when you trained the model, or
regenerate the artifacts with `train_model.py` using the versions in this
repo.

## How the recommender works

1. Each movie's `overview`, `genres`, and `tagline` are concatenated into one text field (`tags`).
2. That field is cleaned (lowercased, punctuation stripped, stopwords removed, lemmatized) and vectorized with `TfidfVectorizer(max_features=50000, ngram_range=(1, 2))`.
3. For a chosen title, cosine similarity (`sklearn.metrics.pairwise.linear_kernel` against an L2-normalized TF-IDF matrix) is computed against every other row.
4. The highest-scoring rows, excluding the movie itself, are returned as recommendations, along with their similarity score.

This is pure content-based filtering — it works from day one with no user
interaction history, but it also can't learn from what people actually click.
See "Possible extensions" below for where this could go next.

## Possible extensions

- **Real poster art:** call an API such as TMDB's `/search/movie` by title in a small backend route, cache the result, and fall back to the generated poster plate on a miss.
- **Hybrid filtering:** blend the current content-based score with a collaborative-filtering signal (e.g. matrix factorization on user ratings) if you add a ratings dataset.
- **Release year / cast / director:** if your source CSV has them, add them back into `df` and surface them in the UI and in the `tags` text field.
- **Search-as-you-type on plot/mood**, not just titles — the TF-IDF vectorizer can already score free text; you'd just need a route that vectorizes the query with `tfidf.transform()` instead of looking up an existing row.

## Credits

- Data: *The Movies Dataset* (Kaggle) — metadata for roughly 45,000 films.
- Everything else in this repo — the API, the pipeline script, and the frontend — was built for this project.

## License

MIT — see `LICENSE`.
