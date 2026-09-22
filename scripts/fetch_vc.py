# -*- coding: utf-8 -*-
"""
AI 融资事件抓取脚本 (Spec: 010-ai-vc-watch)
数据源: TechCrunch Venture RSS (英文主源) / Hacker News Algolia API (英文补充, 支持历史回填)
存储:   SQLite (<项目根>/data/vc.db -> deal_event 表)
用法:   npm run fetch:vc 或直接 python3 scripts/fetch_vc.py
环境:   VC_DB_PATH 覆盖库路径

解析规则 (金额/轮次/赛道) 与 src/domain/vc.ts 一致, 双端契约见
docs/specs/010-ai-vc-watch/design.md 第五节 — 修改任一端必须同步另一端。
"""
import json
import os
import re
import sqlite3
import sys
import time
import traceback
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

import requests

BASE = Path(__file__).resolve().parent.parent
DB = Path(os.environ["VC_DB_PATH"]) if os.environ.get("VC_DB_PATH") else BASE / "data" / "vc.db"

UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

# ---------- 解析规则 (与 src/domain/vc.ts 同步, design 第五节) ----------

SECTOR_TAGS = [
    ("ai-infra", ["compute", "gpu", "chip", "datacenter", "data center", "infra", "inference", "training", "cluster", "semiconductor", "hpc", "fab", "cloud", "芯片", "算力", "数据中心", "半导体", "云计算", "基础设施"]),
    ("foundation-models", ["llm", "foundation model", "foundation-model", "gpt", "frontier", "language model", "multimodal", "model lab", "models lab", "openai", "anthropic", "大模型", "语言模型", "多模态", "模型"]),
    ("agents", ["agent", "autonomous", "copilot", "workflow", "orchestration", "智能体", "代理", "工作流"]),
    ("robotics", ["robot", "humanoid", "embodied", "drone", "manipulation", "机器人", "具身", "人形", "无人驾驶", "无人机"]),
    ("ai-app", ["app", "consumer", "saas", "enterprise", "vertical", "productivity", "customer service", "marketing", "recruiting", "background check", "due diligence", "hr", "应用", "消费", "企业", "垂直", "办公", "营销"]),
    ("devtools", ["devtools", "developer", "open source", "open-source", "sdk", "code", "debugging", "observability", "开发者", "开源", "代码", "编程", "开发工具"]),
    ("health", ["health", "healthcare", "bio", "drug", "clinical", "pharma", "biotech", "protein", "genomic", "医疗", "生物", "药物", "医药", "健康", "临床", "制药"]),
    ("fintech", ["fintech", "finance", "payment", "bank", "wealth", "insurance", "trading", "金融", "支付", "银行", "财富", "保险", "交易"]),
    ("data", ["dataset", "data", "synthetic", "labeling", "scraping", "数据", "标注"]),
    ("security", ["security", "safety", "alignment", "red team", "red-team", "cyber", "defense", "安全", "对齐", "合规", "风控", "防御"]),
]
CURRENCY_TO_USD = {"USD": 1.0, "EUR": 1.08, "GBP": 1.27, "CNY": 0.14}
CURRENCY_BY_SIGN = {"$": "USD", "€": "EUR", "£": "GBP", "¥": "CNY"}
CURRENCY_BY_WORD = {
    "美元": "USD", "人民币": "CNY", "元": "CNY", "欧元": "EUR",
    "英镑": "GBP", "日元": "JPY", "港币": "HKD", "港元": "HKD",
}
ROUND_ALIASES = [
    (re.compile(r"pre[- ]?seed", re.I), "Pre-seed"),
    (re.compile(r"angel|天使轮", re.I), "Angel"),
    (re.compile(r"seed|种子轮", re.I), "Seed"),
    (re.compile(r"series[ -]?a|a\s*轮", re.I), "A"),
    (re.compile(r"series[ -]?b|b\s*轮", re.I), "B"),
    (re.compile(r"series[ -]?c|c\s*轮", re.I), "C"),
    (re.compile(r"series[ -]?d|d\s*轮", re.I), "D"),
    (re.compile(r"series[ -]?e|e\s*轮", re.I), "E"),
    (re.compile(r"series[ -]?f|f\s*轮", re.I), "F"),
    (re.compile(r"growth|成长期", re.I), "Growth"),
    (re.compile(r"venture|风险投资", re.I), "Venture"),
    (re.compile(r"strategic|战略", re.I), "Strategic"),
    (re.compile(r"bridge|过桥", re.I), "Bridge"),
    (re.compile(r"grant|资助", re.I), "Grant"),
]
MAGNITUDE = {"K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}

# 融资标题动词: 公司名 = 动词前的部分
COMPANY_CUT = re.compile(
    r"\b(raises?|raised|secures?|secured|closes?|closed|announces?|announced|lands?|landed|"
    r"scores?|nabs?|picks?|grabs?|takes?|banks?|gets?|snags?|wins?|welcomes|funds?|"
    r"attracts?|collects?|pulls? in|takes in|banks)\b.*",
    re.I,
)


def clean_num(s):
    return float(s.replace(",", "")) if s else None


def parse_amount(text):
    """金额解析: $10M / €40M / £1.2B / ¥500M / $1,000,000 / 10亿元 / 5000万美元。
    取首个命中; 解析不到返回 None。"""
    if not text:
        return None
    sign = re.search(r"([$€£¥])\s*([\d][\d,]*\.?\d*)\s*([KMBT])", text)
    if sign:
        base = clean_num(sign.group(2))
        if base is None:
            return None
        return {"amount": round(base * MAGNITUDE.get(sign.group(3).upper(), 1e6), 2),
                "currency": CURRENCY_BY_SIGN.get(sign.group(1))}
    bare = re.search(r"([$€£¥])\s*([\d][\d,]*\.?\d*)", text)
    if bare:
        base = clean_num(bare.group(2))
        if base is not None:
            return {"amount": round(base, 2), "currency": CURRENCY_BY_SIGN.get(bare.group(1))}
    cjk = re.search(r"([\d][\d,]*\.?\d*)\s*(亿|万)\s*(美元|人民币|元|欧元|英镑|日元|港币|港元)", text)
    if cjk:
        base = clean_num(cjk.group(1))
        if base is not None:
            amount = base * (1e8 if cjk.group(2) == "亿" else 1e4)
            return {"amount": round(amount, 2), "currency": CURRENCY_BY_WORD.get(cjk.group(3))}
    return None


def normalize_round(text):
    if not text:
        return None
    for pattern, value in ROUND_ALIASES:
        if pattern.search(text):
            return value
    return None


def classify_sector(text):
    if not text:
        return "unclassified"
    lower = text.lower()
    best, best_score = "unclassified", 0
    for sector, keywords in SECTOR_TAGS:
        score = sum(1 for kw in keywords if kw in lower)
        if score > best_score:
            best, best_score = sector, score
    return best


def to_usd(amount, currency):
    rate = CURRENCY_TO_USD.get(currency)
    if rate is None:
        return None
    return round(amount * rate, 2)


# 融资事件信号词: 标题必须命中其一才收录。
# TechCrunch Venture RSS / HN 均混入促销、观点与讨论帖, 无信号词即噪声 → 过滤。
FUNDING_SIGNAL = re.compile(
    r"\b(raises?|raised|secures?|secured|lands?|landed|closes?|closed|snags?|scores?|"
    r"grabs?|nabs?|banks?|welcomes|funding|funds|financing|finances|invests?|"
    r"valuation|ipo|acquires?|acquired|acquisition|acqui-?hire|m&a)\b",
    re.I,
)
# 金额或轮次信号: 与信号词叠加, 排除「讨论 funding 但非融资事件」的帖子 (如 Ask HN: 为什么没人 funding…)
AMOUNT_PAT = re.compile(r"[$€£¥]\s*[\d]|[\d，,]\s*(亿|万)")
SERIES_PAT = re.compile(r"\bseries [a-z]|[A-F]\s*轮|seed|angel|pre[- ]?seed", re.I)


def is_funding_event(title):
    """融资事件判定: 标题命中融资信号词, 且含金额或轮次 (过滤促销/观点/讨论帖)。"""
    if not title or not FUNDING_SIGNAL.search(title):
        return False
    if re.search(r"raises? prices", title, re.I):
        return False  # 「Apple raises prices by $200」是价格新闻, 非融资
    return bool(AMOUNT_PAT.search(title) or SERIES_PAT.search(title))


def extract_company(title):
    """公司名 = 融资动词前的部分 (如 'Morphotonics raises €40M' → 'Morphotonics'; 'Oura's $2.2B IPO' → 'Oura')"""
    m = COMPANY_CUT.search(title)
    head = (title[: m.start()] if m else title).strip(" :–—|,·.")
    head = re.sub(r"['’]s$", "", head).strip()
    return head[:80] or title[:40]


def deal_event(source, source_id, title, url, announced, text, amt):
    return {
        "id": f"{source}:{source_id}",
        "company": extract_company(title),
        "round": normalize_round(text),
        "amount": amt["amount"] if amt else None,
        "currency": amt["currency"] if amt else None,
        "amount_usd": to_usd(amt["amount"], amt["currency"]) if amt else None,
        "announced_at": announced,
        "sector": classify_sector(text),
        "source": source,
        "source_id": source_id,
        "title": title,
        "url": url,
        "notes": None,
    }


# ---------- 源提取器 ----------

TC_FEED = "https://techcrunch.com/category/venture/feed/"


def extract_techcrunch():
    """TechCrunch Venture RSS — 英文融资新闻主源 (WordPress feed, 小时级)。
    RSS 只返回最近条目, 无长历史 → 全量取回 + 幂等覆盖 (design 决策 8)。"""
    resp = requests.get(TC_FEED, timeout=25, headers=UA)
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    events = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        guid = (item.findtext("guid") or link or "").strip()
        desc = (item.findtext("description") or "").strip()
        pub = item.findtext("pubDate") or ""
        if not title or not guid:
            continue
        try:
            dt = parsedate_to_datetime(pub)
            announced = dt.astimezone(timezone.utc).strftime("%Y-%m-%d")
        except Exception:
            continue
        text = f"{title} {desc}"
        if not is_funding_event(title):
            continue
        amt = parse_amount(title) or parse_amount(text)
        events.append(deal_event("techcrunch", guid, title, link, announced, text, amt))
    return events


HN_API = "https://hn.algolia.com/api/v1/search_by_date"
# 每个 query 均要求标题同时含全部词 (Algolia 默认 AND) → 保证「AI + 融资」双命中
HN_QUERIES = ["AI raises", "AI funding", "AI raised", "LLM raises", "model raises", "agent raises"]
HN_PAGES_PER_QUERY = 3
# AI 相关性过滤: 标题命中任一关键词才保留 (板块聚焦 AI, 避免 HN 通用融资噪声)
AI_KEYWORDS = [
    "ai", "llm", "gpt", "ml", "machine", "model", "agent", "robot", "humanoid",
    "neural", "openai", "anthropic", "deepmind", "generative", "copilot",
    "autonomous", "gpu", "chip", "semiconductor", "inference", "cluster",
]


def ai_match(title):
    lower = title.lower()
    return any(kw in lower for kw in AI_KEYWORDS)


def extract_hn(since_ts):
    """Hacker News Algolia — 英文补充源, 支持历史回填 (design 决策 8)。
    numericFilters 增量: 首次回填近 90 天, 之后只拉上次之后的新条目。"""
    out = {}
    for q in HN_QUERIES:
        page = 0
        while page < HN_PAGES_PER_QUERY:
            params = {
                "query": q,
                "tags": "story",
                "restrictSearchableAttributes": "title",
                "hitsPerPage": 100,
                "page": page,
                "numericFilters": f"created_at_i>{int(since_ts)}",
            }
            resp = requests.get(HN_API, params=params, timeout=25, headers=UA)
            resp.raise_for_status()
            data = resp.json()
            for h in data.get("hits") or []:
                oid = str(h.get("objectID") or "")
                title = (h.get("title") or "").strip()
                if not oid or not title or not ai_match(title) or not is_funding_event(title):
                    continue
                url = h.get("url") or f"https://news.ycombinator.com/item?id={oid}"
                announced = (h.get("created_at") or "")[:10]
                if not announced:
                    continue
                amt = parse_amount(title)
                out[oid] = deal_event("hn", oid, title, url, announced, title, amt)
            page += 1
            if page >= int(data.get("nbPages") or 1):
                break
    return list(out.values())


# ---------- 建表与写入 ----------

DDL = [
    """CREATE TABLE IF NOT EXISTS deal_event (
        id TEXT PRIMARY KEY, company TEXT NOT NULL, round TEXT, amount REAL,
        currency TEXT, amount_usd REAL, announced_at TEXT NOT NULL,
        sector TEXT NOT NULL DEFAULT 'unclassified', source TEXT NOT NULL,
        source_id TEXT NOT NULL, title TEXT, url TEXT, notes TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""",
    "CREATE INDEX IF NOT EXISTS idx_deal_announced ON deal_event (announced_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_deal_sector ON deal_event (sector)",
    "CREATE INDEX IF NOT EXISTS idx_deal_source ON deal_event (source)",
    "CREATE INDEX IF NOT EXISTS idx_deal_url ON deal_event (url)",
]

INSERT_SQL = (
    "INSERT OR REPLACE INTO deal_event (id, company, round, amount, currency, amount_usd,"
    " announced_at, sector, source, source_id, title, url, notes, created_at, updated_at)"
    " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
)


def upsert(conn, source, events):
    if not events:
        print("  [EMPTY] 无有效数据")
        return "empty"
    new_max = max(e["announced_at"] for e in events)
    row = conn.execute("SELECT MAX(announced_at) FROM deal_event WHERE source = ?", (source,)).fetchone()
    db_max = row[0] if row and row[0] else None
    if db_max and new_max <= db_max:
        print(f"  [SKIP] 数据已最新 (库 {db_max} >= 源 {new_max}), {len(events)} 行未变更")
        return "skip"
    now = datetime.now().isoformat(timespec="seconds")
    conn.executemany(
        INSERT_SQL,
        [(e["id"], e["company"], e["round"], e["amount"], e["currency"], e["amount_usd"],
          e["announced_at"], e["sector"], e["source"], e["source_id"], e["title"],
          e["url"], e["notes"], now, now) for e in events],
    )
    conn.commit()
    print(f"  [OK] {len(events)} 条, 最新 {new_max}")
    return "ok"


def fetch_with_retry(fn, key, retries=3):
    """网络源瞬时故障退避重试后再判失败 (只读请求, 重试无副作用)。"""
    last = None
    for attempt in range(1, retries + 1):
        try:
            return fn()
        except Exception as e:
            last = e
            if attempt < retries:
                wait = 2 * attempt
                print(f"  [RETRY {attempt}/{retries - 1}] {type(e).__name__}, {wait}s 后重试")
                time.sleep(wait)
    raise last


def main():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    for ddl in DDL:
        conn.execute(ddl)
    conn.commit()
    print(f"数据库: {DB}")

    # HN 增量下界: 库内 hn 源最大日期 - 1 天 (重叠一天防跨时区漏采, 幂等去重兜底)
    row = conn.execute("SELECT MAX(announced_at) FROM deal_event WHERE source = 'hn'").fetchone()
    if row and row[0]:
        since = (datetime.strptime(row[0], "%Y-%m-%d") - timedelta(days=1)).replace(tzinfo=timezone.utc)
    else:
        since = datetime.now(timezone.utc) - timedelta(days=90)
    since_ts = int(since.timestamp())
    print(f"HN 增量起点: {since.strftime('%Y-%m-%d')}")

    sources = [
        ("techcrunch", lambda: extract_techcrunch(), None),
        ("hn", lambda: extract_hn(since_ts), None),
    ]
    ok = skip = empty = fail = 0
    failures = []
    total = len(sources)

    # Spec: 010 — 逐来源输出机器可读进度行 (协议同 spec 003/009)
    for i, (name, fn, _) in enumerate(sources, 1):
        print(f"[{name}]")
        status = "ok"
        try:
            events = fetch_with_retry(fn, name)
            status = upsert(conn, name, events)
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                empty += 1
        except Exception:
            status = "fail"
            failures.append({"key": name, "name": name,
                             "error": traceback.format_exc(limit=1).strip().splitlines()[-1][:160]})
            fail += 1
            print(f"  [FAIL]\n{traceback.format_exc(limit=1)}")
        print("@@PROGRESS " + json.dumps(
            {"done": i, "total": total, "key": name, "name": name, "status": status},
            ensure_ascii=False), flush=True)

    print(f"\n完成: 写入 {ok}, 已最新 {skip}, 空 {empty}, 失败 {fail}")
    print("@@DONE " + json.dumps(
        {"ok": ok, "skip": skip, "empty": empty, "fail": fail, "failures": failures},
        ensure_ascii=False), flush=True)
    conn.close()
    return 0 if (ok + skip) >= 1 else 1


if __name__ == "__main__":
    sys.exit(main())
