import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_FILE = resolve("data", "market-data.js");
const js = await readFile(OUT_FILE, "utf8");
const data = JSON.parse(js.replace(/^window\.MARKET_DATA\s*=\s*/, "").replace(/;\s*$/, ""));

const yesterday = getKstDateKey(addDays(data.fetchedAt || new Date().toISOString(), -1));
data.noonBaselines = data.noonBaselines || {};
data.noonBaselines[yesterday] = data.noonBaselines[yesterday] || {};

for (const [index, server] of data.servers.entries()) {
  if (!server.currentPrice) continue;

  const direction = index % 5 === 0 ? 1 : index % 4 === 0 ? -1 : index % 3 === 0 ? 1 : -1;
  const rate = 0.012 + ((index * 7) % 18) / 1000;
  const yesterdayPrice = Math.round(server.currentPrice / (1 + direction * rate));

  data.noonBaselines[yesterday][server.name] = yesterdayPrice;
  server.previousNoonPrice = yesterdayPrice;
  server.change = server.currentPrice - yesterdayPrice;
  server.changeRate = Number(((server.change / yesterdayPrice) * 100).toFixed(2));
  server.baselineLabel = `${yesterday} 12:00`;
}

await writeFile(OUT_FILE, `window.MARKET_DATA = ${JSON.stringify(data, null, 2)};\n`, "utf8");
console.log(`Seeded ${yesterday} baseline for ${data.servers.length} servers`);

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
