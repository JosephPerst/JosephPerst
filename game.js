(function () {
  const MAX_GUESSES = 6;
  const EARTH_KM = 6371;
  const MAX_DIST_KM = 20000; // antipodes-ish, used for proximity %
  const ARROWS = ["⬆️", "↗️", "➡️", "↘️", "⬇️", "↙️", "⬅️", "↖️"];

  const COUNTRIES = window.COUNTRIES;

  // --- seeded RNG (mulberry32) ---
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pickCountry(seedStr) {
    const rng = mulberry32(hashSeed(seedStr));
    const idx = Math.floor(rng() * COUNTRIES.length);
    return COUNTRIES[idx];
  }

  // --- geo math ---
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;

  function haversineKm(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
  }

  function bearingDeg(from, to) {
    const lat1 = toRad(from.lat);
    const lat2 = toRad(to.lat);
    const dLng = toRad(to.lng - from.lng);
    const y = Math.sin(dLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  function arrowFor(bearing) {
    // 8 directions, N = 0°
    const idx = Math.round(bearing / 45) % 8;
    return ARROWS[idx];
  }

  // --- name normalization ---
  function norm(s) {
    return s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9 ]/g, "")
      .trim();
  }

  const NAME_INDEX = COUNTRIES.map((c) => {
    const keys = [norm(c.name), ...(c.aliases || []).map(norm)];
    return { country: c, keys };
  });

  function findCountry(input) {
    const q = norm(input);
    if (!q) return null;
    const exact = NAME_INDEX.find((e) => e.keys.includes(q));
    if (exact) return exact.country;
    // Fuzzy: unique prefix match
    const pref = NAME_INDEX.filter((e) => e.keys.some((k) => k.startsWith(q)));
    if (pref.length === 1) return pref[0].country;
    return null;
  }

  function suggest(input, limit = 6) {
    const q = norm(input);
    if (!q) return [];
    const starts = [];
    const contains = [];
    for (const e of NAME_INDEX) {
      if (e.keys.some((k) => k.startsWith(q))) starts.push(e.country);
      else if (e.keys.some((k) => k.includes(q))) contains.push(e.country);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  // --- seed / URL handling ---
  function todayStr() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function getSeed() {
    const params = new URLSearchParams(location.search);
    return params.get("seed") || todayStr();
  }

  // --- game state ---
  const seed = getSeed();
  const answer = pickCountry(seed);
  const guesses = []; // array of { country, distKm, bearing, proxPct, correct }

  // --- DOM refs ---
  const $ = (id) => document.getElementById(id);
  const seedLabel = $("seed-label");
  const countryImg = $("country-img");
  const guessesEl = $("guesses");
  const inputEl = $("guess-input");
  const guessBtn = $("guess-btn");
  const suggestionsEl = $("suggestions");
  const resultEl = $("result");
  const shareBtn = $("share-btn");
  const customSeedBtn = $("custom-seed-btn");

  seedLabel.textContent = seed;
  countryImg.src = `https://raw.githubusercontent.com/djaiss/mapsicon/master/all/${answer.code}/vector.svg`;
  countryImg.onerror = () => {
    // fallback to 1024 png if svg missing
    countryImg.src = `https://raw.githubusercontent.com/djaiss/mapsicon/master/all/${answer.code}/1024.png`;
  };

  // --- rendering ---
  function renderGuesses() {
    guessesEl.innerHTML = "";
    for (const g of guesses) {
      const row = document.createElement("div");
      row.className = "guess-row" + (g.correct ? " correct" : "");
      row.innerHTML = `
        <div class="guess-name">${g.country.name}</div>
        <div class="guess-dist">${g.correct ? "—" : Math.round(g.distKm).toLocaleString() + " km"}</div>
        <div class="guess-dir">${g.correct ? "🎉" : arrowFor(g.bearing)}</div>
        <div class="guess-prox">${g.proxPct}%</div>
      `;
      guessesEl.appendChild(row);
    }
  }

  function endGame(won) {
    inputEl.disabled = true;
    guessBtn.disabled = true;
    suggestionsEl.classList.add("hidden");
    resultEl.hidden = false;
    resultEl.classList.toggle("win", won);
    resultEl.classList.toggle("lose", !won);
    const tries = guesses.length;
    resultEl.innerHTML = won
      ? `<h2>You got it! 🎉</h2>
         <p>The country was <span class="answer">${answer.name}</span>.</p>
         <p>${tries} / ${MAX_GUESSES} guesses.</p>
         <p><a href="?seed=${encodeURIComponent(seed)}">Reload</a> · Share this seed with your girlfriend to compare scores.</p>`
      : `<h2>Out of guesses 😢</h2>
         <p>The answer was <span class="answer">${answer.name}</span>.</p>
         <p>Try another seed, or come back tomorrow.</p>`;
  }

  function submitGuess(country) {
    if (!country) return;
    // prevent duplicates
    if (guesses.some((g) => g.country.code === country.code)) {
      inputEl.value = "";
      updateSuggestions();
      return;
    }
    const correct = country.code === answer.code;
    const distKm = correct ? 0 : haversineKm(country, answer);
    const bearing = correct ? 0 : bearingDeg(country, answer);
    const proxPct = Math.max(0, Math.round((1 - distKm / MAX_DIST_KM) * 100));
    guesses.push({ country, distKm, bearing, proxPct, correct });
    inputEl.value = "";
    updateSuggestions();
    renderGuesses();

    if (correct) return endGame(true);
    if (guesses.length >= MAX_GUESSES) return endGame(false);
  }

  // --- suggestions / input ---
  let activeSuggest = -1;
  let currentSuggestions = [];

  function updateSuggestions() {
    const list = suggest(inputEl.value);
    currentSuggestions = list;
    activeSuggest = -1;
    if (list.length === 0) {
      suggestionsEl.classList.add("hidden");
      suggestionsEl.innerHTML = "";
      return;
    }
    suggestionsEl.classList.remove("hidden");
    suggestionsEl.innerHTML = list
      .map((c, i) => `<li data-i="${i}">${c.name}</li>`)
      .join("");
  }

  suggestionsEl.addEventListener("mousedown", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    const i = Number(li.dataset.i);
    submitGuess(currentSuggestions[i]);
  });

  inputEl.addEventListener("input", updateSuggestions);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (currentSuggestions.length) {
        activeSuggest = (activeSuggest + 1) % currentSuggestions.length;
        highlightSuggestion();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (currentSuggestions.length) {
        activeSuggest =
          (activeSuggest - 1 + currentSuggestions.length) %
          currentSuggestions.length;
        highlightSuggestion();
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick =
        activeSuggest >= 0
          ? currentSuggestions[activeSuggest]
          : findCountry(inputEl.value);
      if (pick) submitGuess(pick);
    } else if (e.key === "Escape") {
      suggestionsEl.classList.add("hidden");
    }
  });

  function highlightSuggestion() {
    const items = suggestionsEl.querySelectorAll("li");
    items.forEach((el, i) =>
      el.classList.toggle("active", i === activeSuggest)
    );
  }

  guessBtn.addEventListener("click", () => {
    const pick = findCountry(inputEl.value);
    if (pick) submitGuess(pick);
  });

  // --- seed controls ---
  shareBtn.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?seed=${encodeURIComponent(seed)}`;
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = "Copied!";
      setTimeout(() => (shareBtn.textContent = "Share link"), 1500);
    } catch {
      prompt("Copy this link:", url);
    }
  });

  customSeedBtn.addEventListener("click", () => {
    const s = prompt(
      "Enter a shared seed (any text). Use the same one on both devices:",
      seed
    );
    if (!s) return;
    location.search = `?seed=${encodeURIComponent(s)}`;
  });

  renderGuesses();
})();
