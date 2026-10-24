// Определение папки для записи: по хэштегам, сайту и ключевым словам.
// Если в настройках указан ключ Claude API — папку выбирает нейросеть.

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

const KEYWORDS = {
  study: ["курс", "лекци", "урок", "учеб", "учёб", "экзамен", "конспект", "задач", "домашк",
          "семинар", "книг", "статья", "туториал", "tutorial", "гайд", "документаци", "learn",
          "course", "lecture", "разбор", "как работает", "шпаргалк", "вебинар", "пример кода",
          "алгоритм", "формул", "теори", "изучить", "выучить", "почитать по теме"],
  ideas: ["иде", "мысль", "мысли", "придумал", "а что если", "можно сделать", "хочу", "план",
          "todo", "заметка", "надо бы", "попробовать", "стартап", "проект", "сделать бы",
          "не забыть", "напомни", "мечта", "цель"],
  posts: ["пост", "канал", "подпис", "репост", "мем", "новост", "тред", "интервью", "обзор",
          "смешн", "история", "реклам", "розыгрыш"],
};

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

// Ссылка на пост в Telegram → «@канал · пост 123»
function telegramLabel(url) {
  if (!url || !siteMatches(hostOf(url), ["t.me", "telegram.me"])) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "s" || parts[0] === "c") parts.shift();
  if (!parts.length) return null;
  const channel = parts[0];
  const post = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
  return post ? `@${channel} · пост ${post}` : `@${channel}`;
}

function tagFolder(text) {
  const low = text.toLowerCase();
  for (const [key, f] of Object.entries(FOLDERS)) {
    if (f.tags.some((t) => new RegExp(t + "(?![\\p{L}\\d_])", "u").test(low))) return key;
  }
  return null;
}

function ruleClassify(text) {
  const tagged = tagFolder(text);
  if (tagged) return tagged;

  const url = findUrl(text);
  const host = hostOf(url);
  const low = text.toLowerCase();
  const score = { study: 0, posts: 0, ideas: 0 };

  if (host && siteMatches(host, STUDY_SITES)) score.study += 3;
  if (host && siteMatches(host, POST_SITES)) score.posts += 2;
  if (host && /(^|\.)(docs|learn|developer|wiki)\./.test(host + ".")) score.study += 2;
  if (/\.pdf($|\?)/i.test(url ? url.pathname : "")) score.study += 2;

  for (const [key, words] of Object.entries(KEYWORDS)) {
    for (const w of words) if (low.includes(w)) score[key] += 1;
  }
  // Свой текст без ссылки чаще всего — мысль или заметка
  if (!url) score.ideas += 1;

  const best = Object.entries(score).sort((a, b) => b[1] - a[1])[0];
  if (best[1] > 0) return best[0];
  return url ? "posts" : "ideas";
}

// Короткое название для карточки
function makeTitle(text) {
  const url = findUrl(text);
  const tg = telegramLabel(url);
  const firstLine = text
    .split("\n")
    .map((l) => l.replace(URL_RE, "").replace(/#[\p{L}\d_]+/gu, "").trim())
    .find((l) => l.length > 0);
  if (firstLine) return firstLine.length > 80 ? firstLine.slice(0, 79) + "…" : firstLine;
  if (tg) return tg;
  if (url) return hostOf(url) + (url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : "");
  return "Без названия";
}

// Классификация нейросетью. Возвращает null, если не получилось.
async function aiClassify(text, apiKey) {
  const prompt = `Разложи сохранённую запись по одной из трёх папок:
- study — учеба: материалы для изучения, курсы, лекции, статьи, туториалы, конспекты, книги, справочная информация.
- posts — посты: интересные посты из каналов и соцсетей, новости, мемы, чужой контент «почитать/посмотреть».
- ideas — идеи: собственные мысли, заметки, планы, задумки проектов, напоминания себе.

Если дана только ссылка на Telegram-пост, ориентируйся на название канала.

Запись:
<entry>
${text.slice(0, 3000)}
</entry>

Ответь одним словом: study, posts или ideas.`;

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
      max_tokens: 5,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ответил ${res.status}`);
  const data = await res.json();
  const answer = (data.content?.[0]?.text || "").toLowerCase();
  return Object.keys(FOLDERS).find((k) => answer.includes(k)) || null;
}

if (typeof module !== "undefined") {
  module.exports = { FOLDERS, ruleClassify, makeTitle, findUrl, telegramLabel, tagFolder, hostOf };
}
