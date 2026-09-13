const STORAGE_KEY = "calorie-tracker-v1";

const prevDayBtn = document.getElementById("prev-day");
const nextDayBtn = document.getElementById("next-day");
const dateLabelBtn = document.getElementById("date-label");
const datePicker = document.getElementById("date-picker");
const dayTotalEl = document.getElementById("day-total");
const entryCountEl = document.getElementById("entry-count");
const addForm = document.getElementById("add-form");
const foodNameInput = document.getElementById("food-name");
const foodCaloriesInput = document.getElementById("food-calories");
const entryList = document.getElementById("entry-list");
const emptyState = document.getElementById("empty-state");
const historyList = document.getElementById("history-list");

function todayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function shiftDay(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function formatDayLabel(iso) {
  if (iso === todayKey()) return "Today";
  if (iso === shiftDay(todayKey(), -1)) return "Yesterday";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function loadDays() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDays(days) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
  window.CalTrakDrive.scheduleSave(days);
}

function dayTotal(entries) {
  return entries.reduce((sum, entry) => sum + entry.calories, 0);
}

const state = {
  selectedDay: todayKey(),
  days: loadDays(),
};

function entriesFor(day) {
  return state.days[day] ?? [];
}

function render() {
  const entries = entriesFor(state.selectedDay);
  const total = dayTotal(entries);

  dateLabelBtn.textContent = formatDayLabel(state.selectedDay);
  datePicker.value = state.selectedDay;
  dayTotalEl.textContent = String(total);
  entryCountEl.textContent =
    entries.length === 0
      ? "No entries yet"
      : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;

  entryList.replaceChildren();
  emptyState.classList.toggle("hidden", entries.length > 0);

  for (const entry of [...entries].reverse()) {
    const li = document.createElement("li");
    li.className = "entry";

    const info = document.createElement("div");
    const name = document.createElement("div");
    name.className = "entry-name";
    name.textContent = entry.name || "Calories";
    const kcal = document.createElement("div");
    kcal.className = "entry-kcal";
    kcal.textContent = `${entry.calories} kcal`;
    info.append(name, kcal);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-btn";
    remove.textContent = "Delete";
    remove.addEventListener("click", () => removeEntry(entry.id));

    li.append(info, remove);
    entryList.append(li);
  }

  const historyDays = Object.keys(state.days)
    .filter((day) => (state.days[day] ?? []).length > 0)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 14);

  historyList.replaceChildren();
  if (historyDays.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Past days will show up here.";
    historyList.append(empty);
    return;
  }

  for (const day of historyDays) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    const label = document.createElement("span");
    label.className = "history-date";
    label.textContent = formatDayLabel(day);
    const kcal = document.createElement("span");
    kcal.className = "history-kcal";
    kcal.textContent = `${dayTotal(state.days[day])} kcal`;
    button.append(label, kcal);
    button.addEventListener("click", () => {
      state.selectedDay = day;
      render();
    });
    historyList.append(button);
  }
}

function addEntry(name, calories) {
  const entry = {
    id: crypto.randomUUID(),
    name: name.trim(),
    calories,
    createdAt: Date.now(),
  };
  const next = [...entriesFor(state.selectedDay), entry];
  state.days = { ...state.days, [state.selectedDay]: next };
  saveDays(state.days);
  render();
}

function removeEntry(id) {
  const next = entriesFor(state.selectedDay).filter((entry) => entry.id !== id);
  if (next.length === 0) {
    const { [state.selectedDay]: _, ...rest } = state.days;
    state.days = rest;
  } else {
    state.days = { ...state.days, [state.selectedDay]: next };
  }
  saveDays(state.days);
  render();
}

prevDayBtn.addEventListener("click", () => {
  state.selectedDay = shiftDay(state.selectedDay, -1);
  render();
});

nextDayBtn.addEventListener("click", () => {
  state.selectedDay = shiftDay(state.selectedDay, 1);
  render();
});

dateLabelBtn.addEventListener("click", () => {
  if (typeof datePicker.showPicker === "function") {
    datePicker.showPicker();
  } else {
    datePicker.focus();
    datePicker.click();
  }
});

datePicker.addEventListener("change", () => {
  if (datePicker.value) {
    state.selectedDay = datePicker.value;
    render();
  }
});

addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const calories = Number.parseInt(foodCaloriesInput.value, 10);
  if (!Number.isFinite(calories) || calories <= 0) return;
  addEntry(foodNameInput.value, calories);
  addForm.reset();
  foodNameInput.focus();
});

const accountStatus = document.getElementById("account-status");
const googleAuthBtn = document.getElementById("google-auth-btn");
const clientIdInput = document.getElementById("client-id-input");
const saveClientIdBtn = document.getElementById("save-client-id");
const driveSetup = document.getElementById("drive-setup");

function setAccountStatus(text) {
  accountStatus.textContent = text;
}

function refreshAuthButton() {
  googleAuthBtn.textContent = window.CalTrakDrive.token ? "Sign out" : "Sign in with Google";
}

window.CalTrakDrive.onStatus = (text) => {
  setAccountStatus(text);
  refreshAuthButton();
};

window.CalTrakDrive.onSignedIn = async () => {
  try {
    state.days = await window.CalTrakDrive.pullAndMerge(state.days);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.days));
    render();
  } catch (error) {
    setAccountStatus(error.message || "Drive sync failed.");
  }
};

googleAuthBtn.addEventListener("click", () => {
  if (window.CalTrakDrive.token) {
    window.CalTrakDrive.signOut();
    refreshAuthButton();
    return;
  }
  window.CalTrakDrive.signIn();
});

saveClientIdBtn.addEventListener("click", () => {
  const id = clientIdInput.value.trim();
  if (!id) return;
  window.CalTrakDrive.saveClientId(id);
  window.CalTrakDrive.init();
  setAccountStatus("Client ID saved. Sign in with Google to back up.");
});

clientIdInput.value = window.CalTrakDrive.clientId();
if (window.CalTrakDrive.clientId()) {
  driveSetup.open = false;
}

window.addEventListener("load", () => {
  window.CalTrakDrive.init();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

render();
refreshAuthButton();
