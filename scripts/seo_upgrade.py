#!/usr/bin/env python3
"""
서버별 HTML 파일 SEO 일괄 강화 스크립트
- og:image / og:locale 추가
- twitter:image / twitter:title / twitter:description 추가
- robots 확장 지시자 업그레이드
- dateModified 2026-06-26 업데이트
- JSON-LD isPartOf URL 퓨니코드로 통일
"""

import os
import re

BASE_URL = "https://xn--910by1bssg76c75a.kr"
OG_IMAGE = f"{BASE_URL}/og-image.png"
TODAY = "2026-06-26"

SERVERS = {
    "oren":   {"ko": "오렌",     "title": "오렌 아데나 시세",     "desc_kw": "오렌 아데나 시세, 오렌 아덴 가격, 리니지 클래식 오렌"},
    "depo":   {"ko": "데포로쥬", "title": "데포로쥬 아데나 시세", "desc_kw": "데포로쥬 아데나 시세, 데포로쥬 아덴 가격, 리니지 클래식 데포로쥬"},
    "val":    {"ko": "발라카스", "title": "발라카스 아데나 시세", "desc_kw": "발라카스 아데나 시세, 발라카스 아덴 가격, 리니지 클래식 발라카스"},
    "isil":   {"ko": "이실로테", "title": "이실로테 아데나 시세", "desc_kw": "이실로테 아데나 시세, 이실로테 아덴 가격, 리니지 클래식 이실로테"},
    "jow":    {"ko": "조우",     "title": "조우 아데나 시세",     "desc_kw": "조우 아데나 시세, 조우 아덴 가격, 리니지 클래식 조우"},
    "zil":    {"ko": "질리언",   "title": "질리언 아데나 시세",   "desc_kw": "질리언 아데나 시세, 질리언 아덴 가격, 리니지 클래식 질리언"},
    "heine":  {"ko": "하이네",   "title": "하이네 아데나 시세",   "desc_kw": "하이네 아데나 시세, 하이네 아덴 가격, 리니지 클래식 하이네"},
    "hardin": {"ko": "하딘",     "title": "하딘 아데나 시세",     "desc_kw": "하딘 아데나 시세, 하딘 아덴 가격, 리니지 클래식 하딘"},
    "owen":   {"ko": "오웬",     "title": "오웬 아데나 시세",     "desc_kw": "오웬 아데나 시세, 오웬 아덴 가격, 리니지 클래식 오웬"},
    "keren":  {"ko": "케레니스", "title": "케레니스 아데나 시세", "desc_kw": "케레니스 아데나 시세, 케레니스 아덴 가격, 리니지 클래식 케레니스"},
    "chris":  {"ko": "크리스터", "title": "크리스터 아데나 시세", "desc_kw": "크리스터 아데나 시세, 크리스터 아덴 가격, 리니지 클래식 크리스터"},
    "ken":    {"ko": "켄라우헬", "title": "켄라우헬 아데나 시세", "desc_kw": "켄라우헬 아데나 시세, 켄라우헬 아덴 가격, 리니지 클래식 켄라우헬"},
    "aren":   {"ko": "아렌",     "title": "아렌 아데나 시세",     "desc_kw": "아렌 아데나 시세, 아렌 아덴 가격, 리니지 클래식 아렌"},
    "seb":    {"ko": "세베크",   "title": "세베크 아데나 시세",   "desc_kw": "세베크 아데나 시세, 세베크 아덴 가격, 리니지 클래식 세베크"},
    "ga":     {"ko": "가이안",   "title": "가이안 아데나 시세",   "desc_kw": "가이안 아데나 시세, 가이안 아덴 가격, 리니지 클래식 가이안"},
    "lindel": {"ko": "린델",     "title": "린델 아데나 시세",     "desc_kw": "린델 아데나 시세, 린델 아덴 가격, 리니지 클래식 린델"},
    "fia":    {"ko": "파이아그리오", "title": "파이아그리오 아데나 시세", "desc_kw": "파이아그리오 아데나 시세, 파이아그리오 아덴 가격, 리니지 클래식 파이아그리오"},
    "gun":    {"ko": "군터",     "title": "군터 아데나 시세",     "desc_kw": "군터 아데나 시세, 군터 아덴 가격, 리니지 클래식 군터"},
    "balsen": {"ko": "발센",     "title": "발센 아데나 시세",     "desc_kw": "발센 아데나 시세, 발센 아덴 가격, 리니지 클래식 발센"},
    "cas":    {"ko": "캐스파드", "title": "캐스파드 아데나 시세", "desc_kw": "캐스파드 아데나 시세, 캐스파드 아덴 가격, 리니지 클래식 캐스파드"},
    "duke":   {"ko": "듀크",     "title": "듀크 아데나 시세",     "desc_kw": "듀크 아데나 시세, 듀크 아덴 가격, 리니지 클래식 듀크"},
    "eva":    {"ko": "에바",     "title": "에바 아데나 시세",     "desc_kw": "에바 아데나 시세, 에바 아덴 가격, 리니지 클래식 에바"},
    "deken":  {"ko": "데컨",     "title": "데컨 아데나 시세",     "desc_kw": "데컨 아데나 시세, 데컨 아덴 가격, 리니지 클래식 데컨"},
    "ast":    {"ko": "아스트라", "title": "아스트라 아데나 시세", "desc_kw": "아스트라 아데나 시세, 아스트라 아덴 가격, 리니지 클래식 아스트라"},
    "sai":    {"ko": "사이",     "title": "사이 아데나 시세",     "desc_kw": "사이 아데나 시세, 사이 아덴 가격, 리니지 클래식 사이"},
    "loen":   {"ko": "로엔",     "title": "로엔 아데나 시세",     "desc_kw": "로엔 아데나 시세, 로엔 아덴 가격, 리니지 클래식 로엔"},
    "atun":   {"ko": "아투닌",   "title": "아투닌 아데나 시세",   "desc_kw": "아투닌 아데나 시세, 아투닌 아덴 가격, 리니지 클래식 아투닌"},
    "ein":    {"ko": "아인하사드","title": "아인하사드 아데나 시세","desc_kw": "아인하사드 아데나 시세, 아인하사드 아덴 가격, 리니지 클래식 아인하사드"},
    "map":    {"ko": "마프르",   "title": "마프르 아데나 시세",   "desc_kw": "마프르 아데나 시세, 마프르 아덴 가격, 리니지 클래식 마프르"},
}

WEBAPP_DIR = "/home/user/webapp"

def upgrade_server_page(slug, info):
    path = os.path.join(WEBAPP_DIR, f"{slug}.html")
    if not os.path.exists(path):
        print(f"  [SKIP] {slug}.html 없음")
        return

    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    page_url = f"{BASE_URL}/{slug}"
    ko_name = info["ko"]
    title = info["title"]
    desc = f"{ko_name} 아데나 시세를 오늘아덴에서 실시간 확인. 아이템베이·아이템매니아·바로템 3사 기준 {ko_name} 서버 아덴 가격과 변동 추이."
    keywords = f"리니지 아데나 시세, {info['desc_kw']}, 아이템베이 아데나, 아이템매니아 아데나, 바로템 아데나, 리니지 클래식 아데나"

    # ─── 1. robots 업그레이드
    html = re.sub(
        r'<meta name="robots" content="[^"]*">',
        '<meta name="robots" content="index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1">',
        html
    )

    # ─── 2. keywords 업데이트 (더 풍부하게)
    html = re.sub(
        r'<meta name="keywords" content="[^"]*">',
        f'<meta name="keywords" content="{keywords}">',
        html
    )

    # ─── 3. og:locale 추가 (없는 경우)
    if 'og:locale' not in html:
        html = html.replace(
            '<meta property="og:type" content="website">',
            '<meta property="og:type" content="website">\n  <meta property="og:locale" content="ko_KR">'
        )

    # ─── 4. og:image 추가 (없는 경우)
    if 'og:image' not in html:
        html = html.replace(
            f'<meta property="og:url" content="{page_url}">',
            f'<meta property="og:url" content="{page_url}">\n  <meta property="og:image" content="{OG_IMAGE}">\n  <meta property="og:image:width" content="1200">\n  <meta property="og:image:height" content="630">\n  <meta property="og:image:alt" content="오늘아데나 — {title}">'
        )

    # ─── 5. og:title / og:description 확장 (사이트명 포함)
    html = re.sub(
        r'<meta property="og:title" content="[^"]*">',
        f'<meta property="og:title" content="{title} | 아이템베이·아이템매니아·바로템 — 오늘아데나">',
        html
    )
    html = re.sub(
        r'<meta property="og:description" content="[^"]*">',
        f'<meta property="og:description" content="{desc}">',
        html
    )

    # ─── 6. twitter 카드 강화 (summary → summary_large_image)
    html = re.sub(
        r'<meta name="twitter:card" content="summary">',
        '<meta name="twitter:card" content="summary_large_image">',
        html
    )

    # ─── 7. twitter:title / twitter:description / twitter:image 추가 (없는 경우)
    if 'twitter:title' not in html:
        html = html.replace(
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:card" content="summary_large_image">\n  <meta name="twitter:title" content="{title} — 오늘아데나">\n  <meta name="twitter:description" content="{desc}">\n  <meta name="twitter:image" content="{OG_IMAGE}">'
        )

    # ─── 8. dateModified 업데이트
    html = html.replace('"dateModified":"2026-06-27"', f'"dateModified":"{TODAY}"')
    html = html.replace('"dateModified": "2026-06-27"', f'"dateModified": "{TODAY}"')

    # ─── 9. JSON-LD isPartOf URL 퓨니코드로 통일
    html = html.replace('"url":"https://오늘아덴.kr"', f'"url":"{BASE_URL}/"')
    html = html.replace('"item":"https://오늘아덴.kr"', f'"item":"{BASE_URL}/"')

    # ─── 10. <title> 사이트명 통일 (오늘아덴 → 오늘아데나)
    html = re.sub(
        r'<title>([^<]+) - 오늘아덴</title>',
        lambda m: f'<title>{m.group(1).strip()} — 오늘아데나</title>',
        html
    )

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"  [OK] {slug}.html 업그레이드 완료")


def main():
    print("=== 서버별 HTML SEO 일괄 강화 시작 ===\n")
    for slug, info in SERVERS.items():
        upgrade_server_page(slug, info)
    print("\n=== 완료 ===")


if __name__ == "__main__":
    main()
