import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = resolve(ROOT, "data", "youtube-data.js");
const CHANNELS_FILE = resolve(ROOT, "data", "youtube-channels.json");
const PINNED_FILE = resolve(ROOT, "data", "youtube-pinned.json");
const SHORTS_MAX_SECONDS = 180;
const API_KEY = typeof process !== "undefined" ? process.env.YOUTUBE_API_KEY : "";
const CHANNELS = JSON.parse(await readFile(CHANNELS_FILE, "utf8"));
const PINNED = await readOptionalJson(PINNED_FILE, []);
const EXCLUDE_KEYWORDS = [
  "솔인챈트",
  "솔 인챈트",
  "솔인첸트",
  "솔 인첸트",
  "그라나도",
  "로드나인",
];

const videos = [];

for (const channel of CHANNELS) {
  const channelId = channel.channelId || channel.id || (channel.url ? await resolveChannelId(channel.url) : null);
  if (!channelId) {
    console.warn(`YouTube channel id not found: ${channel.url || "unknown"}`);
    continue;
  }

  const channelVideos = API_KEY
    ? await fetchWithApi(channelId, channel)
    : await fetchWithRss(channelId, channel);
  const channelShorts = await fetchChannelShorts(channel, channelId);

  videos.push(
    ...[...channelVideos, ...channelShorts].map((video) => ({
      ...video,
      subscriberRank: channel.subscriberRank || 999,
    })),
  );
}

const merged = dedupeVideos([...PINNED, ...videos]);
merged.sort((a, b) => {
  if (a.pinned && !b.pinned) return -1;
  if (!a.pinned && b.pinned) return 1;
  return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
});

const payload = {
  updatedAt: new Date().toISOString(),
  videos: merged.slice(0, 200),
};

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(
  OUT_FILE,
  `window.YOUTUBE_DATA = ${JSON.stringify(payload, null, 2)};\n`,
  "utf8",
);

console.log(`Updated ${OUT_FILE} with ${payload.videos.length} videos`);

async function readOptionalJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

function dedupeVideos(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

async function fetchWithApi(channelId, channel) {
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("key", API_KEY);
  searchUrl.searchParams.set("channelId", channelId);
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("order", "date");
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("maxResults", "20");

  const response = await fetch(searchUrl);
  if (!response.ok) {
    console.warn(`YouTube API fetch failed for ${channelId}: HTTP ${response.status}`);
    return [];
  }

  const data = await response.json();
  const baseVideos = (data.items || [])
    .map((item) => {
      const videoId = item.id?.videoId;
      if (!videoId) return null;

      return {
        id: videoId,
        title: item.snippet?.title || "",
        channelTitle: item.snippet?.channelTitle || "",
        publishedAt: item.snippet?.publishedAt || null,
        thumbnail:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          "",
        url: `https://www.youtube.com/watch?v=${videoId}`,
        tag: channel.tag || "영상",
        kind: "video",
      };
    })
    .filter(Boolean);

  const durations = await fetchVideoDurations(baseVideos.map((video) => video.id));
  return baseVideos.map((video) => {
    const seconds = durations.get(video.id);
    const kind = seconds && seconds <= SHORTS_MAX_SECONDS ? "shorts" : "video";
    return {
      ...video,
      durationSeconds: seconds || null,
      kind,
      tag: kind === "shorts" ? "쇼츠" : video.tag,
    };
  }).filter((video) => matchesChannelFilter(video, channel));
}

async function fetchVideoDurations(videoIds) {
  const durations = new Map();
  if (!videoIds.length) return durations;

  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("key", API_KEY);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set("id", videoIds.join(","));

  const response = await fetch(url);
  if (!response.ok) return durations;

  const data = await response.json();
  for (const item of data.items || []) {
    durations.set(item.id, parseIsoDuration(item.contentDetails?.duration));
  }

  return durations;
}

async function fetchWithRss(channelId, channel) {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  const response = await fetch(rssUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ko-KR,ko;q=0.9",
    },
  });

  if (!response.ok) {
    console.warn(`YouTube RSS fetch failed for ${channelId}: HTTP ${response.status}`);
    return [];
  }

  const xml = await response.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  const videos = [];

  for (const entry of entries.slice(0, 15)) {
    const id = textBetween(entry, "<yt:videoId>", "</yt:videoId>");
    const details = await fetchVideoPageDetails(id);
    const kind = isShortsVideo(entry, details) ? "shorts" : "video";

    videos.push({
      id,
      title: decodeXml(textBetween(entry, "<title>", "</title>")),
      channelTitle: decodeXml(textBetween(entry, "<name>", "</name>")),
      publishedAt: textBetween(entry, "<published>", "</published>") || null,
      thumbnail: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${id}`,
      tag: kind === "shorts" ? "쇼츠" : channel.tag || "영상",
      kind,
      durationSeconds: details.durationSeconds,
    });
  }

  return videos.filter((video) => matchesChannelFilter(video, channel));
}

async function fetchChannelShorts(channel, channelId) {
  const shortsUrl = channel.url
    ? `${channel.url.replace(/\/+$/, "")}/shorts`
    : `https://www.youtube.com/channel/${channelId}/shorts`;

  try {
    const response = await fetch(shortsUrl, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept-language": "ko-KR,ko;q=0.9",
      },
    });

    if (!response.ok) {
      console.warn(`YouTube shorts fetch failed for ${channelId}: HTTP ${response.status}`);
      return [];
    }

    const html = await response.text();
    const ids = uniqueVideoIds([
      ...[...html.matchAll(/"videoId":"([\w-]{11})"/g)].map((match) => match[1]),
      ...[...html.matchAll(/\/shorts\/([\w-]{11})/g)].map((match) => match[1]),
    ]);
    const shorts = [];

    for (const id of ids.slice(0, 8)) {
      const details = await fetchVideoPageDetails(id);
      const isShorts =
        details.isShorts ||
        (details.durationSeconds && details.durationSeconds <= SHORTS_MAX_SECONDS) ||
        html.includes(`/shorts/${id}`);

      if (!isShorts) continue;

      shorts.push({
        id,
        title: details.title || "쇼츠",
        channelTitle: details.channelTitle || channel.name || "",
        publishedAt: details.publishedAt || null,
        thumbnail: details.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        url: `https://www.youtube.com/shorts/${id}`,
        tag: "쇼츠",
        kind: "shorts",
        durationSeconds: details.durationSeconds,
      });
    }

    return shorts.filter((video) => matchesChannelFilter(video, channel));
  } catch (error) {
    console.warn(`YouTube shorts parse failed for ${channelId}: ${error.message}`);
    return [];
  }
}

function matchesChannelFilter(video, channel) {
  const title = normalizeKoreanKeyword(video.title);
  if (EXCLUDE_KEYWORDS.some((keyword) => title.includes(normalizeKoreanKeyword(keyword)))) {
    return false;
  }

  const keywords = channel.includeKeywords || [];
  if (!keywords.length) return true;

  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeKoreanKeyword(keyword);
    return title.includes(normalizedKeyword);
  });
}

function normalizeKoreanKeyword(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function uniqueVideoIds(ids) {
  const seen = new Set();
  return ids.filter((id) => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function resolveChannelId(url) {
  if (/^UC[\w-]{20,}$/.test(url)) return url;

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ko-KR,ko;q=0.9",
    },
  });

  if (!response.ok) return null;

  const html = await response.text();
  return (
    html.match(/"externalId":"(UC[^"]+)"/)?.[1] ||
    html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/)?.[1] ||
    html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/)?.[1] ||
    null
  );
}

function textBetween(value, start, end) {
  const startIndex = value.indexOf(start);
  if (startIndex < 0) return "";
  const contentStart = startIndex + start.length;
  const endIndex = value.indexOf(end, contentStart);
  if (endIndex < 0) return "";
  return value.slice(contentStart, endIndex).trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function decodeHtmlAttr(value) {
  return decodeXml(String(value || "").replace(/\\"/g, '"').replace(/\\u0026/g, "&"));
}

async function fetchVideoPageDetails(videoId) {
  try {
    const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "user-agent": "Mozilla/5.0",
        "accept-language": "ko-KR,ko;q=0.9",
      },
    });

    if (!response.ok) return { durationSeconds: null, isShorts: false };

    const html = await response.text();
    const durationSeconds = Number(html.match(/"lengthSeconds":"(\d+)"/)?.[1] || 0) || null;
    const isShorts =
      html.includes('"isShortsEligible":true') ||
      html.includes('"webCommandMetadata":{"url":"/shorts/');

    return {
      durationSeconds,
      isShorts,
      title: decodeHtmlAttr(html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] || ""),
      channelTitle:
        decodeHtmlAttr(html.match(/"ownerChannelName":"([^"]+)"/)?.[1] || "") ||
        decodeHtmlAttr(html.match(/"author":"([^"]+)"/)?.[1] || ""),
      publishedAt: html.match(/"publishDate":"([^"]+)"/)?.[1] || null,
      thumbnail: decodeHtmlAttr(html.match(/<meta property="og:image" content="([^"]+)"/)?.[1] || ""),
    };
  } catch {
    return { durationSeconds: null, isShorts: false };
  }
}

function isShortsVideo(entry, details) {
  if (details.isShorts) return true;
  if (details.durationSeconds && details.durationSeconds <= SHORTS_MAX_SECONDS) return true;
  return looksLikeShorts(entry);
}

function looksLikeShorts(entry) {
  const value = decodeXml(entry).toLowerCase();
  return value.includes("#shorts") || value.includes(" shorts") || value.includes("쇼츠");
}

function parseIsoDuration(value) {
  const match = String(value || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}
