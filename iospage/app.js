// Roadmap board (/iospage) — personal kanban over a Baserow table, proxied
// through jobmatch-worker's /roadmap/cards routes. Reuses the same
// password+TOTP session as the main admin panel: same STORAGE_KEY, same
// Worker, so logging in once on either page unlocks both.
if (window.top !== window.self) {
  throw new Error("framed: refusing to initialise roadmap board");
}

document.documentElement.style.visibility = "visible";

const WORKER_URL = "https://jobmatch-worker.kennethj.workers.dev";
const STORAGE_KEY = "jobmatch_admin_session";

const STAGES = ["Backlog", "Prep", "In Process", "Early Version", "Solid"];
const CATEGORIES = ["kennethjensen.me", "stats", "jobmatch", "backend"];
const TAGS = ["Blocked", "Expensive"];

const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const passwordInput = document.getElementById("password-input");
const totpInput = document.getElementById("totp-input");
const unlockBtn = document.getElementById("unlock-btn");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");
const boardEl = document.getElementById("board");
const boardStatus = document.getElementById("board-status");
const addCardFab = document.getElementById("add-card-fab");
const dictateFab = document.getElementById("dictate-fab");
const dictateStatus = document.getElementById("dictate-status");
const filterChips = document.querySelectorAll(".chip");

const modal = document.getElementById("card-modal");
const modalTitle = document.getElementById("modal-title");
const fieldTitle = document.getElementById("field-title");
const fieldDescription = document.getElementById("field-description");
const fieldCategory = document.getElementById("field-category");
const fieldStage = document.getElementById("field-stage");
const fieldEffort = document.getElementById("field-effort");
const fieldCost = document.getElementById("field-cost");
const modalError = document.getElementById("modal-error");
const saveCardBtn = document.getElementById("save-card-btn");
const cancelCardBtn = document.getElementById("cancel-card-btn");
const deleteCardBtn = document.getElementById("delete-card-btn");

let cards = [];
let activeCategory = "all";
let editingCardId = null; // null while creating
let modalTags = new Set();

function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session.token || session.expiresAt * 1000 < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function clearStoredSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function showLogin(message) {
  loginView.hidden = false;
  appView.hidden = true;
  logoutBtn.hidden = true;
  if (message) loginError.textContent = message;
}

function showApp() {
  loginView.hidden = true;
  appView.hidden = false;
  logoutBtn.hidden = false;
}

async function login(password, totpCode) {
  const res = await fetch(WORKER_URL + "/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, totpCode }),
  });
  if (!res.ok) {
    const err = new Error("login failed");
    err.unauthorized = res.status === 403;
    throw err;
  }
  const { token, expiresAt } = await res.json();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expiresAt }));
}

async function api(path, options = {}) {
  const session = getSession();
  if (!session) {
    const err = new Error("no session");
    err.unauthorized = true;
    throw err;
  }
  const res = await fetch(WORKER_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 403) {
    const err = new Error("unauthorized");
    err.unauthorized = true;
    throw err;
  }
  if (!res.ok) {
    let detail = `status ${res.status}`;
    try {
      const body = await res.json();
      if (body && body.error) detail = body.error;
    } catch {
      // response wasn't JSON — fall back to the status code above
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Baserow row <-> card mapping -----------------------------------

function selectValue(field) {
  return field && typeof field === "object" ? field.value : field || null;
}

function multiSelectValues(field) {
  return Array.isArray(field) ? field.map((f) => f.value) : [];
}

function mapRowToCard(row) {
  return {
    id: row.id,
    title: row.Title || "",
    description: row.Description || "",
    category: selectValue(row.Category) || CATEGORIES[0],
    stage: selectValue(row.Stage) || STAGES[0],
    effort: Number(row.Effort) || 1,
    cost: Number(row["Cost (DKK)"]) || 0,
    tags: multiSelectValues(row.Tags),
    order: Number(row.Order) || 0,
  };
}

function cardToPayload(card) {
  return {
    Title: card.title,
    Description: card.description,
    Category: card.category,
    Stage: card.stage,
    Effort: card.effort,
    "Cost (DKK)": card.cost,
    Tags: card.tags,
    Order: card.order,
  };
}

// --- Rendering ---------------------------------------------------------

function cardsForStage(stage) {
  return cards
    .filter((c) => c.stage === stage)
    .filter((c) => activeCategory === "all" || c.category === activeCategory)
    .sort((a, b) => a.order - b.order);
}

function renderCardEl(card) {
  const el = document.createElement("div");
  el.className = "card";
  el.dataset.id = card.id;

  const dots = Array.from({ length: 5 }, (_, i) =>
    `<span class="${i < card.effort ? "filled" : ""}"></span>`
  ).join("");

  const tagPills = card.tags
    .map((t) => `<span class="pill pill-${t.toLowerCase()}">${t}</span>`)
    .join("");

  const costBadge = card.cost > 0
    ? `<span class="card-cost">${Math.round(card.cost).toLocaleString("en-GB")} kr</span>`
    : "";

  el.innerHTML = `
    <p class="card-title"></p>
    <div class="card-meta">
      <span class="pill pill-category"></span>
      ${tagPills}
    </div>
    <div class="card-footer">
      <div class="effort-dots">${dots}</div>
      ${costBadge}
    </div>
  `;
  el.querySelector(".card-title").textContent = card.title || "(untitled)";
  el.querySelector(".pill-category").textContent = card.category;
  el.addEventListener("click", () => openModal(card));
  return el;
}

function renderBoard() {
  boardEl.innerHTML = "";
  for (const stage of STAGES) {
    const stageCards = cardsForStage(stage);
    const column = document.createElement("div");
    column.className = "column";
    column.dataset.stage = stage;
    column.innerHTML = `
      <div class="column-head">
        <h2>${stage}</h2>
        <span class="column-count">${stageCards.length}</span>
      </div>
      <div class="column-list" data-stage="${stage}"></div>
    `;
    const list = column.querySelector(".column-list");
    if (stageCards.length === 0) {
      list.innerHTML = `<div class="column-empty">No ideas here yet</div>`;
    } else {
      for (const card of stageCards) list.appendChild(renderCardEl(card));
    }
    boardEl.appendChild(column);

    new Sortable(list, {
      group: "board",
      animation: 150,
      delay: 80,
      delayOnTouchOnly: true,
      touchStartThreshold: 4,
      onEnd: handleDrop,
    });
  }
}

async function handleDrop(evt) {
  const cardId = Number(evt.item.dataset.id);
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;

  const newStage = evt.to.dataset.stage;
  const siblingIds = Array.from(evt.to.children)
    .map((el) => Number(el.dataset.id))
    .filter((id) => id !== cardId);

  const siblingCards = siblingIds
    .map((id) => cards.find((c) => c.id === id))
    .filter(Boolean);
  const index = Array.from(evt.to.children).findIndex((el) => Number(el.dataset.id) === cardId);

  const prevOrder = index > 0 ? siblingCards[index - 1]?.order : undefined;
  const nextOrder = siblingCards[index] !== undefined ? siblingCards[index]?.order : undefined;
  let newOrder;
  if (prevOrder === undefined && nextOrder === undefined) newOrder = 1;
  else if (prevOrder === undefined) newOrder = nextOrder - 1;
  else if (nextOrder === undefined) newOrder = prevOrder + 1;
  else newOrder = (prevOrder + nextOrder) / 2;

  card.stage = newStage;
  card.order = newOrder;

  try {
    await api(`/roadmap/cards/${cardId}`, {
      method: "PATCH",
      body: JSON.stringify({ Stage: newStage, Order: newOrder }),
    });
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    boardStatus.hidden = false;
    boardStatus.textContent = `Couldn't save the move: ${err.message}`;
  } finally {
    renderBoard();
  }
}

// --- Loading -------------------------------------------------------

async function loadBoard() {
  boardStatus.hidden = false;
  boardStatus.textContent = "Loading…";
  boardEl.hidden = true;
  try {
    const data = await api("/roadmap/cards");
    cards = (data.cards || []).map(mapRowToCard);
    boardStatus.hidden = true;
    boardEl.hidden = false;
    renderBoard();
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    boardStatus.textContent = `Couldn't load the board: ${err.message}`;
  }
}

// --- Modal -----------------------------------------------------------

// `draft` prefills a *new* card's fields (e.g. from dictation) without
// making it an edit — editingCardId stays null so Save still POSTs.
function openModal(card, draft) {
  const source = card || draft;
  editingCardId = card ? card.id : null;
  modalTitle.textContent = card ? "Edit idea" : "New idea";
  fieldTitle.value = source ? source.title || "" : "";
  fieldDescription.value = source ? source.description || "" : "";
  fieldCategory.value = source && source.category ? source.category : (activeCategory !== "all" ? activeCategory : CATEGORIES[0]);
  fieldStage.value = (source && source.stage) || STAGES[0];
  fieldEffort.dataset.value = String((source && source.effort) || 1);
  fieldCost.value = source ? source.cost || "" : "";
  modalTags = new Set(source ? source.tags || [] : []);
  modalError.textContent = "";
  deleteCardBtn.hidden = !card;
  updateEffortDots();
  updateTagToggles();
  modal.hidden = false;
  if (draft && !card) fieldTitle.focus();
}

function closeModal() {
  modal.hidden = true;
  editingCardId = null;
}

function updateEffortDots() {
  const value = Number(fieldEffort.dataset.value);
  fieldEffort.querySelectorAll(".dot").forEach((dot) => {
    dot.classList.toggle("filled", Number(dot.dataset.dot) <= value);
  });
}

function updateTagToggles() {
  document.querySelectorAll(".tag-toggle").forEach((btn) => {
    btn.classList.toggle("on", modalTags.has(btn.dataset.tag));
  });
}

fieldEffort.addEventListener("click", (e) => {
  const dot = e.target.closest(".dot");
  if (!dot) return;
  fieldEffort.dataset.value = dot.dataset.dot;
  updateEffortDots();
});

document.querySelectorAll(".tag-toggle").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tag = btn.dataset.tag;
    if (modalTags.has(tag)) modalTags.delete(tag);
    else modalTags.add(tag);
    updateTagToggles();
  });
});

cancelCardBtn.addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

saveCardBtn.addEventListener("click", async () => {
  const title = fieldTitle.value.trim();
  if (!title) {
    modalError.textContent = "Give it a title.";
    return;
  }
  saveCardBtn.disabled = true;
  modalError.textContent = "";

  const existing = editingCardId ? cards.find((c) => c.id === editingCardId) : null;
  const card = {
    title,
    description: fieldDescription.value.trim(),
    category: fieldCategory.value,
    stage: fieldStage.value,
    effort: Number(fieldEffort.dataset.value),
    cost: Number(fieldCost.value) || 0,
    tags: Array.from(modalTags),
    order: existing ? existing.order : (Math.max(0, ...cards.filter((c) => c.stage === fieldStage.value).map((c) => c.order)) + 1),
  };

  try {
    if (editingCardId) {
      await api(`/roadmap/cards/${editingCardId}`, {
        method: "PATCH",
        body: JSON.stringify(cardToPayload(card)),
      });
    } else {
      await api("/roadmap/cards", {
        method: "POST",
        body: JSON.stringify(cardToPayload(card)),
      });
    }
    closeModal();
    await loadBoard();
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    modalError.textContent = `Couldn't save: ${err.message}`;
  } finally {
    saveCardBtn.disabled = false;
  }
});

deleteCardBtn.addEventListener("click", async () => {
  if (!editingCardId) return;
  if (!confirm("Delete this idea for good?")) return;
  try {
    await api(`/roadmap/cards/${editingCardId}`, { method: "DELETE" });
    closeModal();
    await loadBoard();
  } catch (err) {
    if (err.unauthorized) { clearStoredSession(); showLogin("Session expired. Enter the password again."); return; }
    modalError.textContent = `Couldn't delete: ${err.message}`;
  }
});

addCardFab.addEventListener("click", () => openModal(null));

// --- Dictation -----------------------------------------------------

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function showDictateStatus(text) {
  dictateStatus.textContent = text;
  dictateStatus.hidden = false;
}

function hideDictateStatus() {
  dictateStatus.hidden = true;
}

function deriveTitle(text) {
  const trimmed = text.trim();
  const sentenceEnd = trimmed.search(/[.!?](\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd < 80) return trimmed.slice(0, sentenceEnd + 1);
  return trimmed.length > 60 ? trimmed.slice(0, 60).trim() + "…" : trimmed;
}

async function startRecording() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    showDictateStatus("Microphone access denied.");
    setTimeout(hideDictateStatus, 2500);
    return;
  }

  audioChunks = [];
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) audioChunks.push(e.data);
  });
  mediaRecorder.addEventListener("stop", () => {
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
    transcribeAndOpen(blob);
  });

  mediaRecorder.start();
  isRecording = true;
  dictateFab.classList.add("recording");
  showDictateStatus("Listening… tap to stop");
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;
  mediaRecorder.stop();
  isRecording = false;
  dictateFab.classList.remove("recording");
  showDictateStatus("Transcribing…");
}

async function transcribeAndOpen(blob) {
  const session = getSession();
  if (!session) {
    hideDictateStatus();
    showLogin("Session expired. Enter the password again.");
    return;
  }
  try {
    const res = await fetch(WORKER_URL + "/roadmap/transcribe", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": blob.type || "application/octet-stream",
      },
      body: blob,
    });
    if (res.status === 403) {
      clearStoredSession();
      hideDictateStatus();
      showLogin("Session expired. Enter the password again.");
      return;
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `status ${res.status}`);
    hideDictateStatus();
    const text = (data.text || "").trim();
    if (!text) {
      showDictateStatus("Didn't catch that — try again.");
      setTimeout(hideDictateStatus, 2500);
      return;
    }
    openModal(null, { title: deriveTitle(text), description: text });
  } catch (err) {
    showDictateStatus(`Transcription failed: ${err.message}`);
    setTimeout(hideDictateStatus, 3500);
  }
}

dictateFab.addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

// --- Filters -----------------------------------------------------------

filterChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    filterChips.forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    activeCategory = chip.dataset.category;
    renderBoard();
  });
});

// --- Login wiring --------------------------------------------------

function tryUnlock(password, totpCode) {
  unlockBtn.disabled = true;
  loginError.textContent = "";
  login(password, totpCode)
    .then(() => {
      passwordInput.value = "";
      totpInput.value = "";
      showApp();
      addCardFab.hidden = false;
      dictateFab.hidden = false;
      loadBoard();
    })
    .catch((err) => {
      loginError.textContent = err.unauthorized ? "Wrong password or code." : `Error: ${err.message}`;
    })
    .finally(() => {
      unlockBtn.disabled = false;
    });
}

unlockBtn.addEventListener("click", () => {
  const password = passwordInput.value.trim();
  const totpCode = totpInput.value.trim();
  if (password && totpCode) tryUnlock(password, totpCode);
});
passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") totpInput.focus(); });
totpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") unlockBtn.click(); });

logoutBtn.addEventListener("click", () => {
  clearStoredSession();
  addCardFab.hidden = true;
  dictateFab.hidden = true;
  showLogin();
});

// --- Boot ------------------------------------------------------------

document.getElementById("year") && (document.getElementById("year").textContent = new Date().getFullYear());

if (getSession()) {
  showApp();
  addCardFab.hidden = false;
  dictateFab.hidden = false;
  loadBoard();
} else {
  showLogin();
}
