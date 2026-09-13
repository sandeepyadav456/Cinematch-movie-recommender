(() => {
  "use strict";

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  async function fetchJSON(url, options) {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || "Request failed");
      err.status = res.status;
      err.payload = data;
      throw err;
    }
    return data;
  }

  // Deterministic "reel plate" color, derived from the title — every film
  // gets a stable, unique-looking card with no external image dependency.
  function hashHue(title) {
    let hash = 0;
    for (let i = 0; i < title.length; i += 1) {
      hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }

  function paintPoster(el, title) {
    const hue = hashHue(title || "?");
    const hue2 = (hue + 42) % 360;
    el.style.background = `linear-gradient(135deg, hsl(${hue} 58% 40%), hsl(${hue2} 55% 24%))`;
    el.innerHTML = "";
    const initial = document.createElement("span");
    initial.className = "initial";
    initial.textContent = (title || "?").trim().charAt(0).toUpperCase() || "?";
    el.appendChild(initial);
  }

  // ---------------------------------------------------------------------
  // Elements
  // ---------------------------------------------------------------------

  const setupBanner = $("#setup-banner");
  const setupBannerText = $("#setup-banner-text");

  const searchInput = $("#search-input");
  const suggestionsList = $("#search-suggestions");
  const surpriseBtn = $("#surprise-btn");

  const heroSection = $("#hero");
  const shelfSection = $("#trending-shelf");
  const trendingTrack = $("#trending-track");

  const resultsSection = $("#results-section");
  const backLink = $("#back-link");
  const featureCard = $("#feature-card");
  const genreFilterRow = $("#genre-filter");
  const sortSelect = $("#sort-select");
  const resultsGrid = $("#results-grid");

  const themeToggle = $("#theme-toggle");
  const cardTemplate = $("#card-template");

  let trendingMovies = [];
  let currentResults = [];
  let activeGenres = new Set();
  let activeIndex = -1;

  // ---------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeToggle.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
    );
    localStorage.setItem("cinematch-theme", theme);
  }

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  applyTheme(localStorage.getItem("cinematch-theme") || "dark");

  // ---------------------------------------------------------------------
  // Health check / setup banner
  // ---------------------------------------------------------------------

  async function checkHealth() {
    try {
      const data = await fetchJSON("/api/health");
      if (data.status !== "ok") {
        setupBannerText.textContent =
          data.message ||
          "Add your trained model files to models/ and restart the server to bring the catalog online.";
        setupBanner.hidden = false;
      }
      return data.status === "ok";
    } catch (err) {
      setupBannerText.textContent = "Couldn't reach the server. Refresh to try again.";
      setupBanner.hidden = false;
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Trending shelf
  // ---------------------------------------------------------------------

  function renderShelfSkeleton(count = 8) {
    trendingTrack.innerHTML = "";
    for (let i = 0; i < count; i += 1) {
      const card = document.createElement("div");
      card.className = "shelf-card";
      card.innerHTML = `
        <div class="poster skeleton" style="height:130px"></div>
        <div class="shelf-card-body">
          <div class="skeleton" style="height:14px;border-radius:4px;margin-bottom:8px"></div>
          <div class="skeleton" style="height:10px;width:60%;border-radius:4px"></div>
        </div>`;
      trendingTrack.appendChild(card);
    }
  }

  function renderTrendingCard(movie) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "shelf-card";

    const poster = document.createElement("div");
    poster.className = "poster";
    paintPoster(poster, movie.title);

    const body = document.createElement("div");
    body.className = "shelf-card-body";

    const title = document.createElement("p");
    title.className = "shelf-card-title";
    title.textContent = movie.title;

    const meta = document.createElement("p");
    meta.className = "shelf-card-meta";
    meta.textContent = movie.genres.slice(0, 2).join(" · ") || "Uncategorized";

    body.appendChild(title);
    body.appendChild(meta);
    card.appendChild(poster);
    card.appendChild(body);

    card.addEventListener("click", () => showResults(movie.title));
    return card;
  }

  async function loadTrending() {
    renderShelfSkeleton();
    try {
      const data = await fetchJSON("/api/trending?limit=18");
      trendingMovies = data.results || [];
      trendingTrack.innerHTML = "";
      if (trendingMovies.length === 0) {
        trendingTrack.innerHTML =
          '<p class="empty-state">The catalog is empty right now. Add your model files to see trending titles.</p>';
        return;
      }
      trendingMovies.forEach((movie) => trendingTrack.appendChild(renderTrendingCard(movie)));
    } catch (err) {
      trendingTrack.innerHTML =
        '<p class="error-state">Couldn\u2019t load trending titles. Refresh to try again.</p>';
    }
  }

  // ---------------------------------------------------------------------
  // Search + autocomplete
  // ---------------------------------------------------------------------

  function closeSuggestions() {
    suggestionsList.hidden = true;
    suggestionsList.innerHTML = "";
    searchInput.setAttribute("aria-expanded", "false");
    activeIndex = -1;
  }

  function renderSuggestions(results, query) {
    suggestionsList.innerHTML = "";

    if (results.length === 0) {
      const li = document.createElement("li");
      li.className = "no-match";
      li.textContent = `No screening found for \u201c${query}\u201d. Try another title.`;
      suggestionsList.appendChild(li);
      suggestionsList.hidden = false;
      searchInput.setAttribute("aria-expanded", "true");
      return;
    }

    results.forEach((movie, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.id = `suggestion-${i}`;
      li.dataset.title = movie.title;

      const titleSpan = document.createElement("span");
      titleSpan.className = "s-title";
      titleSpan.textContent = movie.title;

      const genreSpan = document.createElement("span");
      genreSpan.className = "s-genres";
      genreSpan.textContent = movie.genres.slice(0, 2).join(" · ");

      li.appendChild(titleSpan);
      li.appendChild(genreSpan);
      li.addEventListener("click", () => {
        searchInput.value = movie.title;
        closeSuggestions();
        showResults(movie.title);
      });
      suggestionsList.appendChild(li);
    });

    suggestionsList.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  const runSearch = debounce(async (query) => {
    if (query.length < 2) {
      closeSuggestions();
      return;
    }
    try {
      const data = await fetchJSON(`/api/search?q=${encodeURIComponent(query)}`);
      renderSuggestions(data.results || [], query);
    } catch (err) {
      closeSuggestions();
    }
  }, 220);

  searchInput.addEventListener("input", (event) => {
    activeIndex = -1;
    runSearch(event.target.value.trim());
  });

  searchInput.addEventListener("keydown", (event) => {
    const items = $$("li[role='option']", suggestionsList);
    if (suggestionsList.hidden || items.length === 0) {
      if (event.key === "Enter") {
        const value = searchInput.value.trim();
        if (value) showResults(value);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = activeIndex >= 0 ? items[activeIndex] : items[0];
      if (target && target.dataset.title) {
        searchInput.value = target.dataset.title;
        closeSuggestions();
        showResults(target.dataset.title);
      }
      return;
    } else if (event.key === "Escape") {
      closeSuggestions();
      return;
    } else {
      return;
    }

    items.forEach((item, i) => item.setAttribute("aria-selected", i === activeIndex ? "true" : "false"));
    if (items[activeIndex]) {
      items[activeIndex].scrollIntoView({ block: "nearest" });
    }
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-shell")) closeSuggestions();
  });

  surpriseBtn.addEventListener("click", () => {
    if (trendingMovies.length === 0) return;
    const pick = trendingMovies[Math.floor(Math.random() * trendingMovies.length)];
    searchInput.value = pick.title;
    showResults(pick.title);
  });

  // ---------------------------------------------------------------------
  // Results view
  // ---------------------------------------------------------------------

  function renderFeatureCard(movie) {
    featureCard.innerHTML = "";

    const poster = document.createElement("div");
    poster.className = "poster";
    paintPoster(poster, movie.title);

    const body = document.createElement("div");

    const title = document.createElement("h2");
    title.className = "feature-title";
    title.textContent = movie.title;

    const tagline = document.createElement("p");
    tagline.className = "feature-tagline";
    tagline.textContent = movie.tagline ? `\u201c${movie.tagline}\u201d` : "";

    const genres = document.createElement("div");
    genres.className = "card-genres";
    movie.genres.forEach((g) => {
      const tag = document.createElement("span");
      tag.className = "genre-tag";
      tag.textContent = g;
      genres.appendChild(tag);
    });

    const overview = document.createElement("p");
    overview.className = "feature-overview";
    overview.textContent = movie.overview || "No synopsis available.";

    const rating = document.createElement("span");
    rating.className = "rating";
    rating.textContent = `${movie.vote_average.toFixed(1)} / 10`;

    body.appendChild(title);
    if (movie.tagline) body.appendChild(tagline);
    body.appendChild(genres);
    body.appendChild(overview);
    body.appendChild(rating);

    featureCard.appendChild(poster);
    featureCard.appendChild(body);
  }

  function buildGenreChips(results) {
    const counts = new Map();
    results.forEach((movie) => {
      movie.genres.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1));
    });
    const topGenres = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([g]) => g);

    genreFilterRow.innerHTML = "";
    topGenres.forEach((genre) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = genre;
      chip.setAttribute("aria-pressed", "false");
      chip.addEventListener("click", () => {
        if (activeGenres.has(genre)) {
          activeGenres.delete(genre);
          chip.setAttribute("aria-pressed", "false");
        } else {
          activeGenres.add(genre);
          chip.setAttribute("aria-pressed", "true");
        }
        renderResultsGrid();
      });
      genreFilterRow.appendChild(chip);
    });
  }

  function sortResults(list) {
    const key = sortSelect.value;
    const sorted = [...list];
    if (key === "rating") {
      sorted.sort((a, b) => b.vote_average - a.vote_average);
    } else if (key === "popularity") {
      sorted.sort((a, b) => b.popularity - a.popularity);
    } else {
      sorted.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    }
    return sorted;
  }

  function buildCard(movie, index) {
    const node = cardTemplate.content.firstElementChild.cloneNode(true);
    node.style.setProperty("--stagger", `${Math.min(index, 10) * 45}ms`);

    paintPoster($("[data-poster]", node), movie.title);
    $("[data-title]", node).textContent = movie.title;
    $("[data-tagline]", node).textContent = movie.tagline || "";
    $("[data-overview]", node).textContent = movie.overview || "No synopsis available.";
    $("[data-rating]", node).textContent = `${movie.vote_average.toFixed(1)} / 10`;

    const genreWrap = $("[data-genres]", node);
    movie.genres.slice(0, 3).forEach((g) => {
      const tag = document.createElement("span");
      tag.className = "genre-tag";
      tag.textContent = g;
      genreWrap.appendChild(tag);
    });

    if (typeof movie.similarity === "number") {
      const ring = $("[data-match]", node);
      ring.hidden = false;
      const circle = $("[data-ring]", node);
      const circumference = 2 * Math.PI * 15.5;
      const offset = circumference * (1 - movie.similarity / 100);
      circle.style.strokeDasharray = `${circumference}`;
      circle.style.strokeDashoffset = `${offset}`;
      $("[data-match-value]", node).textContent = `${Math.round(movie.similarity)}%`;
    }

    const overviewEl = $("[data-overview]", node);
    const readMoreBtn = $("[data-read-more]", node);
    requestAnimationFrame(() => {
      if (overviewEl.scrollHeight > overviewEl.clientHeight + 2) {
        readMoreBtn.hidden = false;
      }
    });
    readMoreBtn.addEventListener("click", () => {
      const expanded = overviewEl.classList.toggle("expanded");
      readMoreBtn.textContent = expanded ? "Show less" : "Read more";
    });

    return node;
  }

  function renderResultsGrid() {
    let list = currentResults;
    if (activeGenres.size > 0) {
      list = list.filter((movie) => movie.genres.some((g) => activeGenres.has(g)));
    }
    list = sortResults(list);

    resultsGrid.innerHTML = "";
    if (list.length === 0) {
      resultsGrid.innerHTML =
        '<p class="empty-state">Nothing matches that filter. Try clearing a genre chip.</p>';
      return;
    }
    list.forEach((movie, i) => resultsGrid.appendChild(buildCard(movie, i)));
  }

  sortSelect.addEventListener("change", renderResultsGrid);

  async function showResults(title) {
    closeSuggestions();
    heroSection.hidden = true;
    shelfSection.hidden = true;
    resultsSection.hidden = false;
    window.scrollTo({ top: 0, behavior: "smooth" });

    resultsGrid.innerHTML = "";
    for (let i = 0; i < 8; i += 1) {
      const skeleton = document.createElement("div");
      skeleton.className = "movie-card";
      skeleton.style.animation = "none";
      skeleton.style.opacity = "1";
      skeleton.innerHTML = '<div class="poster skeleton" style="height:150px"></div>';
      resultsGrid.appendChild(skeleton);
    }

    try {
      const data = await fetchJSON("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, count: 12 }),
      });

      activeGenres = new Set();
      currentResults = data.results || [];
      renderFeatureCard(data.movie);
      buildGenreChips(currentResults);
      renderResultsGrid();
    } catch (err) {
      featureCard.innerHTML = "";
      resultsGrid.innerHTML = `<p class="error-state">${
        err.message || "No screening found for that title."
      }</p>`;
      genreFilterRow.innerHTML = "";
    }
  }

  backLink.addEventListener("click", () => {
    resultsSection.hidden = true;
    heroSection.hidden = false;
    shelfSection.hidden = false;
    searchInput.value = "";
    searchInput.focus();
  });

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------

  (async function init() {
    const healthy = await checkHealth();
    if (healthy) {
      loadTrending();
    } else {
      trendingTrack.innerHTML = "";
    }
  })();
})();
