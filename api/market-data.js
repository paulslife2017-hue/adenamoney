import { readLatestMarketData, readStaticMarketData, sendJson, sendOptions } from "./_market-store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(res);
  if (req.method !== "GET") return sendJson(res, { error: "Method not allowed" }, 405);

  try {
    const data = await withTimeout(readLatestMarketData(), 3000);
    if (data) return sendJson(res, { ...data, delivery: "db" });
  } catch (error) {
    console.warn("market db read failed", error.message);
  }

  try {
    const data = await readStaticMarketData();
    return sendJson(res, { ...data, delivery: "static" });
  } catch (error) {
    return sendJson(res, { error: "market data unavailable", detail: error.message }, 503);
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    }),
  ]);
}
