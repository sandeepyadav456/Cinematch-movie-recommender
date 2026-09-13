"""
CineMatch — Flask backend for a TF-IDF + cosine-similarity movie recommender.

Loads four artifacts that must live in models/:
    df.pkl            pandas DataFrame — title, overview, genres, tagline,
                       vote_average, popularity, tags
    indices.pkl        pandas Series mapping movie title -> row position
    tfidf.pkl          fitted sklearn TfidfVectorizer
    tfidf_matrix.pkl   sparse TF-IDF matrix, rows aligned to df

See models/README.md for exactly how these are produced. If they are
missing, the app still starts — every data endpoint responds with a clear
503 and the frontend shows a setup banner instead of crashing.
"""

import os
import pickle
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, render_template, request
from sklearn.metrics.pairwise import linear_kernel

BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

df = None
indices = None
tfidf = None
tfidf_matrix = None
title_lookup = {}  # lowercase title -> canonical title, for forgiving lookups
load_error = None


def _load_pickle(name):
    with open(MODELS_DIR / name, "rb") as fh:
        return pickle.load(fh)


def load_models():
    global df, indices, tfidf, tfidf_matrix, title_lookup, load_error
    try:
        loaded_df = pd.read_pickle(MODELS_DIR / "df.pkl")
        loaded_indices = _load_pickle("indices.pkl")
        loaded_tfidf = _load_pickle("tfidf.pkl")
        loaded_matrix = _load_pickle("tfidf_matrix.pkl")

        # Source CSVs are notoriously inconsistent about numeric dtypes —
        # coerce defensively rather than trusting the pickle.
        loaded_df["title"] = loaded_df["title"].astype(str)
        loaded_df["overview"] = loaded_df["overview"].fillna("")
        loaded_df["tagline"] = loaded_df["tagline"].fillna("")
        loaded_df["genres"] = loaded_df["genres"].fillna("")
        loaded_df["vote_average"] = pd.to_numeric(
            loaded_df["vote_average"], errors="coerce"
        ).fillna(0.0)
        loaded_df["popularity"] = pd.to_numeric(
            loaded_df["popularity"], errors="coerce"
        ).fillna(0.0)

        df, indices, tfidf, tfidf_matrix = (
            loaded_df,
            loaded_indices,
            loaded_tfidf,
            loaded_matrix,
        )
        title_lookup = {str(t).lower(): t for t in indices.index}
        load_error = None
        app.logger.info("Loaded %d movies.", len(df))
    except FileNotFoundError as exc:
        load_error = (
            "Model files not found. Add df.pkl, indices.pkl, tfidf.pkl and "
            "tfidf_matrix.pkl to the models/ folder, then restart the app — "
            "see models/README.md."
        )
        app.logger.warning("%s (%s)", load_error, exc)
    except Exception as exc:  # pragma: no cover - defensive, keeps app alive
        load_error = f"Could not load model files: {exc}"
        app.logger.exception(load_error)


load_models()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def models_ready():
    return load_error is None and df is not None


def movie_payload(row, similarity=None):
    payload = {
        "title": row["title"],
        "overview": row["overview"],
        "tagline": row["tagline"],
        "genres": [g for g in str(row["genres"]).split() if g],
        "vote_average": round(float(row["vote_average"]), 1),
        "popularity": round(float(row["popularity"]), 1),
    }
    if similarity is not None:
        payload["similarity"] = round(float(similarity) * 100, 1)
    return payload


def find_title(raw_title):
    """Resolve user input to the canonical title used in `indices`."""
    if raw_title in indices:
        return raw_title
    return title_lookup.get(raw_title.strip().lower())


def resolve_index(canonical_title):
    pos = indices[canonical_title]
    if isinstance(pos, pd.Series):
        # The source data has a handful of duplicate titles (remakes,
        # re-releases). Take the first occurrence rather than failing.
        pos = pos.iloc[0]
    return int(pos)


def recommend(raw_title, count=12):
    canonical = find_title(raw_title)
    if canonical is None:
        return None, None

    idx = resolve_index(canonical)
    scores = linear_kernel(tfidf_matrix[idx], tfidf_matrix).flatten()
    ranked = [i for i in scores.argsort()[::-1] if i != idx][:count]

    selected = movie_payload(df.iloc[idx])
    results = [movie_payload(df.iloc[i], scores[i]) for i in ranked]
    return selected, results


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/health")
def health():
    return jsonify(
        {
            "status": "ok" if models_ready() else "setup_required",
            "message": load_error,
            "movie_count": int(len(df)) if models_ready() else 0,
        }
    )


@app.route("/api/search")
def search():
    if not models_ready():
        return jsonify({"error": load_error}), 503

    query = request.args.get("q", "").strip().lower()
    if len(query) < 2:
        return jsonify({"results": []})

    mask = df["title"].str.lower().str.contains(query, regex=False, na=False)
    matches = df[mask].copy()
    if matches.empty:
        return jsonify({"results": []})

    matches["starts_with"] = matches["title"].str.lower().str.startswith(query)
    matches = matches.sort_values(
        ["starts_with", "popularity"], ascending=[False, False]
    ).head(8)

    return jsonify({"results": [movie_payload(row) for _, row in matches.iterrows()]})


@app.route("/api/trending")
def trending_route():
    if not models_ready():
        return jsonify({"error": load_error}), 503

    limit = min(int(request.args.get("limit", 18)), 48)
    top = df.sort_values("popularity", ascending=False).head(limit)
    return jsonify({"results": [movie_payload(row) for _, row in top.iterrows()]})


@app.route("/api/recommend", methods=["POST"])
def recommend_route():
    if not models_ready():
        return jsonify({"error": load_error}), 503

    body = request.get_json(silent=True) or {}
    raw_title = str(body.get("title", "")).strip()
    count = max(4, min(int(body.get("count", 12)), 24))

    if not raw_title:
        return jsonify({"error": "Provide a movie title."}), 400

    selected, results = recommend(raw_title, count)
    if selected is None:
        return (
            jsonify(
                {
                    "error": "not_found",
                    "message": f'No screening found for "{raw_title}". Try another title.',
                }
            ),
            404,
        )

    return jsonify({"movie": selected, "results": results})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
