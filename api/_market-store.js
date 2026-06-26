import { neon } from "@neondatabase/serverless";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_MARKET_DATA_PATH = join(__dirname, "..", "data", "market-data.js");

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function sendJson(res, data, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(CORS)) {
    res.setHeader(key, value);
  }
  res.end(JSON.stringify(data));
}

export function sendOptions(res) {
  res.statusCode = 204;
  for (const [key, value] of Object.entries(CORS)) {
    res.setHeader(key, value);
  }
  res.end();
}

export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export async function ensureMarketTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL DEFAULT 'cron',
      fetched_at TIMESTAMPTZ NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS market_snapshots_fetched_at_idx ON market_snapshots (fetched_at DESC)`;
}

export async function readLatestMarketData() {
  const sql = getSql();
  await ensureMarketTable(sql);
  const rows = await sql`
    SELECT data
    FROM market_snapshots
    ORDER BY fetched_at DESC, id DESC
    LIMIT 1
  `;
  return rows[0]?.data || null;
}

export async function saveMarketData(data, source = "cron") {
  const sql = getSql();
  await ensureMarketTable(sql);
  await sql`
    INSERT INTO market_snapshots (source, fetched_at, data)
    VALUES (${source}, ${data.fetchedAt || new Date().toISOString()}, ${JSON.stringify(data)}::jsonb)
  `;
  await pruneOldMarketData(sql);
}

export async function readMarketStatus() {
  const sql = getSql();
  await ensureMarketTable(sql);
  const rows = await sql`
    SELECT
      COUNT(*)::int AS snapshot_count,
      MAX(fetched_at) AS latest_fetched_at,
      MIN(fetched_at) AS oldest_fetched_at
    FROM market_snapshots
  `;
  const latestRows = await sql`
    SELECT source, fetched_at, data->'servers' AS servers
    FROM market_snapshots
    ORDER BY fetched_at DESC, id DESC
    LIMIT 1
  `;

  const latest = latestRows[0] || null;
  const fetchedAt = latest?.fetched_at ? new Date(latest.fetched_at).toISOString() : null;
  const ageSeconds = fetchedAt ? Math.max(0, Math.round((Date.now() - new Date(fetchedAt).getTime()) / 1000)) : null;

  return {
    ok: true,
    delivery: "db",
    snapshotCount: rows[0]?.snapshot_count || 0,
    latestFetchedAt: fetchedAt,
    oldestFetchedAt: rows[0]?.oldest_fetched_at ? new Date(rows[0].oldest_fetched_at).toISOString() : null,
    latestSource: latest?.source || null,
    latestServerCount: Array.isArray(latest?.servers) ? latest.servers.length : 0,
    ageSeconds,
    stale: ageSeconds == null ? true : ageSeconds > 20 * 60,
  };
}

async function pruneOldMarketData(sql) {
  await sql`
    DELETE FROM market_snapshots
    WHERE id NOT IN (
      SELECT id
      FROM market_snapshots
      ORDER BY fetched_at DESC, id DESC
      LIMIT 1008
    )
  `;
}

export async function readStaticMarketData() {
  const js = await readFile(STATIC_MARKET_DATA_PATH, "utf8");
  const jsonText = js.replace(/^window\.MARKET_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  return JSON.parse(jsonText);
}
