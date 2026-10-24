// Полка — хранит ссылки и заметки в браузере, сама читает посты по ссылке
// и раскладывает их по папкам. Если не уверена — спрашивает.

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
    if (!Array.isArray(data)) return [];
    return data
      .filter((i) => i && i.id && (i.folder === null || FOLDERS[i.folder]))
      .map((i) => ({ input: i.text, ...i })); // записи старой версии
  } catch {
    return [];
  }
}
function save() {
  if (!safeSet(STORE_KEY, JSON.stringify(items))) {
    toast("Не получилось сохранить: браузер запретил хранение данных");
  }
}

// Память: куда пользователь сам клал записи из каждого канала/сайта
function buildMemory() {
  const memory = {};
  for (const i of items) {
    if (!i.folder || !i.sourceKey || !["manual", "asked"].includes(i.by)) continue;
    memory[i.sourceKey] ??= { study: 0, posts: 0, ideas: 0 };
    memory[i.sourceKey][i.folder] += 1;
  }
  return memory;
}

// ---------- добавление ----------

// Несколько ссылок, каждая с новой строки, — это несколько записей
function splitInput(raw) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1 && lines.every((l) => findUrl(l))) return lines;
  return [raw.trim()];
}

function addInput(raw, forcedFolder) {
  const parts = splitInput(raw).filter(Boolean);
  const created = parts.map((text) => {
    const url = findUrl(text);
    const item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      input: text,
      url: url ? url.href : null,
      sourceKey: sourceKeyOf(url),
      title: makeTitle(text),
      text: "",
      source: "",
      image: "",
      folder: forcedFolder || null,
      by: forcedFolder ? "manual" : null,
      status: url ? "reading" : "ready",
      createdAt: new Date().toISOString(),
    };
    items.unshift(item);
    return item;
  });
  save();
  render();
  created.forEach((item) => enqueue(item.id));
  if (created.length > 1) toast(`Добавлено записей: ${created.length}`);
}

// Обрабатываем по одной, чтобы не заваливать читалку запросами
let chain = Promise.resolve();
function enqueue(id) {
  chain = chain.then(() => processItem(id)).catch(() => {});
}

async function processItem(id) {
  let item = items.find((i) => i.id === id);
  if (!item) return;

  if (item.url && item.status === "reading") {
    let info = null;
    try { info = await readLink(new URL(item.url)); } catch {}
    item = items.find((i) => i.id === id); // запись могли удалить, пока читали
    if (!item) return;
    if (info) {
      item.source = info.source || "";
      item.text = info.text || "";
      item.image = info.image || "";
      const fromPage = makeTitle(info.title || info.text || "");
      const own = makeTitle(item.input);
      const inputHasText = item.input.replace(URL_RE, "").trim().length > 0;
      item.title = inputHasText ? own : fromPage !== "Без названия" ? fromPage : own;
      item.readFailed = !info.text && !info.title;
    } else {
      item.readFailed = true;
    }
    item.status = "ready";
  }

  if (!item.folder) {
    const all = [item.input, item.source, item.title, item.text].filter(Boolean).join("\n");
    let verdict = scoreEntry({ text: all, url: item.url ? new URL(item.url) : null }, buildMemory());

    const apiKey = safeGet(KEY_KEY);
    if (apiKey && !tagFolder(all) && !verdict.fromMemory) {
      try {
        verdict = await aiClassify(all, apiKey);
        item.byAi = true;
      } catch {
        // без нейросети — остаёмся на правилах
      }
    }

    if (verdict.sure && verdict.folder) {
      item.folder = verdict.folder;
      item.by = item.byAi ? "ai" : "auto";
      toast(`Положила в «${FOLDERS[item.folder].name}»`);
    } else {
      item.guess = verdict.folder || null;
      item.by = null;
    }
  }

  save();
  render(item.id);
}

function moveItem(id, folder, asked) {
  const item = items.find((i) => i.id === id);
  if (!item || item.folder === folder) return;
  item.folder = folder;
  item.by = asked ? "asked" : "manual";
  delete item.guess;
  save();

  // Если есть другие нерешённые записи из того же канала — разложим их так же
  let more = 0;
  if (item.sourceKey) {
    const memory = buildMemory();
    for (const other of items) {
      if (other.folder || other.status !== "ready" || other.sourceKey !== item.sourceKey) continue;
      const all = [other.input, other.source, other.title, other.text].join("\n");
      const v = scoreEntry({ text: all, url: other.url ? new URL(other.url) : null }, memory);
      if (v.sure && v.folder) { other.folder = v.folder; other.by = "auto"; more++; }
    }
    if (more) save();
  }

  render(id);
  const tail = more ? ` и ещё ${more} из этого же источника` : "";
  toast(`Положила в «${FOLDERS[folder].name}»${tail}. Запомню на будущее`);
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
  const sameDay = d.toDateString() === new Date().toDateString();
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
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
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

function bodyText(item) {
  const own = item.input.replace(URL_RE, " ").replace(/#[\p{L}\d_]+/gu, " ").replace(/\s+/g, " ").trim();
  const read = (item.text || "").replace(/\s+/g, " ").trim();
  const body = [own, read].filter((t) => t && t !== item.title).join(" — ");
  return body.length > 260 ? body.slice(0, 259) + "…" : body;
}

function sourceLabel(item) {
  const url = item.url ? new URL(item.url) : null;
  const tg = telegramLabel(url);
  if (tg && item.source && !item.source.startsWith("@")) return `${item.source} · ${tg}`;
  if (tg) return tg;
  if (url) return item.source || hostOf(url);
  return "заметка";
}

function folderButtons(item, asked) {
  return Object.entries(FOLDERS).map(([key, f]) => {
    const current = item.folder === key;
    const guess = !item.folder && item.guess === key;
    return el("button", {
      type: "button",
      class: `chip chip-${key}${current ? " current" : ""}${guess ? " guess" : ""}`,
      "aria-pressed": String(current),
      title: current ? "Сейчас здесь" : `Положить в «${f.name}»`,
      onclick: () => moveItem(item.id, key, asked),
    }, f.name);
  });
}

function thumb(item) {
  if (!item.image) return null;
  const img = el("img", { class: "thumb", src: item.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" });
  img.addEventListener("error", () => img.remove());
  return img;
}

function titleNode(item) {
  return item.url
    ? el("a", { href: item.url, target: "_blank", rel: "noopener" }, item.title)
    : document.createTextNode(item.title);
}

function card(item, fresh) {
  const body = bodyText(item);
  return el("li", { class: `card in-${item.folder}${fresh ? " fresh" : ""}`, "data-id": item.id },
    el("div", { class: "card-head" },
      el("div", { class: "card-main" },
        el("h3", { class: "card-title" }, titleNode(item)),
        body ? el("p", { class: "card-text" }, body) : null,
        el("p", { class: "meta" },
          el("span", {}, sourceLabel(item)),
          el("span", {}, formatDate(item.createdAt)),
          item.by === "ai" ? el("span", {}, "разложила нейросеть") : null,
        ),
      ),
      thumb(item),
    ),
    el("div", { class: "card-actions" },
      el("div", { class: "chips", role: "group", "aria-label": "Папка" }, ...folderButtons(item, false)),
      el("button", { type: "button", class: "ghost delete", onclick: () => deleteItem(item.id), "aria-label": "Удалить запись", title: "Удалить" }, trashIcon()),
    ),
  );
}

function readingCard(item) {
  return el("li", { class: "card reading", "data-id": item.id },
    el("div", { class: "card-main" },
      el("p", { class: "reading-label" }, el("span", { class: "spinner", "aria-hidden": "true" }), "Читаю…"),
      el("h3", { class: "card-title" }, titleNode(item)),
    ),
  );
}

function askCard(item, fresh) {
  const body = bodyText(item);
  const why = item.readFailed
    ? "Не получилось открыть ссылку, поэтому не понимаю, что там."
    : item.guess
      ? `Похоже на «${FOLDERS[item.guess].name}», но не уверена.`
      : "Не понимаю, к какой папке это отнести.";
  return el("li", { class: `card ask${fresh ? " fresh" : ""}`, "data-id": item.id },
    el("div", { class: "card-head" },
      el("div", { class: "card-main" },
        el("h3", { class: "card-title" }, titleNode(item)),
        body ? el("p", { class: "card-text" }, body) : null,
        el("p", { class: "meta" }, el("span", {}, sourceLabel(item)), el("span", {}, formatDate(item.createdAt))),
      ),
      thumb(item),
    ),
    el("p", { class: "question" }, el("strong", {}, "Куда положить? "), why),
    el("div", { class: "card-actions" },
      el("div", { class: "chips", role: "group", "aria-label": "Выберите папку" }, ...folderButtons(item, true)),
      el("button", { type: "button", class: "ghost delete", onclick: () => deleteItem(item.id), "aria-label": "Удалить запись", title: "Удалить" }, trashIcon()),
    ),
  );
}

function renderTabs() {
  const sorted = items.filter((i) => i.folder);
  const counts = { all: sorted.length };
  for (const k of Object.keys(FOLDERS)) counts[k] = sorted.filter((i) => i.folder === k).length;
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

function matches(item) {
  if (activeTab !== "all" && item.folder !== activeTab) return false;
  if (!query) return true;
  return [item.title, item.input, item.text, item.source].join(" ").toLowerCase().includes(query);
}

function render(freshId) {
  renderTabs();

  const pending = items.filter((i) => !i.folder);
  const reading = pending.filter((i) => i.status === "reading");
  const asking = pending.filter((i) => i.status !== "reading");
  $("pending").hidden = pending.length === 0;
  $("pending-title").textContent = asking.length
    ? `Нужно решить · ${asking.length}`
    : "Читаю ссылки…";
  $("pending-list").replaceChildren(
    ...reading.map(readingCard),
    ...asking.map((i) => askCard(i, i.id === freshId)),
  );

  const visible = items.filter((i) => i.folder && matches(i));
  $("list").replaceChildren(...visible.map((i) => card(i, i.id === freshId)));
  $("empty").hidden = items.length > 0;
  $("search").parentElement.hidden = items.filter((i) => i.folder).length < 4;
  if (items.some((i) => i.folder) && visible.length === 0) {
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
  toastTimer = setTimeout(() => t.classList.remove("show"), action ? 5000 : 2600);
}

// ---------- экспорт / импорт ----------

function exportData() {
  const blob = new Blob([JSON.stringify({ app: "polka", version: 2, items }, null, 2)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `polka-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    const incoming = (Array.isArray(data) ? data : data.items || [])
      .filter((i) => i && i.id && (i.folder === null || FOLDERS[i.folder]))
      .map((i) => ({ input: i.text, ...i, status: i.status === "reading" ? "reading" : "ready" }));
    const known = new Set(items.map((i) => i.id));
    const fresh = incoming.filter((i) => !known.has(i.id));
    items = [...fresh, ...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    save();
    render();
    fresh.filter((i) => i.status === "reading").forEach((i) => enqueue(i.id));
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
  addInput(unique.join("\n"));
}

// ---------- запуск ----------

function submitInput(forcedFolder) {
  const v = $("input").value;
  if (!v.trim()) { $("input").focus(); return; }
  $("input").value = "";
  addInput(v, forcedFolder);
}

function init() {
  $("quick").replaceChildren(
    ...Object.entries(FOLDERS).map(([key, f]) =>
      el("button", { type: "button", class: `chip chip-${key}`, onclick: () => submitInput(key) }, f.name)
    )
  );

  $("inbox").addEventListener("submit", (e) => { e.preventDefault(); submitInput(); });

  // Enter — разложить, Shift+Enter — новая строка
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submitInput();
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

  // Записи, которые не успели прочитаться в прошлый раз
  items.filter((i) => i.status === "reading").forEach((i) => enqueue(i.id));
  takeShared();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();
