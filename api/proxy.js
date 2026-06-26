/**
 * /api/proxy?url=<encoded-url>
 *
 * 서버사이드 프록시 — X-Frame-Options / CSP frame-ancestors 우회
 * - 허용 목록(ALLOWED_HOSTS)에 있는 사이트만 통과시킴
 * - 응답 HTML에서 X-Frame-Options / CSP frame-ancestors 헤더 제거
 * - 응답 HTML 내 상대경로 → 절대경로 변환 (이미지/스타일/스크립트)
 * - 응답 HTML 내 <base href> 삽입 → 상대 링크가 원본 도메인 기준으로 동작
 */

// 프록시 허용 도메인 목록 (보안: 이 목록 외 도메인은 차단)
const ALLOWED_HOSTS = [
  "lineageclassic.plaync.com",
  "namu.wiki",
];

// 프록시 요청 시 사용할 헤더 (봇 차단 우회)
const FAKE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Upgrade-Insecure-Requests": "1",
};

function sendOptions(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.status(204).end();
}

function isAllowed(url) {
  try {
    const host = new URL(url).hostname;
    return ALLOWED_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

/**
 * HTML 내 상대경로를 절대경로로 변환 + <base href> 삽입
 */
function rewriteHtml(html, originUrl) {
  const origin = new URL(originUrl).origin; // e.g. https://lineageclassic.plaync.com
  const href   = originUrl;                  // full URL for <base>

  // <head> 맨 앞에 <base href> 삽입 (상대경로 자동 해결)
  let out = html.replace(
    /<head([^>]*)>/i,
    `<head$1><base href="${href}">`
  );

  // X-Frame-Options 메타 태그 제거 (일부 사이트가 메타로도 지정)
  out = out.replace(/<meta[^>]+http-equiv=["']?x-frame-options["']?[^>]*>/gi, "");

  // CSP 메타 태그에서 frame-ancestors 항목 제거
  out = out.replace(
    /(<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*content=["'])([^"']*)(["'][^>]*>)/gi,
    (match, pre, csp, post) => {
      const cleaned = csp
        .split(";")
        .filter((d) => !d.trim().toLowerCase().startsWith("frame-ancestors"))
        .join(";");
      return pre + cleaned + post;
    }
  );

  return out;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return sendOptions(res);
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const rawUrl = req.query?.url;
  if (!rawUrl) {
    res.status(400).json({ error: "url 파라미터가 필요합니다" });
    return;
  }

  let targetUrl;
  try {
    targetUrl = decodeURIComponent(rawUrl);
    new URL(targetUrl); // 유효성 검사
  } catch {
    res.status(400).json({ error: "유효하지 않은 URL입니다" });
    return;
  }

  if (!isAllowed(targetUrl)) {
    res.status(403).json({ error: "허용되지 않은 도메인입니다", url: targetUrl });
    return;
  }

  try {
    const upstream = await fetch(targetUrl, {
      headers: FAKE_HEADERS,
      redirect: "follow",
    });

    const contentType = upstream.headers.get("content-type") || "text/html";
    const isHtml = contentType.includes("text/html");

    // HTML이면 리라이트 후 반환
    if (isHtml) {
      const raw = await upstream.text();
      const rewritten = rewriteHtml(raw, targetUrl);

      // 핵심: X-Frame-Options / CSP 헤더 제거 후 응답
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Access-Control-Allow-Origin", "*");
      // X-Frame-Options 헤더 명시적 제거 (응답에 포함 안 함)
      // CSP frame-ancestors 제거
      res.status(200).send(rewritten);
    } else {
      // 이미지/CSS/JS 등 바이너리 그대로 전달
      const buffer = await upstream.arrayBuffer();
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.status(upstream.status).send(Buffer.from(buffer));
    }
  } catch (err) {
    console.error("[proxy] fetch error:", err);
    res.status(502).json({ error: "upstream fetch 실패", detail: err.message });
  }
}
