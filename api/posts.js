// api/posts.js — Vercel Serverless Function
// GET  /api/posts?page=1&limit=20&server=오렌   → 글 목록 (페이지네이션, 서버필터)
// POST /api/posts                               → 글 작성 { server, nickname, content, password }
// DELETE /api/posts?id=123&password=xxx         → 글 삭제 (비밀번호 확인)

import { neon } from "@neondatabase/serverless";

function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL 환경변수가 없습니다.");
  return neon(url);
}

// CORS 헤더
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

// 테이블 자동 생성 (첫 요청 시)
async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS board_posts (
      id         SERIAL PRIMARY KEY,
      server     TEXT NOT NULL DEFAULT '',
      nickname   TEXT NOT NULL DEFAULT '익명',
      content    TEXT NOT NULL,
      password   TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_hash    TEXT
    )
  `;
}

// 간단한 IP 해시 (프라이버시 보호)
function hashIp(ip) {
  if (!ip) return null;
  let h = 0;
  for (const c of ip) h = (Math.imul(31, h) + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16);
}

export default async function handler(req) {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const url = new URL(req.url);
  const sql = getDb();

  // ── GET ──────────────────────────────────────────────────────────────────
  if (req.method === "GET") {
    await ensureTable(sql);

    const page   = Math.max(1, parseInt(url.searchParams.get("page")  || "1"));
    const limit  = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") || "20")));
    const server = url.searchParams.get("server") || "";
    const offset = (page - 1) * limit;

    let rows, countRow;
    if (server) {
      rows     = await sql`SELECT id, server, nickname, content, created_at FROM board_posts WHERE server = ${server} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
      countRow = await sql`SELECT COUNT(*)::int AS cnt FROM board_posts WHERE server = ${server}`;
    } else {
      rows     = await sql`SELECT id, server, nickname, content, created_at FROM board_posts ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`;
      countRow = await sql`SELECT COUNT(*)::int AS cnt FROM board_posts`;
    }

    return json({
      posts:  rows,
      total:  countRow[0]?.cnt ?? 0,
      page,
      limit,
    });
  }

  // ── POST ─────────────────────────────────────────────────────────────────
  if (req.method === "POST") {
    await ensureTable(sql);

    let body;
    try { body = await req.json(); } catch { return json({ error: "JSON 파싱 오류" }, 400); }

    const { server = "", nickname = "익명", content, password } = body;

    if (!content || content.trim().length < 2)
      return json({ error: "내용은 2자 이상 입력하세요." }, 400);
    if (content.trim().length > 1000)
      return json({ error: "내용은 1000자 이하로 입력하세요." }, 400);
    if (!password || password.length < 4)
      return json({ error: "비밀번호는 4자 이상 입력하세요." }, 400);
    if (nickname.length > 20)
      return json({ error: "닉네임은 20자 이하로 입력하세요." }, 400);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ipHash = hashIp(ip);

    const [row] = await sql`
      INSERT INTO board_posts (server, nickname, content, password, ip_hash)
      VALUES (${server.trim()}, ${nickname.trim()}, ${content.trim()}, ${password}, ${ipHash})
      RETURNING id, server, nickname, content, created_at
    `;
    return json({ post: row }, 201);
  }

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (req.method === "DELETE") {
    await ensureTable(sql);

    const id       = parseInt(url.searchParams.get("id") || "0");
    const password = url.searchParams.get("password") || "";

    if (!id) return json({ error: "id가 필요합니다." }, 400);
    if (!password) return json({ error: "비밀번호가 필요합니다." }, 400);

    const [existing] = await sql`SELECT id, password FROM board_posts WHERE id = ${id}`;
    if (!existing) return json({ error: "존재하지 않는 글입니다." }, 404);
    if (existing.password !== password) return json({ error: "비밀번호가 틀렸습니다." }, 403);

    await sql`DELETE FROM board_posts WHERE id = ${id}`;
    return json({ deleted: true });
  }

  return json({ error: "지원하지 않는 메서드입니다." }, 405);
}
