import { readLatestMarketData, sendJson, sendOptions } from "./_market-store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(res);
  if (req.method !== "GET") return sendJson(res, { error: "Method not allowed" }, 405);

  const env = {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    cronSecret: Boolean(process.env.CRON_SECRET),
  };

  let db = { ok: false, error: "DATABASE_URL is not configured" };
  if (env.databaseUrl) {
    try {
      const data = await withTimeout(readLatestMarketData(), 3000);
      db = {
        ok: true,
        hasSnapshot: Boolean(data),
        fetchedAt: data?.fetchedAt || null,
        servers: data?.servers?.length || 0,
      };
    } catch (error) {
      db = { ok: false, error: error.message };
    }
  }

  return sendJson(res, { ok: env.databaseUrl && env.cronSecret, env, db });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    }),
  ]);
}
