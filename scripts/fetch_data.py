# -*- coding: utf-8 -*-
"""
中国宏观经济数据抓取脚本 (Spec: 001-workbench-mvp, US-3)
数据源: akshare (国家统计局/中国人民银行/海关总署/东方财富数据中心公开数据)
存储:   SQLite (<项目根>/data/china_economy.db -> series / meta 表)
用法:   npm run fetch 或 直接 python3 scripts/fetch_data.py
"""
import json
import sqlite3
import sys
import traceback
from datetime import datetime
from pathlib import Path

import akshare as ak

# 相对脚本自身定位项目根 (scripts/ 的上一级)
BASE = Path(__file__).resolve().parent.parent
DB = BASE / "data" / "china_economy.db"

META_ROWS = []


def put(conn, key, name, unit, freq, dim, rows):
    """rows: [(date_str, value), ...]"""
    rows = [(d, v) for d, v in rows if d and v is not None]
    if not rows:
        print("  [EMPTY] 无有效数据")
        return False
    conn.executemany(
        "INSERT OR REPLACE INTO series (indicator, date, value) VALUES (?, ?, ?)",
        [(key, d, v) for d, v in rows],
    )
    conn.execute(
        "INSERT OR REPLACE INTO meta (indicator, name, unit, freq, dim, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        (key, name, unit, freq, dim, datetime.now().isoformat(timespec="seconds")),
    )
    conn.commit()
    print(f"  [OK] {len(rows)} 条, 最新: {rows[-1][0]} = {rows[-1][1]}")
    return True


def clean(v):
    s = str(v).strip().replace("%", "").replace(",", "")
    if s.lower() in ("nan", "none", ""):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ---------- 各类提取器 ----------

def month_to_date(s):
    s = str(s).strip()
    if s.isdigit() and len(s) == 6:  # 纯数字格式如 202604
        return f"{s[:4]}-{s[4:6]}"
    return s.replace("年", "-").replace("月份", "").replace("月", "")


def quarter_to_date(s):
    """季度映射到季度末月份: 第1季度->03, 第1-2季度->06, 第1-3季度->09, 第1-4季度->12"""
    s = str(s)
    if "第" not in s or "季度" not in s:
        return None
    y = s[:4]
    span = s[s.index("第") + 1:s.index("季度")]
    m = {"1": "03", "1-2": "06", "1-3": "09", "1-4": "12"}.get(span)
    return f"{y}-{m}" if m else None


def extract_report(func_name):
    """东方财富报告式接口: 商品/日期/今值/预测值/前值"""
    df = getattr(ak, func_name)()
    return [(str(r["日期"]), clean(r["今值"])) for _, r in df.iterrows()
            if r.get("今值") is not None]


def extract_gdp():
    """国家统计局官方季度 GDP: 总量及第二/第三产业同比"""
    df = ak.macro_china_gdp()
    out_g, out_2, out_3 = [], [], []
    for _, r in df.iterrows():
        d = quarter_to_date(r["季度"])
        if not d:
            continue
        vg = clean(r.get("国内生产总值-同比增长"))
        v2 = clean(r.get("第二产业-同比增长"))
        v3 = clean(r.get("第三产业-同比增长"))
        if vg is not None:
            out_g.append((d, vg))
        if v2 is not None:
            out_2.append((d, v2))
        if v3 is not None:
            out_3.append((d, v3))
    return out_g, out_2, out_3


def extract_new_loans():
    """新增人民币贷款当月值(亿元)"""
    df = ak.macro_china_new_financial_credit()
    return [(month_to_date(r["月份"]), clean(r.get("当月"))) for _, r in df.iterrows()]


def extract_czsr():
    """财政收入当月同比"""
    df = ak.macro_china_czsr()
    return [(month_to_date(r["月份"]), clean(r.get("当月-同比增长"))) for _, r in df.iterrows()]


def extract_boom():
    """企业景气指数(季度)"""
    df = ak.macro_china_enterprise_boom_index()
    return [(d, v) for d, v in
            ((quarter_to_date(r["季度"]), clean(r.get("企业景气指数-指数")))
             for _, r in df.iterrows()) if d and v is not None]


def extract_money_supply():
    df = ak.macro_china_money_supply()
    out_m1, out_m2 = [], []
    for _, r in df.iterrows():
        d = str(r["月份"]).replace("年", "-").replace("月份", "").replace("月", "")
        out_m1.append((d, clean(r.get("货币(M1)-同比增长"))))
        out_m2.append((d, clean(r.get("货币和准货币(M2)-同比增长"))))
    return out_m1, out_m2


def extract_lpr():
    df = ak.macro_china_lpr()
    out1, out5 = [], []
    for _, r in df.iterrows():
        d = str(r["TRADE_DATE"])
        v1, v5 = clean(r.get("LPR1Y")), clean(r.get("LPR5Y"))
        if v1 is not None:
            out1.append((d, v1))
        if v5 is not None:
            out5.append((d, v5))
    return out1, out5


def extract_hgjck():
    df = ak.macro_china_hgjck()
    exp, imp, bal = [], [], []
    for _, r in df.iterrows():
        d = str(r["月份"]).replace("年", "-").replace("月份", "").replace("月", "")
        e_yoy, i_yoy = clean(r.get("当月出口额-同比增长")), clean(r.get("当月进口额-同比增长"))
        e_amt, i_amt = clean(r.get("当月出口额-金额")), clean(r.get("当月进口额-金额"))
        if e_yoy is not None:
            exp.append((d, e_yoy))
        if i_yoy is not None:
            imp.append((d, i_yoy))
        if e_amt is not None and i_amt is not None:
            # 金额单位为千美元, 差额换算为亿美元
            bal.append((d, round((e_amt - i_amt) / 1e5, 1)))
    return exp, imp, bal


def extract_unemployment():
    df = ak.macro_china_urban_unemployment()
    out = []
    for _, r in df.iterrows():
        if str(r["item"]).strip() != "全国城镇调查失业率":
            continue
        d = str(r["date"])
        d = f"{d[:4]}-{d[4:6]}"
        out.append((d, clean(r["value"])))
    return out


def extract_gdzctz():
    df = ak.macro_china_gdzctz()
    return [(str(r["月份"]).replace("年", "-").replace("月份", "").replace("月", ""),
             clean(r.get("同比增长"))) for _, r in df.iterrows()]


def extract_house_price():
    """70 城新建商品住宅价格指数同比, 取各城市均值"""
    df = ak.macro_china_new_house_price()
    by_date = {}
    for _, r in df.iterrows():
        d = str(r["日期"])
        v = clean(r.get("新建商品住宅价格指数-同比"))
        if v is None:
            continue
        by_date.setdefault(d, []).append(v - 100)  # 指数转同比百分比
    return [(d, round(sum(vs) / len(vs), 2)) for d, vs in sorted(by_date.items())]


# Spec: 004-data-freshness — 以下改用国家统计局官方月度接口 (东财报告式接口滞后约 1 年)

def extract_gyzjz():
    """工业增加值同比 (统计局月度, 官方)"""
    df = ak.macro_china_gyzjz()
    rows = [(month_to_date(r["月份"]), clean(r.get("同比增长"))) for _, r in df.iterrows()]
    return sorted(rows, key=lambda t: t[0])


def extract_cpi():
    """CPI 同比 (统计局月度, 全国-同比增长)"""
    df = ak.macro_china_cpi()
    rows = [(month_to_date(r["月份"]), clean(r.get("全国-同比增长"))) for _, r in df.iterrows()]
    return sorted(rows, key=lambda t: t[0])


def extract_ppi():
    """PPI 同比 (统计局月度, 当月同比增长)"""
    df = ak.macro_china_ppi()
    rows = [(month_to_date(r["月份"]), clean(r.get("当月同比增长"))) for _, r in df.iterrows()]
    return sorted(rows, key=lambda t: t[0])


def extract_pmi():
    """PMI (统计局月度, 官方): (制造业指数, 非制造业指数)"""
    df = ak.macro_china_pmi()
    mfg = sorted(((month_to_date(r["月份"]), clean(r.get("制造业-指数"))) for _, r in df.iterrows()),
                 key=lambda t: t[0])
    non = sorted(((month_to_date(r["月份"]), clean(r.get("非制造业-指数"))) for _, r in df.iterrows()),
                 key=lambda t: t[0])
    return mfg, non


def extract_fx_reserves():
    """官方外汇储备 (月度, 亿美元)"""
    df = ak.macro_china_fx_gold()
    rows = [(month_to_date(r["月份"]), clean(r.get("国家外汇储备-数值"))) for _, r in df.iterrows()]
    return sorted(rows, key=lambda t: t[0])


def extract_consumer_confidence():
    """消费者信心指数 (东财月度, 指数值)"""
    df = ak.macro_china_xfzxx()
    rows = [(month_to_date(r["月份"]), clean(r.get("消费者信心指数-指数值"))) for _, r in df.iterrows()]
    return sorted(rows, key=lambda t: t[0])


def extract_retail():
    df = ak.macro_china_consumer_goods_retail()
    return [(str(r["月份"]).replace("年", "-").replace("月份", "").replace("月", ""),
             clean(r.get("同比增长"))) for _, r in df.iterrows()]


def extract_shrzgm():
    df = ak.macro_china_shrzgm()
    return [(month_to_date(r["月份"]), clean(r.iloc[1])) for _, r in df.iterrows()]


def extract_real_estate():
    df = ak.macro_china_real_estate()
    return [(str(r["日期"]), clean(r.get("最新值"))) for _, r in df.iterrows()
            if r.get("最新值") is not None]


# ---------- 主流程 ----------

def main():
    conn = sqlite3.connect(DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS series (
            indicator TEXT NOT NULL, date TEXT NOT NULL, value REAL,
            PRIMARY KEY (indicator, date))
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS meta (
            indicator TEXT PRIMARY KEY, name TEXT, unit TEXT, freq TEXT, dim TEXT,
            updated_at TEXT)
    """)

    tasks = [
        ("gdp_yoy", "GDP 同比增速", "%", "季度", "growth",
         lambda: extract_gdp()[0]),
        ("gdp_secondary", "第二产业增加值同比", "%", "季度", "growth",
         lambda: extract_gdp()[1]),
        ("gdp_tertiary", "第三产业增加值同比", "%", "季度", "growth",
         lambda: extract_gdp()[2]),
        ("fiscal_revenue_yoy", "财政收入当月同比", "%", "月度", "growth",
         extract_czsr),
        ("ind_yoy", "工业增加值同比", "%", "月度", "growth",
         extract_gyzjz),
        ("cpi_yoy", "CPI 同比", "%", "月度", "price",
         extract_cpi),
        ("ppi_yoy", "PPI 同比", "%", "月度", "price",
         extract_ppi),
        ("pmi_mfg", "制造业 PMI", "", "月度", "confidence",
         lambda: extract_pmi()[0]),
        ("pmi_non_mfg", "非制造业 PMI", "", "月度", "confidence",
         lambda: extract_pmi()[1]),
        ("unemployment", "城镇调查失业率", "%", "月度", "confidence",
         extract_unemployment),
        ("boom_index", "企业景气指数", "", "季度", "confidence",
         extract_boom),
        ("consumer_confidence", "消费者信心指数", "", "月度", "confidence",
         extract_consumer_confidence),
        ("retail_yoy", "社会消费品零售总额同比", "%", "月度", "consumption",
         extract_retail),
        ("fdi_yoy", "固定资产投资同比", "%", "月度", "consumption",
         extract_gdzctz),
        ("m1_yoy", "M1 同比", "%", "月度", "money",
         lambda: extract_money_supply()[0]),
        ("m2_yoy", "M2 同比", "%", "月度", "money",
         lambda: extract_money_supply()[1]),
        ("shrzgm", "社会融资规模增量", "亿元", "月度", "money", extract_shrzgm),
        ("new_loans", "新增人民币贷款", "亿元", "月度", "money",
         extract_new_loans),
        ("lpr_1y", "LPR 1年期", "%", "月度", "money",
         lambda: extract_lpr()[0]),
        ("lpr_5y", "LPR 5年期以上", "%", "月度", "money",
         lambda: extract_lpr()[1]),
        ("export_yoy", "出口金额当月同比", "%", "月度", "trade",
         lambda: extract_hgjck()[0]),
        ("import_yoy", "进口金额当月同比", "%", "月度", "trade",
         lambda: extract_hgjck()[1]),
        ("trade_balance", "贸易差额", "亿美元", "月度", "trade",
         lambda: extract_hgjck()[2]),
        ("fx_reserves", "外汇储备", "亿美元", "月度", "risk",
         extract_fx_reserves),
        ("real_estate_index", "房地产开发景气指数", "", "月度", "realestate",
         extract_real_estate),
        ("house_price_yoy", "70城新房价格指数同比(均值)", "%", "月度", "realestate",
         extract_house_price),
    ]

    # Spec: 003-manual-fetch — 每个指标完成后输出机器可读进度行 (@@PROGRESS JSON)
    ok = fail = empty = 0
    failures = []
    total = len(tasks)
    for i, (key, name, unit, freq, dim, fn) in enumerate(tasks, 1):
        print(f"[{key}] {name}")
        status = "ok"
        try:
            if put(conn, key, name, unit, freq, dim, fn()):
                ok += 1
            else:
                status = "empty"
                empty += 1
        except Exception:
            status = "fail"
            failures.append({"key": key, "name": name})
            fail += 1
            print(f"  [FAIL]\n{traceback.format_exc(limit=1)}")
        print("@@PROGRESS " + json.dumps(
            {"done": i, "total": total, "key": key, "name": name, "status": status},
            ensure_ascii=False), flush=True)

    print(f"\n完成: 成功 {ok}, 失败 {fail}")
    print("@@DONE " + json.dumps(
        {"ok": ok, "empty": empty, "fail": fail, "failures": failures},
        ensure_ascii=False), flush=True)
    conn.close()
    return 0 if ok >= 5 else 1


if __name__ == "__main__":
    sys.exit(main())
