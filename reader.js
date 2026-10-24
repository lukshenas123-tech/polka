// Чтение страницы по ссылке: заголовок, текст, источник, картинка.
// Браузер не может сам скачать чужую страницу (ограничение CORS), поэтому
// идём через «читалку»: сначала свою (api/read.js на Vercel), потом публичные.

const READERS = [
  { name: "own", url: (u) => `api/read?url=${encodeURIComponent(u)}` },
  { name: "allorigins", url: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
  { name: "codetabs", url: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}` },
];
const deadReaders = new Set(); // не отвечающие в этой сессии — пропускаем

async function fetchText(url, ms = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(url) {
  for (const r of READERS) {
    if (deadReaders.has(r.name)) continue;
    try {
      const html = await fetchText(r.url(url));
      if (html && html.length > 100 && html.includes("<")) return html;
    } catch (e) {
      if (r.name === "own") deadReaders.add(r.name); // своей читалки нет (например, GitHub Pages)
    }
  }
  return null;
}

// Ссылка на пост в Telegram → обычный адрес поста (у него есть описание с текстом)
function telegramPostUrl(url) {
  if (!url || !/^(t\.me|telegram\.me)$/.test(hostOf(url))) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "s") parts.shift();
  if (parts[0] === "c" || parts.length < 2 || !/^\d+$/.test(parts[1])) return null; // приватный канал или не пост
  return { channel: parts[0], post: parts[1], url: `https://t.me/${parts[0]}/${parts[1]}` };
}

function meta(doc, ...names) {
  for (const n of names) {
    const el = doc.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
    const v = el && el.getAttribute("content");
    if (v && v.trim()) return v.trim();
  }
  return "";
}

// Возвращает { title, text, source, image } или null, если прочитать не удалось
async function readLink(url) {
  const tg = telegramPostUrl(url);
  const html = await fetchPage(tg ? tg.url : url.href);
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, "text/html");
  const ogTitle = meta(doc, "og:title", "twitter:title");
  const ogText = meta(doc, "og:description", "twitter:description", "description");
  const image = meta(doc, "og:image", "twitter:image");

  if (tg) {
    // У Telegram og:title — название канала, og:description — текст поста.
    // Если поста нет, там стандартная фраза про канал.
    const generic = /^You can (view and join|contact)|right away\.?$/i.test(ogText);
    return {
      source: ogTitle || "@" + tg.channel,
      title: "",
      text: generic ? "" : ogText,
      image: image && !/telegram\.org\/img\/t_logo/.test(image) ? image : "",
    };
  }

  const siteName = meta(doc, "og:site_name", "application-name");
  const pageTitle = (doc.querySelector("title")?.textContent || "").trim();
  return {
    source: siteName || hostOf(url),
    title: ogTitle || pageTitle,
    text: ogText,
    image,
  };
}
