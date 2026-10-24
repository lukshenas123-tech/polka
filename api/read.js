// Читалка для Vercel: скачивает страницу по ссылке и отдаёт её HTML сайту Полки.
// Адрес: /api/read?url=https://t.me/channel/123

const MAX_BYTES = 1_500_000;

function isAllowed(target) {
  let u;
  try { u = new URL(target); } catch { return false; }
  if (!["http:", "https:"].includes(u.protocol)) return false;
  if (u.port && !["80", "443"].includes(u.port)) return false;
  const h = u.hostname.toLowerCase();
  // не пускаем во внутренние адреса
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^(\d+\.){3}\d+$/.test(h) || h.includes(":")) return false; // IP-адреса вместо домена
  return true;
}

module.exports = async (req, res) => {
  const target = (req.query && req.query.url) || "";
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (!isAllowed(target)) {
    res.status(400).send("bad url");
    return;
  }

  try {
    const r = await fetch(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; PolkaReader/1.0)",
        "accept-language": "ru,en;q=0.8",
        accept: "text/html,application/xhtml+xml",
      },
    });
    const html = (await r.text()).slice(0, MAX_BYTES);
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=3600");
    res.status(r.ok ? 200 : 502).send(html);
  } catch (e) {
    res.status(504).send("timeout");
  }
};
