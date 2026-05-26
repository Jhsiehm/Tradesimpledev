/**
 * Honest social / public-figure pulse — curated links plus optional RSS (no fabricated tweets).
 */

const RSS_FETCH_MS = Number(process.env.SOCIAL_RSS_FETCH_MS || 8000);
const RSS_CACHE_TTL_MS = Number(process.env.SOCIAL_RSS_CACHE_TTL_MS || 5 * 60_000);

let rssCache = { url: "", items: [], fetchedAt: 0, error: null };

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .trim();
}

function firstTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1]) : "";
}

function parseRssItems(xml) {
  const body = String(xml || "");
  const blocks = body.match(/<item[\s\S]*?<\/item>/gi) || body.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const block of blocks.slice(0, 12)) {
    const title = firstTag(block, "title");
    const link =
      (block.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] ||
      firstTag(block, "link");
    const pubDate = firstTag(block, "pubDate") || firstTag(block, "updated") || firstTag(block, "published");
    if (!title && !link) continue;
    out.push({
      id: `rss_${out.length}_${link || title}`.slice(0, 80),
      title: title || "Feed item",
      summary: title,
      url: link || null,
      publishedAt: pubDate ? String(pubDate).slice(0, 28) : null,
      badge: "Live feed",
      modeled: false
    });
  }
  return out;
}

async function fetchRssFeed(url) {
  const now = Date.now();
  if (rssCache.url === url && now - rssCache.fetchedAt < RSS_CACHE_TTL_MS) {
    return rssCache;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RSS_FETCH_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" }
    });
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRssItems(xml);
    rssCache = { url, items, fetchedAt: now, error: null };
    return rssCache;
  } catch (err) {
    rssCache = { url, items: [], fetchedAt: now, error: err.message || String(err) };
    return rssCache;
  } finally {
    clearTimeout(timer);
  }
}

function curatedFigureItems(figureLinks, symbols) {
  const symSet = new Set((symbols || []).map((s) => String(s).toUpperCase()));
  return (figureLinks || [])
    .filter((figure) => !(symbols || []).length || (figure.symbols || []).some((s) => symSet.has(String(s).toUpperCase())))
    .map((figure) => ({
      id: `figure_${slugFigure(figure.name)}`,
      title: figure.name,
      summary: figure.label || `${figure.name} — curated policy appearance`,
      url: figure.url || null,
      publishedAt: figure.date || null,
      symbols: figure.symbols || [],
      badge: "Curated",
      modeled: true,
      source: "Curated public figure map"
    }));
}

function slugFigure(name) {
  return String(name || "figure")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40);
}

/**
 * @param {{ symbols?: string[], figureLinks?: object[], includeRss?: boolean }} opts
 */
export async function getSocialPulse(opts = {}) {
  const symbols = (opts.symbols || []).map((s) => String(s).toUpperCase()).filter(Boolean);
  const figureLinks = opts.figureLinks || [];
  const curated = curatedFigureItems(figureLinks, symbols);
  const rssUrl = String(process.env.SOCIAL_RSS_URL || "").trim();
  const includeRss = opts.includeRss !== false;

  let liveItems = [];
  let liveStatus = "stub";
  let liveError = null;

  if (includeRss && rssUrl) {
    const feed = await fetchRssFeed(rssUrl);
    liveItems = feed.items || [];
    liveStatus = liveItems.length ? "live_feed" : feed.error ? "unavailable" : "empty";
    liveError = feed.error;
  }

  const modeledStub =
    !rssUrl && includeRss
      ? [
          {
            id: "social_api_stub",
            title: "Live social API not configured",
            summary:
              "Set SOCIAL_RSS_URL to an RSS/Atom feed you control, or integrate a licensed social API server-side. TradeSimple does not fabricate tweets.",
            url: null,
            publishedAt: null,
            badge: "Modeled",
            modeled: true,
            source: "TradeSimple stub"
          }
        ]
      : [];

  const items = [
    ...curated.slice(0, 8),
    ...liveItems.slice(0, 6),
    ...(liveItems.length || rssUrl ? [] : modeledStub)
  ];

  const primaryBadge = liveItems.length
    ? "Live feed"
    : curated.length
      ? "Curated"
      : "Modeled";

  return {
    updatedAt: new Date().toISOString(),
    symbols,
    primaryBadge,
    badges: ["Curated", "Live feed", "Modeled"],
    items,
    curatedCount: curated.length,
    liveCount: liveItems.length,
    liveFeedConfigured: Boolean(rssUrl),
    liveStatus,
    liveError,
    disclaimer:
      "Public-figure and feed items are contextual research only — not live trading signals, not investment advice, and correlation is not causation."
  };
}
