// Second line of the clickjacking defence; framebust.js in <head> is the
// first and does the actual blocking before anything paints.
if (window.top !== window.self) {
  throw new Error("framed: refusing to initialise admin panel");
}

const WORKER_URL = "https://jobmatch-worker.kennethj.workers.dev";
// Holds {token, expiresAt} from POST /login — never the password itself.
const STORAGE_KEY = "jobmatch_admin_session";

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const passwordInput = document.getElementById("password-input");
const unlockBtn = document.getElementById("unlock-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const tabBtns = document.querySelectorAll(".tab-btn");
const panels = {
  review: document.getElementById("review-panel"),
  wordcloud: document.getElementById("wordcloud-panel"),
  missing: document.getElementById("missing-panel"),
  docs: document.getElementById("docs-panel"),
};

const reviewStatus = document.getElementById("review-status");
const jobList = document.getElementById("job-list");
const reviewEmpty = document.getElementById("review-empty");

const cloudStatus = document.getElementById("cloud-status");
const cloudCard = document.getElementById("cloud-card");
const cloudSvg = document.getElementById("cloud-svg");
const tagToast = document.getElementById("tag-toast");

const missingStatus = document.getElementById("missing-status");
const missingSummary = document.getElementById("missing-summary");
const missingTableWrap = document.getElementById("missing-table-wrap");
const missingTbody = document.getElementById("missing-tbody");
const missingEmpty = document.getElementById("missing-empty");

const SENIORITY_OPTIONS = ["Entry", "Junior", "Mid", "Senior", "C-Level"];
const WORKING_COUNTRY_OPTIONS = [
  "Denmark", "Norway", "Sweden", "Finland", "Iceland", "Greenland",
  "Estonia", "Latvia", "Lithuania", "Baltic", "Remote",
];

// Returns {token, expiresAt} if a still-valid session is stored, else
// null (and clears anything stale/malformed it finds).
function getStoredSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || !session.expiresAt || session.expiresAt * 1000 <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
}

function storeSession(session) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // localStorage unavailable (private browsing, etc.) — session just
    // won't persist across reloads; not fatal, the gate still works.
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

async function login(password) {
  const res = await fetch(WORKER_URL + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const err = new Error("unauthorized");
    err.unauthorized = true;
    throw err;
  }
  const session = await res.json();
  storeSession(session);
  return session;
}

async function callWorker(path, options = {}) {
  const session = getStoredSession();
  if (!session) {
    const err = new Error("unauthorized");
    err.unauthorized = true;
    throw err;
  }
  const res = await fetch(WORKER_URL + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 403) {
    clearStoredSession();
    const err = new Error("unauthorized");
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// job.jobUrl comes from scraped third-party listings — never trust its
// scheme. Only render it as a link when it's actually http(s); a
// javascript: URL smuggled in as a "job link" would otherwise execute on
// click.
function safeJobUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

function showLogin(message) {
  loginView.style.display = "block";
  appView.style.display = "none";
  logoutBtn.style.display = "none";
  loginError.textContent = message || "";
}

function showApp() {
  loginView.style.display = "none";
  appView.style.display = "block";
  logoutBtn.style.display = "inline-block";
}

const loaded = { review: false, wordcloud: false, missing: false };

function setTab(tab) {
  tabBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  Object.entries(panels).forEach(([name, el]) => el.classList.toggle("active", name === tab));
  if (tab === "review" && !loaded.review) { loaded.review = true; loadFlagged(); }
  if (tab === "wordcloud" && !loaded.wordcloud) { loaded.wordcloud = true; loadWordCloud(); }
  if (tab === "missing" && !loaded.missing) { loaded.missing = true; loadMissingData(); }
}

tabBtns.forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

// --- Flagged jobs ---
function renderJobCard(job) {
  const card = document.createElement("div");
  card.className = "job-card";
  const metaParts = [];
  if (job.company) metaParts.push(escapeHtml(job.company));
  if (job.location) metaParts.push(escapeHtml(job.location));
  if (job.sourceSite) metaParts.push(escapeHtml(job.sourceSite));

  card.innerHTML = `
    <h3>${(() => { const u = safeJobUrl(job.jobUrl); return u ? `<a href="${escapeAttr(u)}" target="_blank" rel="noopener">${escapeHtml(job.jobTitle || "(untitled)")}</a>` : escapeHtml(job.jobTitle || "(untitled)"); })()}</h3>
    <p class="job-meta">${metaParts.map((p) => `<span>${p}</span>`).join("")}</p>
    ${job.rejectionReason ? `<div class="rejection">${escapeHtml(job.rejectionReason)}</div>` : ""}
    <div class="job-actions">
      <button class="btn btn-confirm" data-action="confirm">Confirm — not a job</button>
      <button class="btn btn-override" data-action="override">Override — it's real</button>
    </div>
  `;
  card.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => reviewJob(job.id, btn.dataset.action, card));
  });
  return card;
}

async function reviewJob(id, action, card) {
  card.querySelectorAll("button").forEach((b) => (b.disabled = true));
  try {
    await callWorker(`/jobs/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    card.remove();
    if (!jobList.children.length) reviewEmpty.style.display = "block";
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    card.querySelectorAll("button").forEach((b) => (b.disabled = false));
    alert(`Failed to save: ${err.message}`);
  }
}

async function loadFlagged() {
  reviewStatus.textContent = "Loading…";
  jobList.innerHTML = "";
  reviewEmpty.style.display = "none";
  try {
    const data = await callWorker("/jobs/flagged");
    reviewStatus.textContent = "";
    if (!data.flagged.length) { reviewEmpty.style.display = "block"; return; }
    for (const job of data.flagged) jobList.appendChild(renderJobCard(job));
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    reviewStatus.textContent = `Failed to load: ${err.message}`;
  }
}

// --- Missing data (editable table) ---
function buildSelect(options, current, cssClass) {
  const select = document.createElement("select");
  select.className = cssClass;
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "—";
  select.appendChild(blank);
  for (const opt of options) {
    const el = document.createElement("option");
    el.value = opt;
    el.textContent = opt;
    if (opt === current) el.selected = true;
    select.appendChild(el);
  }
  return select;
}

function markCellState(el, state) {
  el.classList.remove("dirty", "saved", "error");
  if (state) el.classList.add(state);
}

// Debounced per-field save: fires 700ms after the last change to that
// input, and again immediately on blur, so typing a salary number
// doesn't fire a save per keystroke.
function wireCellSave(el, jobId, fieldName, toBody) {
  let timer = null;
  const save = async () => {
    clearTimeout(timer);
    const body = toBody(el.value);
    try {
      await callWorker(`/jobs/${jobId}/fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      markCellState(el, "saved");
      setTimeout(() => markCellState(el, null), 1500);
    } catch (err) {
      if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
      markCellState(el, "error");
    }
  };
  el.addEventListener("input", () => {
    markCellState(el, "dirty");
    clearTimeout(timer);
    timer = setTimeout(save, 700);
  });
  el.addEventListener("change", save); // selects: save immediately on choice
  el.addEventListener("blur", save);
}

function renderMissingRow(job) {
  const tr = document.createElement("tr");

  const jobCell = document.createElement("td");
  jobCell.className = "missing-job-cell";
  const metaParts = [job.company, job.sourceSite].filter(Boolean).map(escapeHtml).join(" · ");
  jobCell.innerHTML = `
    ${(() => { const u = safeJobUrl(job.jobUrl); return u ? `<a href="${escapeAttr(u)}" target="_blank" rel="noopener">${escapeHtml(job.jobTitle || "(untitled)")}</a>` : escapeHtml(job.jobTitle || "(untitled)"); })()}
    ${metaParts ? `<div class="missing-job-meta">${metaParts}</div>` : ""}
  `;
  tr.appendChild(jobCell);

  const minCell = document.createElement("td");
  const minInput = document.createElement("input");
  minInput.className = "cell-input";
  minInput.type = "number";
  minInput.placeholder = "min";
  if (job.salaryMin != null) minInput.value = job.salaryMin;
  wireCellSave(minInput, job.id, "salaryMin", (v) => ({ salaryMin: v === "" ? null : Number(v) }));
  minCell.appendChild(minInput);
  tr.appendChild(minCell);

  const maxCell = document.createElement("td");
  const maxInput = document.createElement("input");
  maxInput.className = "cell-input";
  maxInput.type = "number";
  maxInput.placeholder = "max";
  if (job.salaryMax != null) maxInput.value = job.salaryMax;
  wireCellSave(maxInput, job.id, "salaryMax", (v) => ({ salaryMax: v === "" ? null : Number(v) }));
  maxCell.appendChild(maxInput);
  tr.appendChild(maxCell);

  const seniorityCell = document.createElement("td");
  const senioritySelect = buildSelect(SENIORITY_OPTIONS, job.seniority, "cell-select");
  wireCellSave(senioritySelect, job.id, "seniority", (v) => ({ seniority: v === "" ? null : v }));
  seniorityCell.appendChild(senioritySelect);
  tr.appendChild(seniorityCell);

  const countryCell = document.createElement("td");
  const countrySelect = buildSelect(WORKING_COUNTRY_OPTIONS, job.workingCountry, "cell-select");
  wireCellSave(countrySelect, job.id, "workingCountry", (v) => ({ workingCountry: v === "" ? null : v }));
  countryCell.appendChild(countrySelect);
  tr.appendChild(countryCell);

  return tr;
}

async function loadMissingData() {
  missingStatus.textContent = "Loading…";
  missingSummary.style.display = "none";
  missingTableWrap.style.display = "none";
  missingTbody.innerHTML = "";
  missingEmpty.style.display = "none";
  try {
    const data = await callWorker("/jobs/missing-data");
    missingStatus.textContent = "";
    if (!data.missing.length) { missingEmpty.style.display = "block"; return; }
    missingSummary.style.display = "block";
    missingSummary.textContent = `${data.missing.length} of ${data.totalActive} active jobs are missing at least one field.`;
    missingTableWrap.style.display = "block";
    for (const job of data.missing) missingTbody.appendChild(renderMissingRow(job));
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    missingStatus.textContent = `Failed to load: ${err.message}`;
  }
}

// --- Word cloud ---
// Hand-rolled spiral layout: place words largest-first, spiraling
// outward from center until a candidate spot doesn't overlap anything
// already placed. Real getBBox() measurement, not an estimate, so
// placement matches each word's actual rendered size.
const SVG_NS = "http://www.w3.org/2000/svg";
let lastWords = [];

function rectsOverlap(a, b, pad) {
  return !(a.x + a.w + pad < b.x || b.x + b.w + pad < a.x || a.y + a.h + pad < b.y || b.y + b.h + pad < a.y);
}

function mixColor(c1, c2, t) {
  return `rgb(${c1.map((v, i) => Math.round(v + (c2[i] - v) * t)).join(",")})`;
}

function renderWordCloud(words) {
  const width = 800, height = 440;
  cloudSvg.innerHTML = "";
  if (!words.length) return;

  const counts = words.map((w) => w.count);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const minFont = 13, maxFont = 50;
  const fontSizeFor = (c) => {
    if (maxCount === minCount) return (minFont + maxFont) / 2;
    return minFont + Math.sqrt((c - minCount) / (maxCount - minCount)) * (maxFont - minFont);
  };
  const softAccent = [241, 236, 254], accent = [108, 58, 237];
  const colorFor = (c) => {
    const t = maxCount === minCount ? 0.6 : (c - minCount) / (maxCount - minCount);
    return mixColor(softAccent, accent, 0.25 + t * 0.75);
  };

  const placed = [];
  const centerX = width / 2, centerY = height / 2;

  words.forEach((w) => {
    const el = document.createElementNS(SVG_NS, "text");
    el.setAttribute("font-weight", "700");
    el.setAttribute("font-family", "inherit");
    el.classList.add("tag-target");

    const prefix = document.createElementNS(SVG_NS, "tspan");
    prefix.textContent = w.isTag ? "✓ " : "+ ";
    prefix.setAttribute("font-size", fontSizeFor(w.count) * 0.55);
    prefix.setAttribute("fill", w.isTag ? "#1a8a5f" : "#6c3aed");
    el.appendChild(prefix);

    const wordSpan = document.createElementNS(SVG_NS, "tspan");
    wordSpan.textContent = w.word;
    wordSpan.setAttribute("font-size", fontSizeFor(w.count));
    wordSpan.setAttribute("fill", colorFor(w.count));
    el.appendChild(wordSpan);

    cloudSvg.appendChild(el);
    const bbox = el.getBBox();

    let x = centerX - bbox.width / 2, y = centerY - bbox.height / 2;
    let angle = Math.random() * Math.PI * 2, radius = 0;
    for (let attempt = 0; attempt < 3000; attempt++) {
      x = centerX + radius * Math.cos(angle) - bbox.width / 2;
      y = centerY + radius * Math.sin(angle) * 0.6 - bbox.height / 2;
      const rect = { x, y, w: bbox.width, h: bbox.height };
      const fits = rect.x > 4 && rect.y > 4 && rect.x + rect.w < width - 4 && rect.y + rect.h < height - 4;
      if (fits && !placed.some((p) => rectsOverlap(rect, p, 3))) break;
      angle += 0.28;
      radius += 1.4;
    }
    el.setAttribute("x", x);
    el.setAttribute("y", y + bbox.height * 0.8);
    placed.push({ x, y, w: bbox.width, h: bbox.height });

    el.addEventListener("click", () => toggleTag(w));
  });
}

function showTagToast(text, kind) {
  tagToast.textContent = text;
  tagToast.style.display = "block";
  tagToast.style.background = kind === "error" ? "var(--danger-soft)" : "var(--up-soft)";
  tagToast.style.color = kind === "error" ? "var(--danger)" : "var(--up)";
  clearTimeout(showTagToast._t);
  showTagToast._t = setTimeout(() => { tagToast.style.display = "none"; }, 4000);
}

async function toggleTag(w) {
  try {
    if (w.isTag) {
      await callWorker("/words/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: w.word }),
      });
      showTagToast(`Removed "${w.word}" from Tags.`, "ok");
    } else {
      const result = await callWorker("/words/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: w.word }),
      });
      showTagToast(`"${result.name}" is now a Tag.`, "ok");
    }
    loaded.wordcloud = false;
    await loadWordCloud();
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    showTagToast(`Failed: ${err.message}`, "error");
  }
}

async function loadWordCloud() {
  loaded.wordcloud = true;
  cloudStatus.textContent = "Loading…";
  cloudCard.style.display = "none";
  try {
    const data = await callWorker("/words/frequency");
    lastWords = data.words || [];
    if (!lastWords.length) { cloudStatus.textContent = "No job titles to analyze yet."; return; }
    cloudStatus.textContent = "";
    cloudCard.style.display = "block";
    renderWordCloud(lastWords);
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    cloudStatus.textContent = `Failed to load: ${err.message}`;
  }
}

unlockBtn.addEventListener("click", () => {
  const password = passwordInput.value.trim();
  if (password) tryUnlock(password);
});
passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") unlockBtn.click(); });
logoutBtn.addEventListener("click", () => {
  clearStoredSession();
  passwordInput.value = "";
  loaded.review = loaded.wordcloud = loaded.missing = false;
  setTab("review");
  showLogin();
});

async function tryUnlock(password) {
  unlockBtn.disabled = true;
  loginError.textContent = "";
  try {
    await login(password);
    showApp();
    loadFlagged();
    loaded.review = true;
  } catch (err) {
    clearStoredSession();
    loginError.textContent = err.unauthorized ? "Wrong password." : `Error: ${err.message}`;
  } finally {
    unlockBtn.disabled = false;
  }
}

// On load: if a still-valid session is stored, use it silently rather
// than showing the login form again every visit.
(async () => {
  if (!getStoredSession()) { showLogin(); return; }
  try {
    await callWorker("/jobs/flagged");
    showApp();
    loadFlagged();
    loaded.review = true;
  } catch {
    clearStoredSession();
    showLogin();
  }
})();
