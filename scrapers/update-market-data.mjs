import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = resolve(ROOT, "data", "market-data.js");
const HISTORY_LIMIT = 12;
const MIN_VALID_UNIT_PRICE = 400;
const MAX_VALID_UNIT_PRICE = 4000;
const OUTLIER_LOW_RATIO = 0.6;
const OUTLIER_HIGH_RATIO = 1.6;

const SERVERS = [
  ["오렌", 16303],
  ["데포로쥬", 15943],
  ["조우", 15947],
  ["발라카스", 16185],
  ["이실로테", 15946],
  ["질리언", 15945],
  ["오웬", 15950],
  ["켄라우헬", 15944],
  ["어레인", 15989],
  ["크리스터", 15951],
  ["하딘", 15948],
  ["파아그리오", 15994],
  ["케레니스", 15949],
  ["린델", 15998],
  ["세바스찬", 15991],
  ["로엔그린", 16091],
  ["군터", 15985],
  ["하이네", 16090],
  ["아스테어", 15986],
  ["듀크데필", 15987],
  ["캐스톨", 15990],
  ["마프르", 15997],
  ["발센", 15988],
  ["에바", 15995],
  ["가드리아", 15984],
  ["사이하", 15996],
  ["아툰", 15983],
  ["데컨", 15992],
  ["아인하사드", 15952],
];

const fetchHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.8",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
};

const previous = await readPrevious();
const fetchedAt = new Date().toISOString();
const krProxy = await findKrProxy();
console.log("KR proxy:", krProxy || "없음 (아이템매니아 수집 불가)");
const itemManiaListings = await collectItemMania();
const barotemListings = await collectBarotem();
const servers = [];
const baselineDate = getKstDateKey(fetchedAt);
const previousBaselineDate = getKstDateKey(addDays(fetchedAt, -1));
const noonBaselines = previous.noonBaselines || {};

// ── 가장 최근 baseline 날짜 찾기 (오늘/어제가 없어도 최근 데이터 사용) ──
const sortedBaselineDates = Object.keys(noonBaselines).sort();
// 오늘 baseline 제외, 가장 최근 날짜
const latestBaselineDate = sortedBaselineDates
  .filter(d => d < baselineDate)
  .at(-1) || null;
console.log(`baseline: today=${baselineDate}, prev=${previousBaselineDate}, latest=${latestBaselineDate}`);

for (const [name, itemBayServerId] of SERVERS) {
  const itemBay = await collectItemBay(name, itemBayServerId);
  const maniaPrices = itemManiaListings.get(name) || [];
  const itemMania = summarize(maniaPrices);
  const barotem = summarize(barotemListings.get(name) || []);
  const verifiedPrices = verifySourcePrices({ itemBay, itemMania, barotem });
  const excludedPrices = getSourcePrices({ itemBay, itemMania, barotem }).filter(
    (source) => !verifiedPrices.some((verified) => verified.key === source.key),
  );
  const currentPrice = marketPrice(verifiedPrices.map((source) => source.price));
  const lowestPrice = lowest(verifiedPrices.map((source) => source.price));
  const prevHistory = previous.servers?.find((server) => server.name === name)?.history || [];
  const history = currentPrice
    ? [...prevHistory, { at: fetchedAt, price: currentPrice }].slice(-HISTORY_LIMIT)
    : prevHistory.slice(-HISTORY_LIMIT);
  const todayBaseline = noonBaselines[baselineDate]?.[name];
  // 어제 baseline 우선, 없으면 가장 최근 날짜 baseline 사용
  const refDate = noonBaselines[previousBaselineDate]?.[name] != null
    ? previousBaselineDate
    : latestBaselineDate;
  const previousNoonPrice = refDate ? (noonBaselines[refDate]?.[name] || null) : null;
  const change = currentPrice && previousNoonPrice ? Math.round(currentPrice - previousNoonPrice) : null;
  const changeRate = currentPrice && previousNoonPrice
    ? Number(((change / previousNoonPrice) * 100).toFixed(2))
    : null;

  servers.push({
    name,
    itemBayServerId,
    currentPrice,
    lowestPrice,
    itemBay,
    itemMania: {
      ...itemMania,
      note: "판매목록 1만당 단가 기준",
    },
    barotem: {
      ...barotem,
      status: barotem.count ? "ok" : "empty",
    },
    verifiedSources: verifiedPrices,
    excludedSources: excludedPrices,
    verificationStatus: verifiedPrices.length >= 2 ? "verified" : "limited",
    previousNoonPrice,
    change,
    changeRate,
    baselineLabel: refDate ? `${refDate} 12:00` : null,
    history,
  });

  if (currentPrice && shouldCaptureNoonBaseline(fetchedAt) && !todayBaseline) {
    noonBaselines[baselineDate] = noonBaselines[baselineDate] || {};
    noonBaselines[baselineDate][name] = currentPrice;
  }
}

const data = {
  game: "리니지클래식",
  unit: "아이템베이: 1만개 기준 / 아이템매니아: 거래완료 총액",
  fetchedAt,
  noonBaselines,
  sources: {
    itemBay: "server page",
    itemMania: "completed trades",
    barotem: barotemListings.size ? "productTable API" : "empty",
  },
  servers,
};

await mkdir(dirname(OUT_FILE), { recursive: true });
await writeFile(
  OUT_FILE,
  `window.MARKET_DATA = ${JSON.stringify(data, null, 2)};\n`,
  "utf8",
);

console.log(`Updated ${OUT_FILE}`);
console.log(`Fetched ${servers.length} servers at ${fetchedAt}`);

async function collectItemBay(serverName, serverId) {
  const url = `https://www.itembay.com/item/sell/game-3828/server-${serverId}/type-3`;

  try {
    const html = await fetchText(url);
    const text = normalize(html);
    const activeText = text.split("거래완료 게임머니")[0];
    const prices = [...activeText.matchAll(/([\d,]+)\s*원\s*\(1만개 기준\)/g)]
      .map((match) => toNumber(match[1]))
      .filter((price) => price >= 100 && price <= 20000);

    return {
      ...summarize(prices),
      url,
      status: prices.length ? "ok" : "empty",
    };
  } catch (error) {
    return {
      count: 0,
      min: null,
      avg: null,
      max: null,
      url,
      status: `error: ${error.message}`,
    };
  }
}

async function collectItemMania() {
  const listings = new Map();
  if (!krProxy) return listings; // 프록시 없으면 스킵

  const dispatcher = new ProxyAgent(`http://${krProxy}`);

  try {
    for (let page = 1; page <= 10; page += 1) {
      const params = new URLSearchParams({
        search_game: "5913",
        search_server: "",
        search_server_tmp: "",
        search_faction: "",
        search_game_text: "리니지클래식",
        search_server_text: "",
        search_goods: "money",
        search_word: "",
        search_type: "sell",
        money_listOrder: "",
        good_listOrder: "",
        character_listOrder: "",
        etc_listOrder: "",
        goods_type: "1",
        trade_state: "",
        order: "price_asc",
        pinit: String(page),
      });

      const response = await undiciFetch("https://www.itemmania.com/sell/ajax_list.php", {
        method: "POST",
        headers: {
          ...fetchHeaders,
          accept: "application/json,text/plain,*/*",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          referer: "https://www.itemmania.com/sell/money/lineageclassic",
          "x-requested-with": "XMLHttpRequest",
        },
        body: params.toString(),
        dispatcher,
      });

      if (!response.ok) continue;

      const data = JSON.parse(await response.text());
      const rows = [...(data.data?.p || []), ...(data.data?.g || [])];

      for (const row of rows) {
        const server = normalizeServer(String(row.gs_name || "").split("|")[1] || "");
        const price = parseUnitPrice(row.ea_trade_money) || toNumber(row.trade_money);
        if (!server || price < 100 || price > 20000) continue;
        if (!listings.has(server)) listings.set(server, []);
        listings.get(server).push(price);
      }
    }
  } catch (e) {
    console.error("아이템매니아 수집 오류:", e.message);
    return listings;
  }

  return listings;
}

async function collectBarotem() {
  const baseUrl = "https://www.barotem.com/product/productTable/2382r902?sell=sell&display=1&orderby=1";
  const listings = new Map();

  try {
    for (let page = 1; page <= 5; page += 1) {
      const response = await fetch(`${baseUrl}&page=${page}`, {
        headers: {
          ...fetchHeaders,
          accept: "application/json,text/plain,*/*",
          referer:
            "https://www.barotem.com/product/lists/2382r902?display=1&orderby=1&page=1&sell=sell",
          "x-requested-with": "XMLHttpRequest",
        },
      });

      if (!response.ok) continue;

      const data = JSON.parse(await response.text());
      for (const row of data.rows || []) {
        const server = normalizeServer(row.server);
        const unitPrice = row.unit_price ? toNumber(row.unit_price) : toNumber(row.baro_price);
        if (!server || unitPrice < 100 || unitPrice > 20000) continue;
        if (!listings.has(server)) listings.set(server, []);
        listings.get(server).push(unitPrice);
      }
    }
  } catch {
    return listings;
  }

  return listings;
}

async function fetchText(url) {
  const response = await fetch(url, { headers: fetchHeaders });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/* 한국 공개 프록시 자동 선택 — 아이템매니아 IP 차단 우회용 */
async function findKrProxy() {
  // 1순위: 환경변수로 고정 프록시 지정 가능 (ITEMMANIA_PROXY=host:port)
  if (process.env.ITEMMANIA_PROXY) return process.env.ITEMMANIA_PROXY;

  // 2순위: proxyscrape에서 KR HTTP 프록시 목록 가져와 살아있는 것 사용
  try {
    const res = await fetch(
      "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&country=kr&protocol=http&timeout=5000&proxy_format=ipport&format=text",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const list = (await res.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);

    for (const proxy of list.slice(0, 15)) {
      const ok = await testProxy(proxy);
      if (ok) {
        console.log("사용 프록시:", proxy);
        return proxy;
      }
    }
  } catch {
    // 목록 가져오기 실패 → null
  }
  return null;
}

async function testProxy(proxy) {
  try {
    const dispatcher = new ProxyAgent(`http://${proxy}`);
    const res = await undiciFetch("https://www.itemmania.com/sell/money/lineageclassic", {
      dispatcher,
      signal: AbortSignal.timeout(6000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function readPrevious() {
  try {
    const js = await readFile(OUT_FILE, "utf8");
    const json = js.replace(/^window\.MARKET_DATA\s*=\s*/, "").replace(/;\s*$/, "");
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function summarize(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return { count: 0, min: null, avg: null, max: null };

  return {
    count: clean.length,
    min: Math.min(...clean),
    avg: Math.round(clean.reduce((sum, value) => sum + value, 0) / clean.length),
    max: Math.max(...clean),
  };
}

function lowest(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? Math.min(...clean) : null;
}

function consensusPrice(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  return clean[Math.floor(clean.length / 2)];
}

function marketPrice(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return Math.round((clean[0] + clean[1]) / 2);

  const [low, mid, high] = clean;
  const lowGap = Math.abs(mid - low);
  const highGap = Math.abs(high - mid);

  if (lowGap <= highGap) {
    return Math.round((low + mid) / 2);
  }

  return mid;
}

function verifySourcePrices(sources) {
  const candidates = getSourcePrices(sources).filter(
    (source) =>
      Number.isFinite(source.price) &&
      source.price >= MIN_VALID_UNIT_PRICE &&
      source.price <= MAX_VALID_UNIT_PRICE,
  );

  if (candidates.length < 2) return candidates;

  const median = [...candidates].sort((a, b) => a.price - b.price)[Math.floor(candidates.length / 2)].price;
  return candidates.filter(
    (source) => source.price >= median * OUTLIER_LOW_RATIO && source.price <= median * OUTLIER_HIGH_RATIO,
  );
}

function getSourcePrices(sources) {
  return [
    { key: "itemBay", label: "아이템베이", price: sources.itemBay.min },
    { key: "barotem", label: "바로템", price: sources.barotem.min },
    { key: "itemMania", label: "아이템매니아", price: sources.itemMania.min },
  ].filter((source) => Number.isFinite(source.price));
}

function normalize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeServer(name) {
  return name === "세바스챤" ? "세바스찬" : name;
}

function toNumber(value) {
  return Number(String(value).replace(/[^\d]/g, ""));
}

function parseUnitPrice(value) {
  const match = String(value || "").match(/만당\s*([\d,]+)\s*원/);
  return match ? toNumber(match[1]) : null;
}

function getKstDateKey(value) {
  const date = new Date(value);
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function shouldCaptureNoonBaseline(value) {
  const date = new Date(value);
  const kstHour = new Date(date.getTime() + 9 * 60 * 60 * 1000).getUTCHours();
  return kstHour >= 12;
}
