import { readMarketStatus, sendJson, sendOptions } from "./_market-store.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(res);
  if (req.method !== "GET") return sendJson(res, { error: "Method not allowed" }, 405);

  try {
    return sendJson(res, await readMarketStatus());
  } catch (error) {
    return sendJson(
      res,
      {
        ok: false,
        delivery: "db",
        error: "market status unavailable",
        detail: error.message,
        missingDatabaseUrl: !process.env.DATABASE_URL,
      },
      503,
    );
  }
}
