import { json, optionsResponse, readLatestMarketData, saveMarketData } from "../_market-store.js";
import { runMarketUpdate } from "../../scrapers/update-market-data.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expected = process.env.CRON_SECRET;
  const actual = req.headers.get("authorization");
  if (!expected || actual !== `Bearer ${expected}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const previousData = await readLatestMarketData().catch(() => null);
  const data = await runMarketUpdate({ previousData });
  await saveMarketData(data, "vercel-cron");

  return json({
    ok: true,
    fetchedAt: data.fetchedAt,
    servers: data.servers?.length || 0,
  });
}
