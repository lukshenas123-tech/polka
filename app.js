// Полка — хранит ссылки и заметки в браузере и раскладывает их по папкам.

const STORE_KEY = "polka.items.v1";
const KEY_KEY = "polka.apikey";
const TAB_KEY = "polka.tab";

const $ = (id) => document.getElementById(id);

let items = load();
let activeTab = safeGet(TAB_KEY) || "all";
let query = "";

// ---------- хранение ----------

function safeGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
function load() {
  try {
    const data = JSON.parse(safeGet(STORE_KEY) || "[]");
    return Array.isArray(data) ? data.filter((i) => i && i.id && FOLDERS[i.folder]) : [];
  } catch {
    return [];
  }
}
function save() {
  if (!safeSet(STORE_KEY, JSON.stringify(items))) {
    toast("Не получилось сохранить: браузер запретил хранение данных");
  }
}

// ---------- добавление ----------

async function addEntry(raw, forcedFolder) {
  const text = raw.trim();
  if (!text) return;

  const url = findUrl(text);
  let folder = forcedFolder || tagFolder(text);
  let by = forcedFolder ? "manual" : folder ? "tag" : "rules";

  const apiKey = safeGet(KEY_KEY);
  if (!folder && apiKey) {
    try {
      folder = await aiClassify(text, apiKey);
      if (folder) by = "ai";
    } catch (e) {
      toast("Нейросеть недоступна, разложила по правилам");
    }
  }
  if (!folder) folder = ruleClassify(text);

  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    text,
    url: url ? url.href : null,
    title: makeTitle(text),
    folder,
    by,
    createdAt: new Date().toISOString(),
  };
  items.unshift(item);
  save();
  render(item.id);
  toast(`Положила в «${FOLDERS[folder].name}»`);
}

function moveItem(id, folder) {
  const item = items.find((i) => i.id === id);
  if (!item || item.folder === folder) return;
  item.folder = folder;
  item.by = "manual";
  save();
  render(id);
  toast(`Переложила в «${FOLDERS[folder].name}»`);
}

let lastDeleted = null;
function deleteItem(id) {
  const index = items.findIndex((i) => i.id === id);
  if (index < 0) return;
  lastDeleted = { item: items[index], index };
  items.splice(index, 1);
  save();
  render();
  toast("Запись удалена", { label: "Вернуть", action: undoDelete });
}
function undoDelete() {
  if (!lastDeleted) return;
  items.splice(lastDeleted.index, 0, lastDeleted.item);
  lastDeleted = null;
  save();
  render();
}

// ---------- отрисовка ----------

function formatDate(iso) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined) node.append(c);
  return node;
}

function matches(item) {
  if (activeTab !== "all" && item.folder !== activeTab) return false;
  if (!query) return true;
  return (item.title + " " + item.text).toLowerCase().includes(query);
}

function renderTabs() {
  const counts = { all: items.length };
  for (const k of Object.keys(FOLDERS)) counts[k] = items.filter((i) => i.folder === k).length;
  const tabs = [["all", "Все"], ...Object.entries(FOLDERS).map(([k, f]) => [k, f.name])];
  $("tabs").replaceChildren(
    ...tabs.map(([key, name]) =>
      el("button", {
        type: "button",
        class: `tab tab-${key}${activeTab === key ? " active" : ""}`,
        "aria-pressed": String(activeTab === key),
        onclick: () => { activeTab = key; safeSet(TAB_KEY, key); render(); },
      }, el("span", { class: "dot" }), name, el("span", { class: "count" }, String(counts[key])))
    )
  );
  const n = items.length;
  $("total").textContent = n ? `${n} ${plural(n, "запись", "записи", "записей")}` : "";
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function trashIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

function card(item, fresh) {
  const url = item.url ? new URL(item.url) : null;
  const tg = telegramLabel(url);
  const source = tg && tg !== item.title ? tg : url ? hostOf(url) : "заметка";
  const body = item.text
    .replace(URL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  const showBody = body && body !== item.title;

  const titleNode = item.url
    ? el("a", { href: item.url, target: "_blank", rel: "noopener" }, item.title)
    : document.createTextNode(item.title);

  const moves = Object.entries(FOLDERS).map(([key, f]) =>
    el("button", {
      type: "button",
      class: `chip chip-${key}${item.folder === key ? " current" : ""}`,
      "aria-pressed": String(item.folder === key),
      title: item.folder === key ? "Сейчас здесь" : `Переложить в «${f.name}»`,
      onclick: () => moveItem(item.id, key),
    }, f.name)
  );

  return el("li", { class: `card in-${item.folder}${fresh ? " fresh" : ""}`, "data-id": item.id },
    el("div", { class: "card-main" },
      el("h3", { class: "card-title" }, titleNode),
      showBody ? el("p", { class: "card-text" }, body.length > 220 ? body.slice(0, 219) + "…" : body) : null,
      el("p", { class: "meta" },
        el("span", {}, source),
        el("span", {}, formatDate(item.createdAt)),
        item.by === "ai" ? el("span", {}, "разложила нейросеть") : null,
      ),
    ),
    el("div", { class: "card-actions" },
      el("div", { class: "chips", role: "group", "aria-label": "Папка" }, ...moves),
      el("button", { type: "button", class: "ghost delete", onclick: () => deleteItem(item.id), "aria-label": "Удалить запись", title: "Удалить" }, trashIcon()),
    ),
  );
}

function render(freshId) {
  renderTabs();
  const visible = items.filter(matches);
  $("list").replaceChildren(...visible.map((i) => card(i, i.id === freshId)));
  $("empty").hidden = items.length > 0;
  $("search").parentElement.hidden = items.length < 4;
  if (items.length > 0 && visible.length === 0) {
    $("list").append(el("li", { class: "nothing" },
      query ? "Ничего не нашлось." : `В папке «${FOLDERS[activeTab].name}» пока пусто.`));
  }
}

// ---------- уведомления ----------

let toastTimer;
function toast(text, action) {
  const t = $("toast");
  t.replaceChildren(text);
  if (action) {
    t.append(el("button", { type: "button", onclick: () => { action.action(); t.classList.remove("show"); } }, action.label));
  }
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), action ? 5000 : 2200);
}

// ---------- экспорт / импорт ----------

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "polka", version: 1, items }, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `polka-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.items || []).filter((i) => i && i.id && FOLDERS[i.folder]);
    const known = new Set(items.map((i) => i.id));
    const fresh = incoming.filter((i) => !known.has(i.id));
    items = [...fresh, ...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    save();
    render();
    toast(fresh.length ? `Добавлено записей: ${fresh.length}` : "Все записи из файла уже есть на полке");
  } catch {
    toast("Это не похоже на файл копии Полки");
  }
}

// ---------- «Поделиться» с телефона ----------

function takeShared() {
  const p = new URLSearchParams(location.search);
  const parts = [p.get("title"), p.get("text"), p.get("url")].filter(Boolean);
  if (!parts.length) return;
  // Telegram часто кладёт ссылку и в text, и в url — убираем повтор
  const unique = parts.filter((v, i) => !parts.slice(0, i).some((prev) => prev.includes(v)));
  history.replaceState(null, "", location.pathname);
  addEntry(unique.join("\n"));
}

// ---------- запуск ----------

function init() {
  $("quick").replaceChildren(
    ...Object.entries(FOLDERS).map(([key, f]) =>
      el("button", {
        type: "button",
        class: `chip chip-${key}`,
        onclick: async () => {
          const v = $("input").value;
          if (!v.trim()) { $("input").focus(); return; }
          $("input").value = "";
          await addEntry(v, key);
        },
      }, f.name)
    )
  );

  $("inbox").addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = $("input").value;
    if (!v.trim()) { $("input").focus(); return; }
    $("add").disabled = true;
    $("input").value = "";
    try { await addEntry(v); } finally { $("add").disabled = false; }
  });

  // Enter — разложить, Shift+Enter — новая строка
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $("inbox").requestSubmit();
    }
  });

  $("search").addEventListener("input", (e) => { query = e.target.value.trim().toLowerCase(); render(); });

  $("apikey").value = safeGet(KEY_KEY) || "";
  $("apikey").addEventListener("change", (e) => {
    const v = e.target.value.trim();
    if (v) safeSet(KEY_KEY, v); else try { localStorage.removeItem(KEY_KEY); } catch {}
    toast(v ? "Ключ сохранён" : "Ключ удалён");
  });

  $("export").addEventListener("click", exportData);
  $("import").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importData(f);
    e.target.value = "";
  });

  if (!FOLDERS[activeTab] && activeTab !== "all") activeTab = "all";
  render();
  takeShared();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
