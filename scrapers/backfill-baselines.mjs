/**
 * backfill-baselines.mjs
 *
 * noonBaselines의 가장 오래된 날짜(2026-06-18)를 기준으로
 * 14일 전(2026-06-04)까지 역방향으로 자연스러운 가격 변동을 생성합니다.
 *
 * 실행: node scrapers/backfill-baselines.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const OUT_FILE = resolve("data", "market-data.js");

// ── 파일 읽기 ──────────────────────────────────────────────────────────────
const js = await readFile(OUT_FILE, "utf8");
const data = JSON.parse(
  js.replace(/^window\.MARKET_DATA\s*=\s*/, "").replace(/;\s*$/, "")
);

data.noonBaselines = data.noonBaselines || {};

// ── 현재 가장 오래된 날짜 확인 ─────────────────────────────────────────────
const existingDates = Object.keys(data.noonBaselines).sort();
const oldestDate = existingDates[0]; // "2026-06-18"

if (!oldestDate) {
  console.error("noonBaselines가 비어 있습니다. 먼저 기준 데이터를 입력하세요.");
  process.exit(1);
}

console.log(`현재 가장 오래된 날짜: ${oldestDate}`);
console.log(`역산 목표: 14일 전 (${addDays(oldestDate, -14)}) 까지`);

// ── 역산 대상 날짜 목록 생성 (oldestDate 기준 1~14일 전) ───────────────────
const datesToFill = [];
for (let i = 1; i <= 14; i++) {
  const d = addDays(oldestDate, -i);
  if (!data.noonBaselines[d]) {
    datesToFill.push({ date: d, daysBack: i });
  } else {
    console.log(`  ⏭  ${d} 이미 존재 — 건너뜀`);
  }
}

if (datesToFill.length === 0) {
  console.log("채울 날짜가 없습니다. 이미 모두 존재합니다.");
  process.exit(0);
}

// ── 각 서버별 역산 ─────────────────────────────────────────────────────────
// 전략:
//   - 최근 7일(2026-06-18~24) 실제 데이터에서 서버별 평균 일일 변동률을 계산
//   - 그 트렌드를 이용해 역방향(미래→과거)으로 역산
//   - 단순 역산 외에 서버 인덱스·날짜 시드 기반의 ±노이즈 추가로 자연스럽게 표현

const serverNames = Object.keys(data.noonBaselines[oldestDate]);
console.log(`\n서버 수: ${serverNames.length}개`);

// 서버별 평균 일일 변동률 계산 (최근 실제 데이터 기반)
const serverTrends = {}; // 양수 = 상승 추세, 음수 = 하락 추세
for (const name of serverNames) {
  const prices = existingDates
    .map((d) => data.noonBaselines[d]?.[name])
    .filter((p) => p != null && p > 0);

  if (prices.length >= 2) {
    // 가장 오래된 → 가장 최근 방향의 평균 일일 변동률
    const oldest = prices[0];
    const newest = prices[prices.length - 1];
    const days = prices.length - 1;
    // (newest - oldest) / oldest / days  → 일평균 변동률
    serverTrends[name] = (newest - oldest) / oldest / days;
  } else {
    serverTrends[name] = 0;
  }
}

// ── 날짜별 역산 실행 (1일 전 → 14일 전 순으로, 직전 날짜를 연쇄 base로 사용) ──
// datesToFill은 daysBack 오름차순(1부터): 1일 전부터 → 14일 전 순으로 처리
// 이전 단계에서 생성한 데이터를 다음 단계 base로 사용하므로 역방향 체인 동작

// 각 날짜에 대해 "그 날짜 다음날" 가격을 base로 역산
for (const { date, daysBack } of datesToFill) {
  const nextDate = addDays(date, 1);
  // 이미 생성된 데이터(포함 방금 생성한 것)를 base로 사용
  const baseBaseline = data.noonBaselines[nextDate];

  if (!baseBaseline) {
    console.warn(`  ⚠  ${nextDate} 기준 데이터 없음 — ${date} 건너뜀`);
    continue;
  }

  data.noonBaselines[date] = {};

  for (const [idx, name] of serverNames.entries()) {
    const basePrice = baseBaseline[name];
    if (!basePrice || basePrice <= 0) continue;

    // 역산: 과거 = 현재 / (1 + 일일변동률)
    // 트렌드를 역방향으로 적용 + 서버/날짜 고유 노이즈
    const trend = serverTrends[name] || 0;
    // 트렌드 역방향 (과거일수록 반대 방향)
    const reversedTrend = -trend;

    // 결정론적 노이즈 (seed: 서버인덱스 × 날짜숫자)
    const dateSeed = parseInt(date.replace(/-/g, ""), 10);
    const noiseSeed = (idx * 31 + dateSeed) % 100;
    // -0.8% ~ +0.8% 범위 노이즈
    const noise = (noiseSeed - 50) / 50 * 0.008;

    // 적용할 일일 변동률 (역방향 트렌드 + 노이즈)
    // 절댓값을 0.3%~1.5% 사이로 클램핑해 너무 급격한 변동 방지
    const rawRate = reversedTrend + noise;
    const clampedRate = clamp(rawRate, -0.015, 0.015);

    const pastPrice = Math.round(basePrice / (1 + clampedRate));

    data.noonBaselines[date][name] = pastPrice;
  }

  console.log(
    `  ✅ ${date} 생성 완료 — 오렌: ${data.noonBaselines[date]["오렌"]}, ` +
    `데포로쥬: ${data.noonBaselines[date]["데포로쥬"]}`
  );
}

// ── noonBaselines 날짜 순으로 정렬 ────────────────────────────────────────
const sorted = Object.keys(data.noonBaselines).sort();
const reordered = {};
for (const d of sorted) reordered[d] = data.noonBaselines[d];
data.noonBaselines = reordered;

// ── 저장 ──────────────────────────────────────────────────────────────────
await writeFile(
  OUT_FILE,
  `window.MARKET_DATA = ${JSON.stringify(data, null, 2)};\n`,
  "utf8"
);

const finalDates = Object.keys(data.noonBaselines).sort();
console.log(
  `\n저장 완료! noonBaselines 범위: ${finalDates[0]} ~ ${finalDates[finalDates.length - 1]} (${finalDates.length}일치)`
);

// ── 유틸 함수 ─────────────────────────────────────────────────────────────
function addDays(dateStr, days) {
  // "YYYY-MM-DD" 문자열 → Date → ±days → "YYYY-MM-DD"
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}
