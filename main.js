// main.js
import {
  app, BrowserWindow, Tray, Menu, nativeImage, Notification,
  ipcMain, session, powerMonitor, screen, globalShortcut, shell
} from "electron";
import path from "node:path";
import fs from "node:fs";
import dotenv from "dotenv";
import { WebUntisAnonymousAuth, WebUntisElementType } from "webuntis";

let win = null, tray = null, helpWin = null, destroyTimer = null;
const WIN_WIDTH = 360;
const MIN_HEIGHT = 140;

/* -------------------- single instance -------------------- */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.on("second-instance", () => {
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  else toggleWindow();
});

/* -------------------- .env loader -------------------- */
function loadEnv() {
  const candidates = [
    path.join(process.resourcesPath, ".env"),
    path.join(app.getAppPath(), ".env"),
    path.join(process.cwd(), ".env")
  ];
  for (const p of candidates) { if (fs.existsSync(p)) { dotenv.config({ path: p }); break; } }
}
loadEnv();

/* -------------------- icon / resource helpers -------------------- */
function getIconPath() {
  const filename = "icon.ico";
  return app.isPackaged ? path.join(process.resourcesPath, filename) : path.join(app.getAppPath(), filename);
}
function getBundledPath(rel) {
  const candidates = [path.join(process.resourcesPath, rel), path.join(app.getAppPath(), rel)];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return candidates[0];
}

/* -------------------- Untis helpers -------------------- */
function getServer()  { return process.env.UNTIS_SERVER || "hektor.webuntis.com"; }
function getSchool()  { return process.env.UNTIS_SCHOOL || "Vinnuhaskulin Torshavn"; }
function getBaseUrl() { return `https://${getServer()}/WebUntis`; }
function getClient()  { return new WebUntisAnonymousAuth(getSchool(), getServer()); }

function parseUntisTime(date, hhmm) {
  const h = Math.floor(hhmm / 100), m = hhmm % 100;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0);
}

/* ---------- mapping helpers (RPC + public weekly) ---------- */
function toInitialsFromString(s) {
  const clean = String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  // If it's already compact initials like "WP" or "NJ", keep as-is.
  if (/^[A-ZÁÐÍÓÚÝÆØÅ]{1,5}$/.test(clean.trim())) return clean.trim();
  const parts = clean.split(/[\s.\-_/]+/).filter(Boolean);
  return parts.map(p => p[0]).join("").toUpperCase();
}

function normStr(s) {
  return String(s || "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim();
}

const GENERIC_SUBJECTS = new Set([
  "undirvísing","undirvising","undervisning","lektion","lesson","class"
].map(normStr));

function makeElemLookup(root) {
  const arr =
    (Array.isArray(root?.elements) && root.elements) ||
    (Array.isArray(root?.elementList) && root.elementList) ||
    (Array.isArray(root?.elementIds) && root.elementIds) ||
    [];
  const m = new Map();
  for (const e of arr) m.set(`${Number(e?.type)}:${Number(e?.id)}`, e);
  return m;
}
function pickLabel(e, pref /* "subject" | "room" | "teacher" */) {
  if (!e) return "";
  if (pref === "room")  return e.name || e.displayname || e.displayName || e.longname || e.longName || "";
  if (pref === "teacher") return e.name || e.displayname || e.displayName || e.longname || e.longName || "";
  // subject
  return e.longname || e.longName || e.name || e.displayname || e.displayName || "";
}
function getPeriodElem(period) {
  const els = Array.isArray(period?.elements) ? period.elements : (Array.isArray(period?.els) ? period.els : []);
  return (type) => els.find(x => Number(x?.type) === Number(type)) || null;
}
function mapLesson(l, lookup /* optional for public */) {
  const day = l.date || l.startDate || l.endDate; // yyyymmdd
  const yyyy = Math.floor(day / 10000), mm = Math.floor((day % 10000) / 100) - 1, dd = day % 100;
  const base = new Date(yyyy, mm, dd, 0, 0, 0, 0);
  const start = l.startTime ? parseUntisTime(base, l.startTime) : base;
  const end   = l.endTime   ? parseUntisTime(base, l.endTime)   : base;

  // ---------- RPC first ----------
  let subject =
    l.su?.[0]?.longname || l.su?.[0]?.longName || l.su?.[0]?.name ||
    l.subjects?.[0]?.longname || l.subjects?.[0]?.longName || l.subjects?.[0]?.name || "";
  let room =
    l.ro?.[0]?.name || l.rooms?.[0]?.name || l.ro?.[0]?.longname || l.rooms?.[0]?.longname || "";
  let teacher =
    l.te?.[0]?.name || l.teachers?.[0]?.name ||
    l.te?.[0]?.displayname || l.teachers?.[0]?.displayname ||
    l.te?.[0]?.longName || l.teachers?.[0]?.longname || "";

  // ---------- Public weekly by typed elements (no guessing) ----------
  const pe = getPeriodElem(l);
  if (lookup) {
    // Subject (type 3)
    if (!subject || GENERIC_SUBJECTS.has(normStr(subject))) {
      const e = pe(WebUntisElementType.SUBJECT);
      const ref = e && lookup.get(`${WebUntisElementType.SUBJECT}:${Number(e.id)}`);
      const lab = pickLabel(e || ref, "subject") || (ref && pickLabel(ref, "subject")) || "";
      if (lab && !GENERIC_SUBJECTS.has(normStr(lab))) subject = lab;
    }
    // Room (type 4)
    if (!room) {
      const e = pe(WebUntisElementType.ROOM);
      const ref = e && lookup.get(`${WebUntisElementType.ROOM}:${Number(e.id)}`);
      const lab = pickLabel(e || ref, "room") || (ref && pickLabel(ref, "room")) || "";
      if (lab) room = lab;
    }
    // Teacher (type 2) — prefer initials
    if (!teacher) {
      const e = pe(WebUntisElementType.TEACHER);
      const ref = e && lookup.get(`${WebUntisElementType.TEACHER}:${Number(e.id)}`);
      let lab = pickLabel(e || ref, "teacher") || (ref && pickLabel(ref, "teacher")) || "";
      if (lab) teacher = lab;
    }
  }

  // Normalize teacher to initials
  if (teacher) teacher = toInitialsFromString(teacher);

  // Conservative cancel
  const code = String(l.code || l.lstext || "").toLowerCase();
  const state = String(l.cellState || l.state || "").toLowerCase();
  const isCancelled = code.includes("cancel") || state.includes("cancel");

  return {
    id: l.id || `${day}-${l.startTime}-${subject || "unknown"}`,
    start, end,
    subject: subject || "—",
    room: room || "—",
    teacher: teacher || "",
    isCancelled
  };
}

/* ----- teacher initials for lists ----- */
function teacherLabelFromAny(te) {
  const n = te?.name || te?.displayname || te?.longName || te?.longname || "";
  return toInitialsFromString(n) || String(te?.id || "");
}
const norm = (s) => String(s || "").toLowerCase().trim();
const normInits = (s) => String(s || "").toLowerCase().replace(/[ .]/g, "").trim();

/* -------------------- PUBLIC endpoints (attach ?school=...) -------------------- */
async function preflightSchool() {
  try { await fetch(`${getBaseUrl()}/?school=${encodeURIComponent(getSchool())}`, { cache: "no-store" }); } catch {}
}
function withSchool(pathAndQuery) {
  const sep = pathAndQuery.includes("?") ? "&" : "?";
  return `${pathAndQuery}${sep}school=${encodeURIComponent(getSchool())}`;
}
async function fetchJSONPublic(pathAndQuery) {
  await preflightSchool();
  const url = `${getBaseUrl()}${withSchool(pathAndQuery)}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
function yyyymmddOf(dateStrOrDate) {
  const d = (dateStrOrDate instanceof Date) ? dateStrOrDate : new Date(dateStrOrDate);
  const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return Number(`${yyyy}${mm}${dd}`);
}

/* ---- PUBLIC weekly → robust day extract ---- */
function formatIdForElementType(elementType) {
  const t = Number(elementType);
  if (t === WebUntisElementType.TEACHER) return 3; // teachers
  if (t === WebUntisElementType.CLASS)   return 1; // classes
  if (t === WebUntisElementType.ROOM)    return 4; // rooms (future)
  return 1;
}
async function fetchPublicDay(elementType, elementId, dateStr /* YYYY-MM-DD */) {
  const target = yyyymmddOf(dateStr);
  const primary = formatIdForElementType(elementType);
  const tryIds = Array.from(new Set([primary, 1, 3, 4]));

  for (const fid of tryIds) {
    try {
      const json = await fetchJSONPublic(
        `/api/public/timetable/weekly/data?elementType=${encodeURIComponent(elementType)}&elementId=${encodeURIComponent(elementId)}&date=${encodeURIComponent(dateStr)}&formatId=${encodeURIComponent(fid)}`
      );
      const root = json?.data?.result?.data || {};
      const lookup = makeElemLookup(root);

      // 1) elementPeriods[elementId]
      const epById = root.elementPeriods?.[String(elementId)] || [];
      const todays1 = epById.filter(r => Number(r.date || r.startDate || r.endDate) === target);
      if (todays1.length) return todays1.map(r => mapLesson(r, lookup)).sort((a,b)=>a.start-b.start);

      // 2) flat periods
      const periods = Array.isArray(root.periods) ? root.periods : [];
      const todays2 = periods.filter(p => {
        const dnum = Number(p.date || p.startDate || p.endDate);
        if (dnum !== target) return false;
        const els = Array.isArray(p.elements) ? p.elements : [];
        return els.some(e => Number(e?.type) === Number(elementType) && Number(e?.id) === Number(elementId));
      });
      if (todays2.length) return todays2.map(r => mapLesson(r, lookup)).sort((a,b)=>a.start-b.start);
    } catch { /* try next */ }
  }
  return [];
}

/* -------------------- resolve / today / forDate / lists -------------------- */
async function resolveElementByName(name) {
  const client = getClient(); await client.login();
  try {
    const target = norm(name);

    // Classes
    try {
      const classes = await client.getClasses();
      const hit = classes.find(c => norm(c.name) === target || norm(c.longName) === target);
      if (hit) return { id: hit.id, type: WebUntisElementType.CLASS, label: hit.longName || hit.name };
    } catch {}

    // Teachers (by initials)
    let pairs = [];
    try {
      const teachers = await client.getTeachers();
      pairs = teachers.map(t => ({ id: t.id, label: teacherLabelFromAny(t) })).filter(p => p.id && p.label);
    } catch {}
    try {
      const pub = await fetchPublicTeachers();
      const byId = new Map(pairs.map(p => [String(p.id), p]));
      for (const p of pub) byId.set(String(p.id), { id: p.id, label: p.label });
      pairs = Array.from(byId.values());
      const seenLabel = new Set();
      pairs = pairs.filter(p => (seenLabel.has(p.label) ? false : (seenLabel.add(p.label), true)));
    } catch {}

    const tHit = pairs.find(p => normInits(p.label) === normInits(target));
    if (tHit) return { id: tHit.id, type: WebUntisElementType.TEACHER, label: tHit.label };

    throw new Error(`Fann ikki "${name}" sum flokk ella lærara.`);
  } finally { await client.logout(); }
}

async function getToday(id, type) {
  const client = getClient(); await client.login();
  try {
    try {
      const lessons = await client.getTimetableForToday(id, Number(type));
      if (Array.isArray(lessons)) return lessons.map(l => mapLesson(l)).sort((a,b) => a.start - b.start);
    } catch {}
  } finally { await client.logout(); }

  // Public fallback
  const d = new Date();
  const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  return await fetchPublicDay(type, id, `${yyyy}-${mm}-${dd}`).catch(() => []);
}

async function getForDate(id, type, dateStr /* YYYY-MM-DD */) {
  try { return await fetchPublicDay(type, id, dateStr); }
  catch { return []; }
}

async function listElements() {
  const client = getClient(); await client.login();
  try {
    let classes = [], teachers = [];

    // Classes (RPC)
    try {
      const c = await client.getClasses();
      classes = c.map(cl => ({
        id: cl.id, type: WebUntisElementType.CLASS,
        label: cl.longName || cl.name || String(cl.id)
      })).sort((a,b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    } catch {}

    // Teachers (RPC → initials) + PUBLIC fallback
    try {
      const t = await client.getTeachers();
      teachers = t.map(te => ({
        id: te.id, type: WebUntisElementType.TEACHER, label: teacherLabelFromAny(te)
      })).filter(x => x.id && x.label);
    } catch {}
    try {
      const pub = await fetchPublicTeachers();
      const byId = new Map(teachers.map(t => [String(t.id), t]));
      for (const p of pub) {
        const existing = byId.get(String(p.id));
        if (!existing || !existing.label) byId.set(String(p.id), { id: p.id, type: WebUntisElementType.TEACHER, label: p.label });
      }
      teachers = Array.from(byId.values());
      const seen = new Set();
      teachers = teachers.filter(x => (seen.has(x.label) ? false : (seen.add(x.label), true)));
    } catch {}

    teachers.sort((a,b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

    return { classes, teachers, meta: { classesAvailable: classes.length>0, teachersAvailable: teachers.length>0 } };
  } finally { await client.logout(); }
}

/* -------------------- PUBLIC: teachers list -------------------- */
async function fetchPublicTeachers() {
  const json = await fetchJSONPublic(`/api/public/timetable/weekly/pageconfig?type=2`);
  const arr = json?.data?.elements || [];
  const out = arr.map(el => ({
    id: el?.id,
    type: WebUntisElementType.TEACHER,
    label: (/^[A-ZÁÐÍÓÚÝÆØÅ]{1,5}$/.test(String(el?.name || "").trim()))
      ? String(el.name).trim()
      : toInitialsFromString(el?.name || el?.displayname || el?.longname || "")
  })).filter(x => x.id && x.label);
  const seen = new Set();
  return out.filter(x => (seen.has(x.label) ? false : (seen.add(x.label), true)))
            .sort((a,b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
}

/* -------------------- notifications -------------------- */
let notifTimers = [];
function clearTimers() { for (const t of notifTimers) clearTimeout(t); notifTimers = []; }
function scheduleAt(ts, fn) { const ms = ts - Date.now(); if (ms > 500) notifTimers.push(setTimeout(fn, ms)); }
function todayAt(h, m) { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate(), h, m, 0, 0).getTime(); }
function scheduleToasts(lessons) {
  clearTimers();
  const now = Date.now();
  const lastEndMs = Array.isArray(lessons) && lessons.length ? Math.max(...lessons.map(l => new Date(l.end).getTime())) : 0;

  const upcoming = (lessons||[]).filter(l => new Date(l.start).getTime()>now)
    .sort((a,b)=>+new Date(a.start)-+new Date(b.start))[0];
  if (upcoming) {
    const start = new Date(upcoming.start).getTime();
    scheduleAt(start - 5*60*1000, () => new Notification({
      title: "Næsti tími byrjar skjótt 🏃🏻 ",
      body: `${upcoming.subject || "Tími"} kl. ${new Date(start).toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"})}${upcoming.room ? " • " + upcoming.room : ""}`,
      silent: false
    }).show());
  }
  if (Array.isArray(lessons) && lessons.length>0) {
    const coffee = todayAt(9,20), lunch = todayAt(12,15);
    if (coffee>now && lastEndMs>=coffee) scheduleAt(coffee, ()=> new Notification({ title:"Kaffimik ☕︎", body:"20 min.", silent:false }).show());
    if (lunch>now && lastEndMs>=lunch) scheduleAt(lunch, ()=> new Notification({ title:"Døgurði 🍽", body:"30 min.", silent:false }).show());
  }
}

/* -------------------- window placement / sizing -------------------- */
function placeTopRight(targetWin) {
  if (!targetWin) return;
  const { workArea } = screen.getPrimaryDisplay();
  const b = targetWin.getBounds();
  targetWin.setBounds({ x: Math.round(workArea.x+workArea.width-b.width), y: Math.round(workArea.y), width: b.width, height: b.height });
}
function clampContentHeight(h) {
  const { workArea } = screen.getPrimaryDisplay();
  const maxH = Math.max(MIN_HEIGHT, workArea.height-20);
  return Math.max(MIN_HEIGHT, Math.min(Math.round(h), maxH));
}

/* -------------------- help window -------------------- */
function openHelpWindow() {
  if (helpWin && !helpWin.isDestroyed()) { helpWin.focus(); return; }
  helpWin = new BrowserWindow({
    width: 761, height: 961, resizable: true, minimizable: false, maximizable: false,
    modal: false, parent: null, title: "Hjálp", icon: getIconPath(),
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  const helpPath = getBundledPath("help.html");
  helpWin.loadURL(`file://${helpPath.replace(/\\/g,"/")}`);
  helpWin.setMenuBarVisibility(false);
  helpWin.on("closed", () => { helpWin = null; });
}

/* -------------------- window management -------------------- */
function createWindow() {
  const preloadPath = path.join(app.getAppPath(), "preload.cjs");
  win = new BrowserWindow({
    width: WIN_WIDTH, height: 520, useContentSize: true,
    alwaysOnTop: true, frame: false, transparent: true, resizable: false, skipTaskbar: true,
    icon: getIconPath(),
    webPreferences: {
      preload: preloadPath, contextIsolation: true, sandbox: false, nodeIntegration: false,
      webSecurity: true, spellcheck: false, backgroundThrottling: true, disableBlinkFeatures: "Geolocation",
    }
  });
  win.loadFile("renderer.html");
  win.setMenuBarVisibility(false);
  win.once("ready-to-show", () => { placeTopRight(win); });
  win.on("hide", () => {
    if (destroyTimer) clearTimeout(destroyTimer);
    destroyTimer = setTimeout(()=>{ if (win) { win.destroy(); win=null; } }, 5*60*1000);
  });
  win.on("show", () => { if (destroyTimer) { clearTimeout(destroyTimer); destroyTimer=null; } });
  if (app.isPackaged) win.webContents.on("devtools-opened", () => win.webContents.closeDevTools());
  win.on("close", (e) => { if (!app.isQuiting) { e.preventDefault(); win.hide(); } });
  return win;
}
function toggleWindow() {
  if (!win) { const w = createWindow(); w.once("ready-to-show", ()=>{ placeTopRight(w); w.show(); w.focus(); }); }
  else if (win.isVisible()) win.hide();
  else { placeTopRight(win); win.show(); win.focus(); }
}
function createTray() {
  const trayImage = nativeImage.createFromPath(getIconPath());
  tray = new Tray(trayImage);
  tray.setToolTip("Tímatalva");
  const menu = Menu.buildFromTemplate([
    { type: "separator" },
    { label: "Byrja við innritan", type: "checkbox",
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }) },
    { type: "separator" },
    { label: "Gevst", click: () => { app.isQuiting = true; app.quit(); } }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => toggleWindow());
}

/* -------------------- security -------------------- */
function hardenWebContents() {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on("web-contents-created", (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.on("will-navigate", (e, url) => { if (!url.startsWith("file://")) e.preventDefault(); });
  });
}

/* -------------------- global shortcut -------------------- */
function registerGlobalShortcut() {
  const accel = "Control+Alt+T";
  const ok = globalShortcut.register(accel, () => { toggleWindow(); });
  if (!ok) console.warn("Global shortcut registration failed:", accel);
}

/* -------------------- Deep link -------------------- */
function buildUntisUrl(elementId, elementType, dateStrOptional) {
  const d = dateStrOptional ? new Date(dateStrOptional) : new Date();
  const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,"0"), dd = String(d.getDate()).padStart(2,"0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const base = `${getBaseUrl()}/?school=${encodeURIComponent(getSchool())}`;
  return `${base}#/timetable?elementType=${encodeURIComponent(elementType)}&elementId=${encodeURIComponent(elementId)}&date=${encodeURIComponent(dateStr)}`;
}

/* -------------------- IPC -------------------- */
function setupIpc() {
  ipcMain.handle("untis:resolve", async (_e, name) => await resolveElementByName(name));
  ipcMain.handle("untis:getToday", async (_e, id, type) => await getToday(id, type));
  ipcMain.handle("untis:getForDate", async (_e, id, type, dateStr) => await getForDate(id, type, dateStr));
  ipcMain.handle("untis:listElements", async () => await listElements());
  ipcMain.on("schedule-toasts", (_e, lessons) => scheduleToasts(lessons || []));
  ipcMain.on("app:openHelp", () => openHelpWindow());
  ipcMain.on("resize-window", (_e, contentHeight) => {
    if (!win) return;
    const targetH = clampContentHeight(Number(contentHeight) || 0);
    const [, currentH] = win.getContentSize();
    if (Math.abs(targetH - currentH) < 2) return;
    win.setContentSize(WIN_WIDTH, targetH, true);
    placeTopRight(win);
  });
  ipcMain.on("open-untis-week", (_e, payload) => {
    const elementId = Number(payload?.id);
    const elementType = Number(payload?.type) || WebUntisElementType.CLASS;
    const dateStr = payload?.date || undefined;
    const url = buildUntisUrl(elementId || 0, elementType, dateStr);
    shell.openExternal(url).catch(() => {
      const base = `${getBaseUrl()}/?school=${encodeURIComponent(getSchool())}`;
      shell.openExternal(base).catch(() => {});
    });
  });
}

/* -------------------- lifecycle -------------------- */
app.whenReady().then(() => {
  if (process.platform === "win32") app.setAppUserModelId("timatalva");
  hardenWebContents();
  powerMonitor.on("resume", () => { if (win) win.webContents.send("trigger-refresh"); });
  createTray();
  setupIpc();
  registerGlobalShortcut();
  toggleWindow();
});
app.on("will-quit", () => { globalShortcut.unregisterAll(); });
app.on("before-quit", () => { app.isQuiting = true; if (destroyTimer) clearTimeout(destroyTimer); });
app.on("window-all-closed", () => {});
