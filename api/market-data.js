import { json, optionsResponse, readLatestMarketData, readStaticMarketData } from "./_market-store.js";

export default async function handler(req) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  try {
    const data = await readLatestMarketData();
    if (data) return json({ ...data, delivery: "db" });
  } catch (error) {
    console.warn("market db read failed", error.message);
  }

  try {
    const data = await readStaticMarketData();
    return json({ ...data, delivery: "static" });
  } catch (error) {
    return json({ error: "market data unavailable", detail: error.message }, 503);
  }
}
