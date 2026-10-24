// Выбор папки для записи и уверенность в этом выборе.
// Если уверенности нет — Полка спрашивает пользователя и запоминает ответ
// для этого канала или сайта.

const FOLDERS = {
  study: { name: "Учеба", tags: ["#учеба", "#учёба"] },
  posts: { name: "Посты", tags: ["#посты", "#пост"] },
  ideas: { name: "Идеи",  tags: ["#идеи", "#идея"] },
};

// Сайты, по которым сразу понятна папка
const STUDY_SITES = [
  "coursera.org", "stepik.org", "udemy.com", "edx.org", "khanacademy.org", "skillbox.ru",
  "practicum.yandex.ru", "netology.ru", "habr.com", "wikipedia.org", "arxiv.org",
  "stackoverflow.com", "github.com", "medium.com", "developer.mozilla.org", "w3schools.com",
  "leetcode.com", "codewars.com", "postnauka.ru", "arzamas.academy", "notion.so",
];
const POST_SITES = [
  "t.me", "telegram.me", "vk.com", "instagram.com", "x.com", "twitter.com", "threads.net",
  "reddit.com", "vc.ru", "dzen.ru", "pikabu.ru", "tiktok.com", "facebook.com", "linkedin.com",
];

// Начала слов (ищутся с начала слова, чтобы «иде» не находилось в «видео»)
const KEYWORDS = {
  study: ["курс", "лекци", "урок", "учеб", "учёб", "обучени", "экзамен", "егэ", "огэ", "сесси",
          "конспект", "задач", "домашк", "семинар", "книг", "стать", "туториал", "гайд",
          "руководств", "документаци", "инструкци", "шпаргалк", "вебинар", "алгоритм", "формул",
          "теори", "изучи", "выучи", "научи", "навык", "разбор", "объясн", "как работает",
          "пример", "программир", "python", "javascript", "sql", "excel", "математ", "физик",
          "грамматик", "исследовани", "learn", "course", "tutorial", "guide", "lecture", "how to",
          "чек-лист", "чеклист", "конспект", "методич", "полезные материал", "подборка ресурс"],
  ideas: ["иде", "мысл", "придумал", "а что если", "можно сделать", "хочу", "план", "todo",
          "заметк", "надо бы", "попробовать", "стартап", "проект", "сделать бы", "не забыть",
          "напомн", "мечт", "цел", "бизнес", "вдохнов", "концепт"],
  posts: ["пост", "канал", "подпис", "репост", "мем", "новост", "тред", "интервью", "обзор",
          "смешн", "юмор", "реклам", "розыгрыш", "заявил", "сообщил", "срочно", "трейлер",
          "релиз", "анонс", "вышел", "вышла", "слух", "скандал", "прикол", "история о"],
};

const KEYWORD_RES = Object.fromEntries(
  Object.entries(KEYWORDS).map(([k, words]) => [
    k,
    words.map((w) => new RegExp("(?<![\\p{L}\\d])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu")),
  ])
);

const URL_RE = /https?:\/\/[^\s<>"']+|(?:^|\s)((?:t\.me|telegram\.me)\/[^\s<>"']+)/i;

function findUrl(text) {
  const m = text.match(URL_RE);
  if (!m) return null;
  let raw = (m[1] || m[0]).trim().replace(/[).,!?;:»]+$/, "");
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
  try { return new URL(raw); } catch { return null; }
}

function hostOf(url) {
  return url ? url.hostname.replace(/^www\.|^m\./, "") : "";
}

function siteMatches(host, list) {
  return list.some((s) => host === s || host.endsWith("." + s));
}

// Ссылка на Telegram → «@канал · пост 123»
function telegramLabel(url) {
  if (!url || !siteMatches(hostOf(url), ["t.me", "telegram.me"])) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "s" || parts[0] === "c") parts.shift();
  if (!parts.length) return null;
  const post = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
  return post ? `@${parts[0]} · пост ${post}` : `@${parts[0]}`;
}

// Ключ источника для памяти: канал Telegram или домен сайта
function sourceKeyOf(url) {
  if (!url) return "";
  const host = hostOf(url);
  if (siteMatches(host, ["t.me", "telegram.me"])) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "s") parts.shift();
    return parts[0] ? "tg:" + parts[0].toLowerCase() : "";
  }
  return host;
}

function tagFolder(text) {
  const low = text.toLowerCase();
  for (const [key, f] of Object.entries(FOLDERS)) {
    if (f.tags.some((t) => new RegExp(t + "(?![\\p{L}\\d_])", "u").test(low))) return key;
  }
  return null;
}

/**
 * Оценивает запись.
 * entry: { text — всё, что известно (ввод + прочитанный текст), url, hasOwnText }
 * memory: { [sourceKey]: { study: n, posts: n, ideas: n } } — прошлые решения пользователя
 * Возвращает { folder, sure, fromMemory }
 */
function scoreEntry(entry, memory = {}) {
  const tagged = tagFolder(entry.text);
  if (tagged) return { folder: tagged, sure: true };

  const url = entry.url;
  const host = hostOf(url);
  const score = { study: 0, posts: 0, ideas: 0 };

  // Прошлые решения для этого канала/сайта — самый сильный сигнал
  const past = memory[sourceKeyOf(url)];
  let fromMemory = false;
  if (past) {
    const [fav, n] = Object.entries(past).sort((a, b) => b[1] - a[1])[0];
    const total = Object.values(past).reduce((a, b) => a + b, 0);
    if (n / total >= 0.6) { score[fav] += 4; fromMemory = true; }
  }

  if (host && siteMatches(host, STUDY_SITES)) score.study += 3;
  if (host && siteMatches(host, POST_SITES)) score.posts += 1;
  if (host && /(^|\.)(docs|learn|developer|wiki)\./.test(host + ".")) score.study += 2;
  if (url && /\.pdf($|\?)/i.test(url.pathname)) score.study += 2;
  if (!url) score.ideas += 2; // свой текст без ссылки — обычно мысль

  for (const [key, res] of Object.entries(KEYWORD_RES)) {
    for (const re of res) if (re.test(entry.text)) score[key] += 1;
  }

  const [[best, b], [, second]] = Object.entries(score).sort((x, y) => y[1] - x[1]);
  const sure = (b >= 2 && b - second >= 2) || (b >= 4 && b - second >= 1);
  return { folder: b > 0 ? best : null, sure, fromMemory: fromMemory && sure };
}

// Короткое название для карточки
function makeTitle(text) {
  const firstLine = text
    .split("\n")
    .map((l) => l.replace(URL_RE, "").replace(/#[\p{L}\d_]+/gu, "").trim())
    .find((l) => l.length > 0);
  if (firstLine) return firstLine.length > 90 ? firstLine.slice(0, 89) + "…" : firstLine;
  const url = findUrl(text);
  const tg = telegramLabel(url);
  if (tg) return tg;
  if (url) return hostOf(url) + (url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : "");
  return "Без названия";
}

// Классификация нейросетью. Возвращает { folder, sure } или бросает ошибку.
async function aiClassify(text, apiKey) {
  const prompt = `Разложи сохранённую запись по одной из трёх папок:
- study — учеба: материалы для изучения, курсы, лекции, статьи, туториалы, конспекты, книги, справочная информация.
- posts — посты: интересные посты из каналов и соцсетей, новости, мемы, чужой контент «почитать/посмотреть».
- ideas — идеи: собственные мысли, заметки, планы, задумки проектов, напоминания себе.

Запись:
<entry>
${text.slice(0, 3000)}
</entry>

Ответь только JSON: {"folder": "study" | "posts" | "ideas", "sure": true | false}.
"sure": false, если по записи трудно понять, куда её положить.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-5-5",
      max_tokens: 40,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ответил ${res.status}`);
  const data = await res.json();
  const raw = data.content?.[0]?.text || "";
  const json = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
  if (!FOLDERS[json.folder]) throw new Error("непонятный ответ");
  return { folder: json.folder, sure: json.sure !== false };
}

if (typeof module !== "undefined") {
  module.exports = { FOLDERS, scoreEntry, makeTitle, findUrl, telegramLabel, tagFolder, hostOf, sourceKeyOf };
}
