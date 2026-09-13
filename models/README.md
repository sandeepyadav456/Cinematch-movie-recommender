# Model artifacts go here

The app expects exactly these four files in this folder:

| File               | What it is                                              |
|--------------------|----------------------------------------------------------|
| `df.pkl`           | pandas DataFrame with columns: `title`, `overview`, `genres`, `tagline`, `vote_average`, `popularity`, `tags` |
| `indices.pkl`      | pandas Series mapping movie title → row position in `df` |
| `tfidf.pkl`        | fitted `sklearn.feature_extraction.text.TfidfVectorizer` |
| `tfidf_matrix.pkl` | sparse TF-IDF matrix, rows aligned to `df`               |

## How to get them

**Option A — you already have them.** If you trained the model in a notebook (e.g. Colab), just copy the four `.pkl` files it produced into this folder, keeping these exact filenames.

**Option B — regenerate them.** From the project root, run:

```bash
python train_model.py --input path/to/movies_metadata.csv --output models
```

This runs the same cleaning → TF-IDF pipeline from the original notebook and writes all four files here. It needs the raw `movies_metadata.csv` (e.g. from Kaggle's *The Movies Dataset*).

## Before you commit them to Git

GitHub blocks any single file over 100 MB. `tfidf_matrix.pkl` is usually the largest — check its size first:

```bash
ls -lh models/
```

If a file is close to or over that limit, either use [Git LFS](https://git-lfs.com/) or host the file elsewhere (e.g. a release asset, Hugging Face Hub, or cloud storage) and download it at startup instead of committing it.

## Running without these files

The app still starts if this folder is empty — every API route returns a friendly "setup required" response instead of crashing, and the homepage shows a banner explaining what's missing. That's expected until you add the files above.
