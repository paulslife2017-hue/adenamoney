import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const brand = "오늘아덴";
const domain = "https://오늘아덴.kr";
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());

const slugMap = new Map([
  ["오렌", "oren"],
  ["데포로쥬", "depo"],
  ["조우", "jow"],
  ["발라카스", "val"],
  ["이실로테", "isil"],
  ["질리언", "zil"],
  ["오웬", "owen"],
  ["켄라우헬", "ken"],
  ["어레인", "aren"],
  ["크리스터", "chris"],
  ["하딘", "hardin"],
  ["파아그리오", "fia"],
  ["케레니스", "keren"],
  ["린델", "lindel"],
  ["세바스찬", "seb"],
  ["로엔그린", "loen"],
  ["군터", "gun"],
  ["하이네", "heine"],
  ["아스테어", "ast"],
  ["듀크데필", "duke"],
  ["캐스톨", "cas"],
  ["마프르", "map"],
  ["발센", "balsen"],
  ["에바", "eva"],
  ["가드리아", "ga"],
  ["사이하", "sai"],
  ["아툰", "atun"],
  ["데컨", "deken"],
  ["아인하사드", "ein"],
]);

const escapeHtml = (value) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const formatPrice = (value) => Number(value || 0).toLocaleString("ko-KR");
const formatChange = (server) => {
  const diff = Number(server.diff ?? 0);
  const rate = Number(server.changeRate ?? 0);
  if (!diff && !rate) return "전일 12시 기준 보합";
  const sign = diff > 0 ? "+" : "";
  return `전일 12시 기준 ${sign}${formatPrice(diff)}원 (${sign}${rate}%)`;
};

const parseMarketData = async () => {
  const raw = await readFile(path.join(root, "data", "market-data.js"), "utf8");
  const json = raw.replace(/^window\.MARKET_DATA\s*=\s*/, "").replace(/;\s*$/, "");
  return JSON.parse(json);
};

const marketLabel = {
  itemBay: "아이템베이",
  itemMania: "아이템매니아",
  barotem: "바로템",
};

const getSourceRows = (server) =>
  Object.entries(server.sources || {})
    .filter(([, source]) => Number(source?.price) > 0)
    .map(([key, source]) => ({
      label: marketLabel[key] || key,
      price: source.price,
    }));

const renderServerPage = (server, allServers) => {
  const slug = slugMap.get(server.name);
  const url = `${domain}/${slug}`;
  const current = formatPrice(server.currentPrice);
  const change = formatChange(server);
  const sourceRows = getSourceRows(server);
  const description = `${server.name} 아데나 시세 ${current}원. 리니지 클래식 ${server.name} 서버 아덴 가격과 전일 12시 대비 흐름을 오늘아덴에서 확인하세요.`;
  const topLinks = allServers
    .filter((item) => item.name !== server.name)
    .slice(0, 8)
    .map((item) => `<a href="/${slugMap.get(item.name)}">${escapeHtml(item.name)} 시세</a>`)
    .join("");
  const sourceHtml = sourceRows.length
    ? sourceRows.map((row) => `<li><span>${row.label}</span><strong>${formatPrice(row.price)}원</strong></li>`).join("")
    : `<li><span>수집 대기</span><strong>확인 중</strong></li>`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${server.name} 아데나 시세 - ${brand}`,
      url,
      description,
      inLanguage: "ko-KR",
      isPartOf: {
        "@type": "WebSite",
        name: brand,
        url: domain,
      },
      about: [`리니지 클래식 ${server.name} 아데나 시세`, `${server.name} 서버 아덴 가격`],
      dateModified: today,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: brand, item: domain },
        { "@type": "ListItem", position: 2, name: `${server.name} 아데나 시세`, item: url },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          name: `${server.name} 아데나 시세는 어떻게 확인하나요?`,
          acceptedAnswer: {
            "@type": "Answer",
            text: `${brand}에서 리니지 클래식 ${server.name} 서버의 현재가, 전일 12시 대비 변화, 공개 거래 목록 기반 참고가를 확인할 수 있습니다.`,
          },
        },
        {
          "@type": "Question",
          name: "표시 가격은 실제 체결가와 같나요?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "표시 가격은 공개 판매 목록을 바탕으로 정리한 참고 시세입니다. 실제 거래 조건은 판매자, 수수료, 체결 시점에 따라 달라질 수 있습니다.",
          },
        },
      ],
    },
  ];

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(server.name)} 아데나 시세 | 리니지 클래식 ${escapeHtml(server.name)} 서버 아덴 가격 - ${brand}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="keywords" content="리니지 클래식 아데나 시세, ${escapeHtml(server.name)} 아데나, ${escapeHtml(server.name)} 아덴 시세, 리니지 클래식 ${escapeHtml(server.name)}, 아데나 시세, 오늘아덴">
  <meta name="robots" content="index,follow,max-image-preview:large">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${brand}">
  <meta property="og:title" content="${escapeHtml(server.name)} 아데나 시세 - ${brand}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${url}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  <style>
    :root{color-scheme:dark;--bg:#050914;--panel:#0b1324;--line:#1a2b46;--text:#f5f8ff;--muted:#98a8bf;--accent:#44d7cf;--gold:#f4c967}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 30% -10%,#14304f 0,#050914 38%,#03060d 100%);color:var(--text);font-family:Arial,"Noto Sans KR",sans-serif;line-height:1.58}
    .wrap{width:min(960px,calc(100% - 32px));margin:0 auto;padding:42px 0}.top{display:flex;justify-content:space-between;gap:16px;align-items:center;margin-bottom:22px}
    .brand{font-weight:900;letter-spacing:-.03em;color:#fff;text-decoration:none}.home{color:var(--accent);text-decoration:none;font-weight:800}
    .hero,.card{border:1px solid var(--line);background:rgba(11,19,36,.86);border-radius:18px;box-shadow:0 18px 48px rgba(0,0,0,.28)}
    .hero{padding:28px}.eyebrow{color:var(--accent);font-size:13px;font-weight:800;margin:0 0 6px}h1{margin:0;font-size:clamp(30px,5vw,54px);letter-spacing:-.05em}
    .lead{margin:10px 0 0;color:#c8d4e5}.price{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end;margin-top:28px;padding-top:24px;border-top:1px solid var(--line)}
    .price strong{display:block;font-size:clamp(46px,8vw,76px);line-height:1;letter-spacing:-.06em}.change{padding:10px 14px;border-radius:999px;background:rgba(68,215,207,.12);color:var(--accent);font-weight:900}
    .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px;margin-top:18px}.card{padding:22px}h2{font-size:20px;margin:0 0 12px;letter-spacing:-.03em}
    ul{padding:0;margin:0;list-style:none}.sources li{display:flex;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.08)}
    .sources li:last-child{border-bottom:0}.sources strong{color:#fff}.bodycopy p{margin:0 0 12px;color:#c9d6e8}
    .links{display:flex;flex-wrap:wrap;gap:8px}.links a{border:1px solid var(--line);border-radius:999px;padding:8px 11px;color:#c8f7f2;text-decoration:none;background:rgba(68,215,207,.07)}
    .cta{display:inline-flex;margin-top:20px;background:linear-gradient(135deg,var(--accent),var(--gold));color:#06101d;text-decoration:none;font-weight:900;border-radius:12px;padding:13px 16px}
    @media(max-width:720px){.wrap{padding:24px 0}.top{align-items:flex-start}.grid,.price{grid-template-columns:1fr}.hero,.card{border-radius:14px;padding:18px}.change{width:max-content}}
  </style>
</head>
<body>
  <main class="wrap">
    <nav class="top" aria-label="상단 메뉴">
      <a class="brand" href="/">${brand}</a>
      <a class="home" href="/?server=${encodeURIComponent(server.name)}">실시간 화면 보기</a>
    </nav>
    <section class="hero">
      <p class="eyebrow">리니지 클래식 ${escapeHtml(server.name)} 서버</p>
      <h1>${escapeHtml(server.name)} 아데나 시세</h1>
      <p class="lead">${escapeHtml(description)}</p>
      <div class="price">
        <div><span>현재 참고가</span><strong>${current}원</strong></div>
        <div class="change">${escapeHtml(change)}</div>
      </div>
      <a class="cta" href="/?server=${encodeURIComponent(server.name)}">${escapeHtml(server.name)} 실시간 시세 보기</a>
    </section>
    <section class="grid">
      <article class="card">
        <h2>${escapeHtml(server.name)} 서버 수집 가격</h2>
        <ul class="sources">${sourceHtml}</ul>
      </article>
      <article class="card bodycopy">
        <h2>확인할 내용</h2>
        <p>${escapeHtml(server.name)} 아데나 가격은 판매 목록, 수량, 수수료, 체결 가능 여부에 따라 달라질 수 있습니다.</p>
        <p>${brand}는 서버별 흐름을 빠르게 비교할 수 있도록 공개 거래 목록을 정리한 참고 정보를 제공합니다.</p>
      </article>
    </section>
    <section class="card" style="margin-top:18px">
      <h2>다른 서버 아데나 시세</h2>
      <div class="links">${topLinks}</div>
    </section>
  </main>
</body>
</html>
`;
};

const renderSitemap = (servers) => {
  const urls = [
    { loc: `${domain}/`, priority: "1.0" },
    ...servers.map((server) => ({ loc: `${domain}/${slugMap.get(server.name)}`, priority: "0.8" })),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (url) => `  <url>
    <loc>${url.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>${url.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>
`;
};

const main = async () => {
  const market = await parseMarketData();
  const servers = [...market.servers].sort((a, b) => Number(b.currentPrice || 0) - Number(a.currentPrice || 0));
  await mkdir(path.join(root, "scripts"), { recursive: true });

  for (const server of servers) {
    const slug = slugMap.get(server.name);
    if (!slug) throw new Error(`Missing slug for server: ${server.name}`);
    await writeFile(path.join(root, `${slug}.html`), renderServerPage(server, servers), "utf8");
  }

  await writeFile(path.join(root, "sitemap.xml"), renderSitemap(servers), "utf8");
  await writeFile(
    path.join(root, "robots.txt"),
    `User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /api/
Sitemap: ${domain}/sitemap.xml
`,
    "utf8",
  );

  console.log(`Generated ${servers.length} SEO pages, sitemap.xml, robots.txt`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
