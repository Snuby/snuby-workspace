# -*- coding: utf-8 -*-
"""
资产行情 K 线抓取脚本 (Spec: 009-market-quotes)
数据源: COMEX 期货(akshare) / Binance 公开 API / 新浪·东财指数(akshare) / 统计局 70 城房价(派生)
存储:   SQLite (<项目根>/data/market.db -> asset / kline 表)
用法:   npm run fetch:market 或 直接 python3 scripts/fetch_market.py
环境:   MARKET_DB_PATH 覆盖库路径; EXCLUDE_CATEGORIES=crypto 跳过境外源(网络受限时降级)
"""
import json
import os
import sqlite3
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

import akshare as ak
import requests

BASE = Path(__file__).resolve().parent.parent
DB = Path(os.environ["MARKET_DB_PATH"]) if os.environ.get("MARKET_DB_PATH") else BASE / "data" / "market.db"

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
BINANCE_KLINES = "https://api.binance.com/api/v3/klines"


def clean(v):
    s = str(v).strip().replace("%", "").replace(",", "")
    if s.lower() in ("nan", "none", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def candle(d, o, h, l, c, v):
    """归一为 (date, open, high, low, close, volume); close 缺失则整条丢弃"""
    c = clean(c)
    if not d or c is None:
        return None
    return (str(d)[:10], clean(o), clean(h), clean(l), c, clean(v))


# ---------- 各资产提取器: 返回 [(date, open, high, low, close, volume), ...] ----------

def extract_comex(symbol):
    """COMEX 期货 (GC 黄金 / SI 白银)。源 volume 列恒为 0, 按不可用处理 (has_volume=0)"""
    df = ak.futures_foreign_hist(symbol=symbol)
    rows = [candle(r["date"], r.get("open"), r.get("high"), r.get("low"), r.get("close"), None)
            for _, r in df.iterrows()]
    return [r for r in rows if r]


def extract_binance(symbol, max_pages=10):
    """Binance 日线, 按 endTime 向前分页取全历史。
    K 线数组格式: [openTime(ms), open, high, low, close, volume, closeTime, ...]"""
    out, end = [], None
    for _ in range(max_pages):
        params = {"symbol": symbol, "interval": "1d", "limit": 1000}
        if end:
            params["endTime"] = end
        resp = requests.get(BINANCE_KLINES, params=params, timeout=20, headers=UA)
        resp.raise_for_status()
        data = resp.json()
        if not data:
            break
        for k in data:
            d = datetime.fromtimestamp(k[0] / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
            rows = candle(d, k[1], k[2], k[3], k[4], k[5])
            if rows:
                out.append(rows)
        end = data[0][0] - 1
        if len(data) < 1000:
            break
    dedup = {r[0]: r for r in out}
    return [dedup[d] for d in sorted(dedup)]


def extract_us_index(symbol):
    """美股指数 (新浪): .DJI 道指 / .IXIC 纳指"""
    df = ak.index_us_stock_sina(symbol=symbol)
    rows = [candle(r["date"], r.get("open"), r.get("high"), r.get("low"), r.get("close"), r.get("volume"))
            for _, r in df.iterrows()]
    return [r for r in rows if r]


def extract_hk_index():
    """恒生指数。主源东财 (1990 年起, 收盘列名 latest 须重命名, 无成交量);
    东财 push2 端点间歇性不可达 (2026-09-22 实测), 异常时降级新浪
    (klc2 接口, 2013-08 起, 库内已有全历史时仅补增量, 不受影响)。"""
    try:
        df = ak.stock_hk_index_daily_em(symbol="HSI")
        return [candle(r["date"], r.get("open"), r.get("high"), r.get("low"), r.get("latest"), None)
                for _, r in df.iterrows()]
    except Exception:
        df = ak.stock_hk_index_daily_sina(symbol="HSI")
        return [candle(r["date"], r.get("open"), r.get("high"), r.get("low"), r.get("close"), None)
                for _, r in df.iterrows()]


def extract_cn_index():
    """上证指数。主源东财, 异常时降级新浪 (sh000001, 字段结构相同)。"""
    try:
        df = ak.stock_zh_index_daily_em(symbol="sh000001")
    except Exception:
        df = ak.stock_zh_index_daily(symbol="sh000001")
    rows = [candle(r["date"], r.get("open"), r.get("high"), r.get("low"), r.get("close"), r.get("volume"))
            for _, r in df.iterrows()]
    return [r for r in rows if r]


_HOUSE_DF = None


def _house_df():
    """70 城房价源在一次运行中只请求一次 (北京/上海共用)"""
    global _HOUSE_DF
    if _HOUSE_DF is None:
        _HOUSE_DF = ak.macro_china_new_house_price()
    return _HOUSE_DF


def extract_house_city(city):
    """北京/上海房价水平序列 (spec 009 design 1.4)。

    免费源没有成交均价, 只有 70 城价格指数, 且源「定基」列最新为 NaN。
    改用环比指数连乘构造: 水平[t] = 水平[t-1] * 环比[t] / 100, 基准 = 100。
    产出为价格变动指数 (非绝对价位), 无 OHLC, 月频。
    """
    df = _house_df()
    sub = df[df["城市"] == city].sort_values("日期")
    level, rows = 100.0, []
    for _, r in sub.iterrows():
        v = clean(r.get("新建商品住宅价格指数-环比"))
        if v is None:
            continue
        level *= v / 100.0
        rows.append((str(r["日期"])[:10], None, None, None, round(level, 2), None))
    return rows


# ---------- 资产清单 (spec 009 design 表 1.1) ----------

ASSETS = [
    dict(symbol="gold", name="黄金", category="metal", unit="美元/盎司",
         source="comex", base_freq="D", precision=2, has_ohlc=1, has_volume=0,
         note="COMEX 黄金期货主力连续, 美元/盎司",
         fn=lambda: extract_comex("GC")),
    dict(symbol="silver", name="白银", category="metal", unit="美元/盎司",
         source="comex", base_freq="D", precision=2, has_ohlc=1, has_volume=0,
         note="COMEX 白银期货主力连续, 美元/盎司",
         fn=lambda: extract_comex("SI")),
    dict(symbol="btc", name="比特币", category="crypto", unit="USDT",
         source="binance", base_freq="D", precision=0, has_ohlc=1, has_volume=1,
         note="Binance BTC/USDT 日线",
         fn=lambda: extract_binance("BTCUSDT")),
    dict(symbol="eth", name="以太坊", category="crypto", unit="USDT",
         source="binance", base_freq="D", precision=2, has_ohlc=1, has_volume=1,
         note="Binance ETH/USDT 日线",
         fn=lambda: extract_binance("ETHUSDT")),
    dict(symbol="doge", name="狗狗币", category="crypto", unit="USDT",
         source="binance", base_freq="D", precision=4, has_ohlc=1, has_volume=1,
         note="Binance DOGE/USDT 日线",
         fn=lambda: extract_binance("DOGEUSDT")),
    dict(symbol="dji", name="道琼斯", category="us", unit="点",
         source="sina_us", base_freq="D", precision=2, has_ohlc=1, has_volume=1,
         note="道琼斯工业平均指数, 收盘点位",
         fn=lambda: extract_us_index(".DJI")),
    dict(symbol="ixic", name="纳斯达克", category="us", unit="点",
         source="sina_us", base_freq="D", precision=2, has_ohlc=1, has_volume=1,
         note="纳斯达克综合指数, 收盘点位",
         fn=lambda: extract_us_index(".IXIC")),
    dict(symbol="hsi", name="恒生指数", category="hk", unit="点",
         source="em_hk", base_freq="D", precision=2, has_ohlc=1, has_volume=0,
         note="中国香港恒生指数, 收盘点位",
         fn=lambda: extract_hk_index()),
    dict(symbol="sse", name="上证指数", category="cn", unit="点",
         source="em_cn", base_freq="D", precision=2, has_ohlc=1, has_volume=1,
         note="上海证券交易所综合股价指数, 收盘点位",
         fn=lambda: extract_cn_index()),
    dict(symbol="bj_house", name="北京房价", category="realestate", unit="价格指数",
         source="nbs70", base_freq="M", precision=1, has_ohlc=0, has_volume=0,
         note="70 城新建商品住宅价格指数 (环比连乘, 起点 2011-01 = 100), 衡量价格变动幅度, 非成交均价",
         fn=lambda: extract_house_city("北京")),
    dict(symbol="sh_house", name="上海房价", category="realestate", unit="价格指数",
         source="nbs70", base_freq="M", precision=1, has_ohlc=0, has_volume=0,
         note="70 城新建商品住宅价格指数 (环比连乘, 起点 2011-01 = 100), 衡量价格变动幅度, 非成交均价",
         fn=lambda: extract_house_city("上海")),
]


# ---------- 建表与写入 ----------

DDL = [
    """CREATE TABLE IF NOT EXISTS asset (
        symbol TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL,
        unit TEXT NOT NULL, source TEXT NOT NULL, base_freq TEXT NOT NULL,
        precision INTEGER NOT NULL, has_ohlc INTEGER NOT NULL, has_volume INTEGER NOT NULL,
        note TEXT, first_date TEXT, last_date TEXT, updated_at TEXT NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS kline (
        symbol TEXT NOT NULL, date TEXT NOT NULL, open REAL, high REAL, low REAL,
        close REAL NOT NULL, volume REAL, PRIMARY KEY (symbol, date))""",
    "CREATE INDEX IF NOT EXISTS idx_kline_symbol_date ON kline (symbol, date)",
]


def put_asset(conn, a, rows):
    rows = [r for r in rows if r and r[0] and r[4] is not None]
    if not rows:
        print("  [EMPTY] 无有效数据")
        return "empty"
    rows.sort(key=lambda r: r[0])
    first_date, last_date = rows[0][0], rows[-1][0]

    prev = conn.execute("SELECT last_date FROM asset WHERE symbol = ?", (a["symbol"],)).fetchone()
    prev_last = prev[0] if prev else None
    if prev_last and last_date <= prev_last:
        print(f"  [SKIP] 数据已最新 (库 {prev_last} >= 源 {last_date}), {len(rows)} 行未变更")
        return "skip"

    conn.executemany(
        "INSERT OR REPLACE INTO kline (symbol, date, open, high, low, close, volume) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(a["symbol"], *r) for r in rows],
    )
    conn.execute(
        "INSERT OR REPLACE INTO asset (symbol, name, category, unit, source, base_freq, precision,"
        " has_ohlc, has_volume, note, first_date, last_date, updated_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (a["symbol"], a["name"], a["category"], a["unit"], a["source"], a["base_freq"],
         a["precision"], a["has_ohlc"], a["has_volume"], a["note"], first_date, last_date,
         datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    print(f"  [OK] {len(rows)} 条, 区间 {first_date} ~ {last_date}, 最新收 {rows[-1][4]}")
    return "ok"


def fetch_with_retry(fn, symbol, retries=3):
    """网络源经代理时通时断 (东财 push2 端点实测), 瞬时故障退避重试后再判失败。
    提取器均为只读请求, 重试无副作用。"""
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

    exclude = {c.strip() for c in os.environ.get("EXCLUDE_CATEGORIES", "").split(",") if c.strip()}
    if exclude:
        print(f"已排除类别: {', '.join(sorted(exclude))}")

    tasks = [a for a in ASSETS if a["category"] not in exclude]
    ok = skip = empty = fail = 0
    failures = []
    total = len(tasks)

    # Spec: 009 / 003-manual-fetch — 逐资产输出机器可读进度行
    for i, a in enumerate(tasks, 1):
        print(f"[{a['symbol']}] {a['name']}")
        status = "ok"
        try:
            status = put_asset(conn, a, fetch_with_retry(a["fn"], a["symbol"]))
            if status == "ok":
                ok += 1
            elif status == "skip":
                skip += 1
            else:
                empty += 1
        except Exception:
            status = "fail"
            failures.append({"key": a["symbol"], "name": a["name"],
                             "error": traceback.format_exc(limit=1).strip().splitlines()[-1][:160]})
            fail += 1
            print(f"  [FAIL]\n{traceback.format_exc(limit=1)}")
        print("@@PROGRESS " + json.dumps(
            {"done": i, "total": total, "key": a["symbol"], "name": a["name"], "status": status},
            ensure_ascii=False), flush=True)

    print(f"\n完成: 写入 {ok}, 已最新 {skip}, 空 {empty}, 失败 {fail}")
    print("@@DONE " + json.dumps(
        {"ok": ok, "skip": skip, "empty": empty, "fail": fail, "failures": failures},
        ensure_ascii=False), flush=True)
    conn.close()
    return 0 if (ok + skip) >= 5 else 1


if __name__ == "__main__":
    sys.exit(main())
