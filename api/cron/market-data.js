import { readLatestMarketData, saveMarketData, sendJson, sendOptions } from "../_market-store.js";
import { runMarketUpdate } from "../../scrapers/update-market-data.mjs";

export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(res);
  if (req.method !== "GET" && req.method !== "POST") {
    return sendJson(res, { error: "Method not allowed" }, 405);
  }

  const expected = process.env.CRON_SECRET;
  const actual = req.headers.authorization;
  if (!expected || actual !== `Bearer ${expected}`) {
    return sendJson(res, { error: "Unauthorized" }, 401);
  }

  try {
    const startedAt = Date.now();
    const previousData = await readLatestMarketData().catch(() => null);
    const data = await runMarketUpdate({ previousData });
    await saveMarketData(data, "vercel-cron");

    return sendJson(res, {
      ok: true,
      fetchedAt: data.fetchedAt,
      servers: data.servers?.length || 0,
      source: "vercel-cron",
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error("market cron failed", error);
    return sendJson(
      res,
      {
        ok: false,
        error: "market cron failed",
        detail: error.message,
        missingDatabaseUrl: !process.env.DATABASE_URL,
      },
      500,
    );
  }
}
