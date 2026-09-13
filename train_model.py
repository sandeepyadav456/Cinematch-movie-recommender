"""
train_model.py — regenerate the TF-IDF recommender artifacts from a raw
'movies_metadata.csv' file (e.g. Kaggle's "The Movies Dataset").

This mirrors the cleaning and feature-engineering steps from the project
notebook, tidied into a repeatable script, so you can rebuild the model
whenever you want — after a library upgrade, or with refreshed source data —
without opening a notebook.

Usage:
    python train_model.py --input movies_metadata.csv --output models
"""

import argparse
import ast
import pickle
import re
from pathlib import Path

import nltk
import pandas as pd
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from sklearn.feature_extraction.text import TfidfVectorizer


def ensure_nltk_data():
    for resource, path in [
        ("stopwords", "corpora/stopwords"),
        ("wordnet", "corpora/wordnet"),
    ]:
        try:
            nltk.data.find(path)
        except LookupError:
            nltk.download(resource)


def clean_genres(raw):
    try:
        return " ".join(item["name"] for item in ast.literal_eval(raw))
    except (ValueError, SyntaxError):
        return ""


def build_dataframe(csv_path):
    df = pd.read_csv(csv_path, low_memory=False)
    df = df.drop_duplicates().reset_index(drop=True)
    df = df[["title", "overview", "genres", "tagline", "vote_average", "popularity"]]
    df = df.dropna(subset=["title"]).reset_index(drop=True)

    df["overview"] = df["overview"].fillna("")
    df["tagline"] = df["tagline"].fillna("")
    df["genres"] = df["genres"].apply(clean_genres)
    df["vote_average"] = pd.to_numeric(df["vote_average"], errors="coerce")
    df["vote_average"] = df["vote_average"].fillna(df["vote_average"].mean())
    df["popularity"] = pd.to_numeric(df["popularity"], errors="coerce").fillna(0.0)

    # Joined with spaces (the original notebook concatenated these directly,
    # which could run words together at the boundaries) so tokenization
    # doesn't accidentally fuse the end of one field with the start of the
    # next.
    df["tags"] = df["overview"] + " " + df["genres"] + " " + df["tagline"]
    return df


def make_preprocessor():
    stop_words = set(stopwords.words("english"))
    lemmatizer = WordNetLemmatizer()

    def preprocess(text):
        text = str(text).lower()
        text = re.sub(r"[^\w\s]", "", text)
        words = [w for w in text.split() if w not in stop_words]
        words = [lemmatizer.lemmatize(w) for w in words]
        return " ".join(words)

    return preprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Path to movies_metadata.csv")
    parser.add_argument(
        "--output", default="models", help="Output directory for the .pkl artifacts"
    )
    args = parser.parse_args()

    ensure_nltk_data()

    print(f"Reading {args.input} ...")
    df = build_dataframe(args.input)
    print(f"{len(df)} movies after cleaning.")

    preprocess = make_preprocessor()
    df["tags"] = df["tags"].apply(preprocess)
    df = df.reset_index(drop=True)

    indices = pd.Series(df.index, index=df["title"])

    tfidf = TfidfVectorizer(max_features=50000, ngram_range=(1, 2), stop_words="english")
    tfidf_matrix = tfidf.fit_transform(df["tags"])
    print(f"TF-IDF matrix shape: {tfidf_matrix.shape}")

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    df.to_pickle(out_dir / "df.pkl")
    with open(out_dir / "indices.pkl", "wb") as fh:
        pickle.dump(indices, fh)
    with open(out_dir / "tfidf.pkl", "wb") as fh:
        pickle.dump(tfidf, fh)
    with open(out_dir / "tfidf_matrix.pkl", "wb") as fh:
        pickle.dump(tfidf_matrix, fh)

    print(f"Saved artifacts to {out_dir.resolve()}")


if __name__ == "__main__":
    main()
