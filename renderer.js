// renderer.js

const listEl = document.getElementById("list");
const footerEl = document.getElementById("footer");
const refreshBtn = document.getElementById("refresh");
const closeBtn = document.getElementById("close");
const settingsBtn = document.getElementById("settings");
const weekdayEl = document.getElementById("weekday");
const rootEl = document.getElementById("Tímatalva");

// Notification toggle:

const NOTIF_KEY = "untis.notifications";
const notifToggle = document.getElementById("notifToggle");

if (notifToggle) {
  notifToggle.checked = localStorage.getItem(NOTIF_KEY) !== "off";
  notifToggle.onchange = () => {
    localStorage.setItem(NOTIF_KEY, notifToggle.checked ? "on" : "off");
  };
}

// Header line 2 (selected element label)
const titleSelectedEl = document.getElementById("titleSelected");

// Modal elements
const modal = document.getElementById("modal");
const modeClassBtn = document.getElementById("modeClass");
const modeTeacherBtn = document.getElementById("modeTeacher");
const classSelect = document.getElementById("classSelect");
const teacherSelect = document.getElementById("teacherSelect");
const filterInput = document.getElementById("filterInput");
const saveNameBtn = document.getElementById("saveName");
const cancelModalBtn = document.getElementById("cancelModal");
const modalError = document.getElementById("modalError");
const helpBtn = document.getElementById("helpBtn");

const LS_KEY = "untis.element";

let resolved = null;
let cachedLists = null;
let refreshTimer = null;
let currentReqId = 0;
let midnightTimer = null;
let endOfDayTimer = null;
let mode = "class"; // "class" | "teacher"

// track which date we are viewing
let viewingTomorrow = false;
let viewingDateISO = null; // YYYY-MM-DD when viewing tomorrow; null when viewing today

/* ---------- utils ---------- */
function isoOf(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

/* ---------- Weekday pill ---------- */
function setWeekdayLabel() {
  if (!weekdayEl) return;
  if (viewingTomorrow) { weekdayEl.textContent = "í morgin"; return; }
  const foDays = [
    "Sunnudagur","Mánadagur","Týsdagur",
    "Mikudagur","Hósdagur","Fríggjadagur","Leygardagur"
  ];
  weekdayEl.textContent = foDays[new Date().getDay()];
}
function scheduleMidnightRollover() {
  if (midnightTimer) { clearTimeout(midnightTimer); midnightTimer = null; }
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1, 0); // 00:00:01
  const ms = Math.max(1000, next - now);
  midnightTimer = setTimeout(() => {
    // new day starts → stop viewing "tomorrow"
    viewingTomorrow = false;
    viewingDateISO = null;
    setWeekdayLabel();
    if (!document.hidden) load();
    scheduleMidnightRollover();
  }, ms);
}

/* ---------- Window auto-resize (de-jitter + modal-aware) ---------- */
let lastSentH = 0;
function sendContentHeight() {
  try {
    if (!window.untis || typeof window.untis.resizeTo !== "function") return;

    const base = (() => {
      const el = document.getElementById("Tímatalva");
      return el ? Math.ceil(el.getBoundingClientRect().height) : 0;
    })();

    let needed = base;
    if (modal && !modal.classList.contains("hidden")) {
      const card = modal.querySelector(".modal-card");
      if (card) {
        const r = card.getBoundingClientRect();
        needed = Math.max(needed, Math.ceil(r.height + 32));
      }
    }

    if (needed > 20 && Math.abs(needed - lastSentH) >= 2) {
      lastSentH = needed;
      window.untis.resizeTo(needed);
    }
  } catch {}
}
const ro = new ResizeObserver(() => requestAnimationFrame(sendContentHeight));
if (rootEl) ro.observe(rootEl);
const modalCardEl = document.querySelector(".modal-card");
if (modalCardEl) ro.observe(modalCardEl);

/* ---------- Time formatting ---------- */
function fmt(t) {
  try {
    return new Date(t).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  } catch {
    return "—"; }
}

/* ---------- Helpers: clear after last lesson ends (for today view) ---------- */
function scheduleEndOfDayClear(lastEndMs) {
  if (endOfDayTimer) { clearTimeout(endOfDayTimer); endOfDayTimer = null; }
  const delay = lastEndMs - Date.now();
  if (delay > 500) {
    endOfDayTimer = setTimeout(() => { load(); }, delay + 1000);
  }
}

/* ---------- Render ---------- */
// ...existing code...

function render(lessons) {
  // Sort lessons by start time
  lessons = lessons.slice().sort((a, b) => new Date(a.start) - new Date(b.start));

  // Group overlapping lessons
  const groups = [];
  let currentGroup = [];

  for (const lesson of lessons) {
    if (
      currentGroup.length === 0 ||
      new Date(lesson.start) < new Date(currentGroup[currentGroup.length - 1].end)
    ) {
      currentGroup.push(lesson);
    } else {
      groups.push(currentGroup);
      currentGroup = [lesson];
    }
  }
  if (currentGroup.length) groups.push(currentGroup);

  // Render groups
  listEl.innerHTML = groups.length
    ? groups
        .map(group =>
          group.length === 1
            ? `<div class="card ${group[0].isCancelled ? "Avlýst 🎈" : ""}">
                <div class="left">
                  <div class="subject">${group[0].subject || "—"}</div>
                  <div class="meta">${fmt(group[0].start)} – ${fmt(group[0].end)} • ${group[0].room || "—"}${group[0].teacher ? " • " + group[0].teacher : ""}</div>
                </div>
              </div>`
            : `<div class="overlap-group">
                ${group
                  .map(
                    l => `<div class="card ${l.isCancelled ? "Avlýst 🎈" : ""}">
                      <div class="left">
                        <div class="subject">${l.subject || "—"}</div>
                        <div class="meta">${fmt(l.start)} – ${fmt(l.end)} • ${l.room || "—"}${l.teacher ? " • " + l.teacher : ""}</div>
                      </div>
                    </div>`
                  )
                  .join("")}
              </div>`
        )
        .join("")
    : `<div class="empty">${viewingTomorrow ? "Oyoy - tú hevur frí í morgin 🍹" : "Stoyki, tú hevur frí nú 🐸"}</div>`;

  footerEl.textContent = new Date().toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  sendContentHeight();
}

function updateTitleSelected() {
  titleSelectedEl.textContent =
    (resolved && resolved.label) ||
    (window.untis && window.untis.defaultName) || "";
}

function clearRefreshTimer() {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
}
function scheduleNextRefresh(lessons) {
  clearRefreshTimer();
  if (document.hidden) return;

  // If viewing tomorrow, no need for frequent refreshes.
  if (viewingTomorrow) {
    refreshTimer = setTimeout(() => { if (!document.hidden) load(); }, 30 * 60 * 1000);
    return;
  }

  const now = Date.now();
  let nextMs = 15 * 60 * 1000;
  if (Array.isArray(lessons) && lessons.length) {
    const upcoming = lessons
      .filter(l => new Date(l.start).getTime() > now)
      .sort((a,b) => +new Date(a.start) - +new Date(b.start))[0];
    if (upcoming) {
      const eta = new Date(upcoming.start).getTime() - now - 2 * 60 * 1000;
      if (eta > 10 * 1000) nextMs = Math.min(nextMs, eta);
    }
  }
  refreshTimer = setTimeout(() => { if (!document.hidden) load(); }, nextMs);
}

/* ---------- Load (today or tomorrow after 18:00) ---------- */
async function load() {
  try {
    const api = window.untis;
    if (!api) throw new Error("Preload ikki løtt.");

    const reqId = ++currentReqId;

    setWeekdayLabel();

    if (!resolved) {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) { try { resolved = JSON.parse(saved); } catch {} }
    }
    if (!resolved) {
      const name = (api && api.defaultName) || "M5";
      const r = await api.resolveElementByName(name);
      if (reqId !== currentReqId) return;
      resolved = r;
      localStorage.setItem(LS_KEY, JSON.stringify(resolved));
    }

    updateTitleSelected();

    // load today's lessons first
    const todayLessons = await api.getToday(resolved.id, resolved.type);
    if (reqId !== currentReqId) return;

    const now = new Date();
    const hour = now.getHours();

    let view = todayLessons.slice();
    let showTomorrow = false;

    if (view.length) {
      const lastEnd = Math.max(...view.map(l => new Date(l.end).getTime()));
      if (Date.now() >= lastEnd) {
        showTomorrow = hour >= 18;
        if (!showTomorrow) view = [];
      } else {
        scheduleEndOfDayClear(lastEnd);
      }
    } else {
      showTomorrow = hour >= 18;
    }

    if (showTomorrow) {
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const iso = isoOf(tomorrow);
      viewingTomorrow = true;
      viewingDateISO = iso;
      setWeekdayLabel();

      const tomorrowLessons = await api.getForDate(resolved.id, resolved.type, iso).catch(() => []);
      if (reqId !== currentReqId) return;

      render(tomorrowLessons);
      // do not schedule toasts for tomorrow
      scheduleNextRefresh(tomorrowLessons);
      return;
    }

    // viewing today
    viewingTomorrow = false;
    viewingDateISO = null;
    setWeekdayLabel();

    render(view);
if (localStorage.getItem(NOTIF_KEY) !== "off") {
  api.scheduleToasts(todayLessons);
}
    scheduleNextRefresh(todayLessons);
} catch (e) {
  console.error(e);
  const msg = (() => {
    const offline = typeof navigator !== "undefined" && navigator && navigator.onLine === false;
    const text = String(e && (e.message || e)) || "";
    if (offline) return "Onoy internetið... 🙉";
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo|network|fetch failed/i.test(text))
      return "Kanna netsambandið og royn aftur 🤓.";
    return `Villa: ${text}`;
  })();
  listEl.innerHTML = `<div class="empty">${viewingTomorrow ? ".... hvar fór internetið ? 🙉" : msg}</div>`;
  requestAnimationFrame(sendContentHeight);
}
}
 // } catch (e) {
 //   console.error(e);
 //   listEl.innerHTML = `<div class="empty">${viewingTomorrow ? "hov... hvar fór internetið ? 🤓" : `Villa: ${e.message || e}`}</div>`;
 //   requestAnimationFrame(sendContentHeight);
 //   scheduleNextRefresh([]);
 // }
/* ---------- Settings modal ---------- */
function setMode(next) {
  if (next === mode) return;
  mode = next;
  modeClassBtn.classList.toggle("active", mode === "class");
  modeTeacherBtn.classList.toggle("active", mode === "teacher");
  classSelect.classList.toggle("hidden", mode !== "class");
  teacherSelect.classList.toggle("hidden", mode !== "teacher");
  fillOptions();
}

function openModal() {
  modal.classList.remove("hidden");
  modalError.textContent = "";
  ensureLists().then(() => {
    mode = (resolved && resolved.type === 2) ? "teacher" : "class";
    modeClassBtn.classList.toggle("active", mode === "class");
    modeTeacherBtn.classList.toggle("active", mode === "teacher");
    classSelect.classList.toggle("hidden", mode !== "class");
    teacherSelect.classList.toggle("hidden", mode !== "teacher");
    fillOptions();
    setTimeout(() => filterInput.focus(), 50);
    if (!cachedLists?.meta?.classesAvailable && !cachedLists?.meta?.teachersAvailable) {
      modalError.textContent = "Er internetið horvið ? 🤓";
    }
    requestAnimationFrame(sendContentHeight);
  });
}
function closeModal() {
  modal.classList.add("hidden");
  modalError.textContent = "";
  requestAnimationFrame(sendContentHeight);
}

async function ensureLists() {
  if (cachedLists) return;
  try { cachedLists = await window.untis.listElements(); }
  catch (e) {
    modalError.textContent = "Kundi ikki heinta yvirlitið.";
    cachedLists = { classes: [], teachers: [], meta: { classesAvailable: false, teachersAvailable: false } };
  }
}
function fillOptions() {
  const filter = (filterInput.value || "").trim().toLowerCase();
  const selectedLabel = resolved?.label;

  const fill = (sel, arr, selectedLabel, typeNum) => {
    sel.innerHTML = "";
    for (const item of (arr || [])) {
      const label = String(item.label || "").trim();
      if (filter && !label.toLowerCase().includes(filter)) continue;
      const opt = document.createElement("option");
      opt.value = String(item.id);
      opt.textContent = label;                 // initials for teachers, names for classes
      opt.dataset.id = String(item.id);
      opt.dataset.type = String(typeNum);
      if (selectedLabel && label === selectedLabel) opt.selected = true;
      sel.appendChild(opt);
    }
    if (!sel.value && sel.options.length) sel.options[0].selected = true;
  };

  if (mode === "class") {
    fill(classSelect, cachedLists?.classes, selectedLabel, 1);
  } else {
    fill(teacherSelect, cachedLists?.teachers, selectedLabel, 2);
  }

  requestAnimationFrame(sendContentHeight);
}

/* Save selection */
async function saveSelection() {
  const activeSel = (mode === "class") ? classSelect : teacherSelect;
  const opt = activeSel.options[activeSel.selectedIndex];

  if (opt && opt.dataset && opt.dataset.id) {
    const id = Number(opt.dataset.id);
    const type = Number(opt.dataset.type || (mode === "class" ? 1 : 2));
    const label = opt.textContent || "";
    resolved = { id, type, label };
    localStorage.setItem(LS_KEY, JSON.stringify(resolved));
    closeModal(); updateTitleSelected(); await load(); return;
  }

  // Fallback: user typed something
  const typed = (filterInput.value || "").trim();
  if (!typed) {
    modalError.textContent = "Vel flokk ella lærara, ella skriva (t.d. 5)";
    return;
  }
  try {
    const r = await window.untis.resolveElementByName(typed);
    resolved = r;
    localStorage.setItem(LS_KEY, JSON.stringify(r));
    closeModal(); updateTitleSelected(); await load();
  } catch (e) {
    modalError.textContent = "Fann ikki navnið.";
  }
}

/* ---------- Wire up ---------- */
refreshBtn.onclick = () => load();
closeBtn.onclick = () => window.close();
settingsBtn.onclick = openModal;
saveNameBtn.onclick = saveSelection;
cancelModalBtn.onclick = closeModal;
filterInput.oninput = fillOptions;

modeClassBtn.onclick = () => setMode("class");
modeTeacherBtn.onclick = () => setMode("teacher");

if (helpBtn) helpBtn.onclick = () => { if (window.untis && window.untis.openHelp) window.untis.openHelp(); };
if (window.untis && window.untis.onTriggerRefresh) window.untis.onTriggerRefresh(() => load());

// Weekday pill → open WebUntis in browser for the viewed date (today or tomorrow)
if (weekdayEl) {
  weekdayEl.onclick = () => {
    if (resolved?.id && resolved?.type) {
      window.untis.openUntisWeek({
        id: resolved.id,
        type: resolved.type,
        date: viewingTomorrow ? viewingDateISO : undefined
      });
    }
  };
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
    currentReqId++;
  } else {
    setWeekdayLabel();
    load();
    scheduleMidnightRollover();
    requestAnimationFrame(sendContentHeight);
  }
});

window.addEventListener("load", () => {
  setWeekdayLabel();
  scheduleMidnightRollover();
  requestAnimationFrame(sendContentHeight);
  load();
});

// ---------- hat auto-display ----------
function toggleSantaHat() {
  const hat = document.getElementById("santaHat");
  if (!hat) return;

  const today = new Date();
  const m = today.getMonth(); // 0 = Jan
  const d = today.getDate();

  const inSeason = (m === 11) || (m === 0 && d <= 1);  //replace with this to test  ->// const inSeason = true; // ella být "11" um við mánaðin tú ert í, minus 1 //
  hat.style.display = inSeason ? "block" : "none";

}

window.addEventListener("load", () => {
  setWeekdayLabel();
  scheduleMidnightRollover();
  requestAnimationFrame(sendContentHeight);
  load();
  toggleSantaHat();
});
