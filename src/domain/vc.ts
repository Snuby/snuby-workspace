// Spec: 010-ai-vc-watch — AI 创投领域模型与纯函数
// 本文件为纯领域层: 不含 IO、不 import 任何框架库 (见 docs/conventions.md 分层规范)
// 规则单一事实源: 金额/轮次/赛道解析口径与 scripts/fetch_vc.py 的 Python 端实现一致,
// 双端契约以 docs/specs/010-ai-vc-watch/design.md 第五节为准。

export type Sector =
  | "ai-infra"
  | "foundation-models"
  | "agents"
  | "robotics"
  | "ai-app"
  | "devtools"
  | "health"
  | "fintech"
  | "data"
  | "security"
  | "unclassified";

export type DealEvent = {
  id: string; // "{source}:{source_id}"，幂等 upsert 去重键
  company: string;
  round: string | null; // 归一化轮次; null = 未披露
  amount: number | null; // 原币金额; null = 未披露
  currency: string | null; // 原币种
  amountUsd: number | null; // 近似汇率换算 (仅聚合比较用, 不覆盖原币展示)
  announcedAt: string; // YYYY-MM-DD
  sector: Sector;
  source: string;
  sourceId: string;
  title: string | null;
  url: string | null;
  notes: string | null;
};

/** API 视图模型 (amountUsd 已折算, 供前端展示) */
export type DealEventView = {
  id: string;
  company: string;
  round: string | null;
  amountUsd: number | null;
  amount: number | null;
  currency: string | null;
  announcedAt: string;
  sector: Sector;
  source: string;
  title: string | null;
  url: string | null;
  notes: string | null;
};

// ---------- 常量表 ----------

/** 赛道关键词表 — classifySector 的单一事实源 (design 决策 5)。命中计数取最高分, 并列取表序在前者 */
export const SECTOR_TAGS: ReadonlyArray<{ id: Sector; label: string; keywords: readonly string[] }> = [
  {
    id: "ai-infra",
    label: "AI 基础设施",
    keywords: ["compute", "gpu", "chip", "datacenter", "data center", "infra", "inference", "training", "cluster", "semiconductor", "hpc", "fab", "cloud", "芯片", "算力", "数据中心", "半导体", "云计算", "基础设施"],
  },
  {
    id: "foundation-models",
    label: "大模型",
    keywords: ["llm", "foundation model", "foundation-model", "gpt", "frontier", "language model", "multimodal", "model lab", "models lab", "openai", "anthropic", "大模型", "语言模型", "多模态", "模型"],
  },
  {
    id: "agents",
    label: "智能体",
    keywords: ["agent", "autonomous", "copilot", "workflow", "orchestration", "智能体", "代理", "工作流"],
  },
  {
    id: "robotics",
    label: "具身智能",
    keywords: ["robot", "humanoid", "embodied", "drone", "manipulation", "机器人", "具身", "人形", "无人驾驶", "无人机"],
  },
  {
    id: "ai-app",
    label: "AI 应用",
    keywords: ["app", "consumer", "saas", "enterprise", "vertical", "productivity", "customer service", "marketing", "recruiting", "background check", "due diligence", "hr", "应用", "消费", "企业", "垂直", "办公", "营销"],
  },
  {
    id: "devtools",
    label: "开发者工具",
    keywords: ["devtools", "developer", "open source", "open-source", "sdk", "code", "debugging", "observability", "开发者", "开源", "代码", "编程", "开发工具"],
  },
  {
    id: "health",
    label: "医疗",
    keywords: ["health", "healthcare", "bio", "drug", "clinical", "pharma", "biotech", "protein", "genomic", "医疗", "生物", "药物", "医药", "健康", "临床", "制药"],
  },
  {
    id: "fintech",
    label: "金融",
    keywords: ["fintech", "finance", "payment", "bank", "wealth", "insurance", "trading", "金融", "支付", "银行", "财富", "保险", "交易"],
  },
  {
    id: "data",
    label: "数据",
    keywords: ["dataset", "data", "synthetic", "labeling", "scraping", "数据", "标注"],
  },
  {
    id: "security",
    label: "安全",
    keywords: ["security", "safety", "alignment", "red team", "red-team", "cyber", "defense", "安全", "对齐", "合规", "风控", "防御"],
  },
] as const;

/** 赛道展示顺序与文案 (事件流过滤 / 分析图图例共用) */
export const SECTOR_LABELS: Record<Sector, string> = {
  "ai-infra": "AI 基础设施",
  "foundation-models": "大模型",
  agents: "智能体",
  robotics: "具身智能",
  "ai-app": "AI 应用",
  devtools: "开发者工具",
  health: "医疗",
  fintech: "金融",
  data: "数据",
  security: "安全",
  unclassified: "未分类",
};

/** 近似汇率 (design 决策 4) — 仅用于聚合比较, 原币金额始终保留 */
export const CURRENCY_TO_USD: Readonly<Record<string, number>> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  CNY: 0.14,
};

/** 轮次归一化别名表 — 正则 + 归一值; 命中优先取表序在前者 */
const ROUND_ALIASES: ReadonlyArray<{ pattern: RegExp; value: string }> = [
  { pattern: /pre[- ]?seed/i, value: "Pre-seed" },
  { pattern: /angel|天使轮/i, value: "Angel" },
  { pattern: /seed|种子轮/i, value: "Seed" },
  { pattern: /series[ -]?a|a\s*轮/i, value: "A" },
  { pattern: /series[ -]?b|b\s*轮/i, value: "B" },
  { pattern: /series[ -]?c|c\s*轮/i, value: "C" },
  { pattern: /series[ -]?d|d\s*轮/i, value: "D" },
  { pattern: /series[ -]?e|e\s*轮/i, value: "E" },
  { pattern: /series[ -]?f|f\s*轮/i, value: "F" },
  { pattern: /growth|成长期/i, value: "Growth" },
  { pattern: /venture|风险投资/i, value: "Venture" },
  { pattern: /strategic|战略/i, value: "Strategic" },
  { pattern: /bridge|过桥/i, value: "Bridge" },
  { pattern: /grant|资助/i, value: "Grant" },
];

/** 币种符号与中文币种词 → 货币代码 */
const CURRENCY_BY_SIGN: Readonly<Record<string, string>> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "CNY",
};
const CURRENCY_BY_WORD: Readonly<Record<string, string>> = {
  美元: "USD",
  人民币: "CNY",
  元: "CNY",
  欧元: "EUR",
  英镑: "GBP",
  日元: "JPY",
  港币: "HKD",
  港元: "HKD",
};

/** 金额量级后缀 */
const MAGNITUDE: Readonly<Record<string, number>> = {
  K: 1e3,
  M: 1e6,
  B: 1e9,
  T: 1e12,
};

// ---------- 纯函数 ----------

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * 金额解析: 支持 "$10M" / "€40M" / "£1.2B" / "¥500M" / 中文"10亿元" "5000万美元"。
 * 取文本中**首个**命中 (标题优先于摘要, 调用方按序拼接即可); 解析不到返回 null。
 * 数字容忍千分位逗号 ("$1,000,000")。
 */
export function parseAmount(text: string): { amount: number; currency: string } | null {
  if (!text) return null;
  // 英文/符号形式: $10M, €40M, ¥500M, $1.2B, $1,000,000
  // 有量级后缀 (K/M/B/T) 才乘系数; 完整数字 (带千分位或裸数字) 按原值, 不默认 M
  const sign = text.match(/([\$€£¥])\s*([\d][\d,]*\.?\d*)\s*([KMBT])/i);
  if (sign && sign[1] && sign[2]) {
    const magnitude = sign[3].toUpperCase();
    const base = parseFloat(sign[2].replace(/,/g, ""));
    if (Number.isNaN(base)) return null;
    return { amount: round2(base * (MAGNITUDE[magnitude] ?? 1e6)), currency: CURRENCY_BY_SIGN[sign[1]] };
  }
  const bare = text.match(/([\$€£¥])\s*([\d][\d,]*\.?\d*)/);
  if (bare && bare[1] && bare[2]) {
    const base = parseFloat(bare[2].replace(/,/g, ""));
    if (!Number.isNaN(base)) return { amount: round2(base), currency: CURRENCY_BY_SIGN[bare[1]] };
  }
  // 中文形式: 10亿元 / 5000万美元 / 1.2亿欧元 / 8000万人民币
  const cjk = text.match(/([\d][\d,]*\.?\d*)\s*(亿|万)\s*(美元|人民币|元|欧元|英镑|日元|港币|港元)/);
  if (cjk && cjk[1]) {
    const base = parseFloat(cjk[1].replace(/,/g, ""));
    if (Number.isNaN(base)) return null;
    const amount = base * (cjk[2] === "亿" ? 1e8 : 1e4);
    return { amount: round2(amount), currency: CURRENCY_BY_WORD[cjk[3]] };
  }
  return null;
}

/** 轮次归一化: "Series A" / "A轮" → "A"; "seed"/"天使轮" → "Seed"; 未命中 → null */
export function normalizeRound(text: string): string | null {
  if (!text) return null;
  for (const { pattern, value } of ROUND_ALIASES) {
    if (pattern.test(text)) return value;
  }
  return null;
}

/** 赛道分类: 关键词命中计数取最高分赛道; 未命中 → "unclassified" (design 决策 5) */
export function classifySector(text: string): Sector {
  if (!text) return "unclassified";
  const lower = text.toLowerCase();
  let best: Sector = "unclassified";
  let bestScore = 0;
  for (const tag of SECTOR_TAGS) {
    const score = tag.keywords.reduce((n, kw) => (lower.includes(kw) ? n + 1 : n), 0);
    if (score > bestScore) {
      best = tag.id;
      bestScore = score;
    }
  }
  return best;
}

/** 去重键: "{source}:{sourceId}" (design 决策 3) */
export function dealKey(source: string, sourceId: string): string {
  return `${source}:${sourceId}`;
}

/** 月度分组键: "YYYY-MM-DD" → "YYYY-MM" */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** 近似汇率换算 (design 决策 4); 未支持币种返回 null, 不猜测 */
export function toUsd(amount: number, currency: string): number | null {
  const rate = CURRENCY_TO_USD[currency];
  if (rate === undefined) return null;
  return round2(amount * rate);
}

/**
 * 美元紧凑格式 (聚合比较用): 统一以 M/B 为单位并保留 1 位小数 —
 * 50_000_000 → "$50.0M"; 2_500_000_000 → "$2.5B"; 500_000 → "$0.5M"; null → "未披露"
 */
export function formatUsd(amountUsd: number | null): string {
  if (amountUsd === null || amountUsd === undefined) return "未披露";
  const abs = Math.abs(amountUsd);
  if (abs >= 1e9) return `$${(amountUsd / 1e9).toFixed(1)}B`;
  return `$${(amountUsd / 1e6).toFixed(1)}M`;
}

/** 原币金额展示 (中文币种用中文单位, 其余用符号+量级): "¥7000万" / "€40M"; null → "未披露" */
export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || amount === undefined) return "未披露";
  if (currency === "CNY") {
    const abs = Math.abs(amount);
    if (abs >= 1e8) return `¥${round2(amount / 1e8)}亿`;
    if (abs >= 1e4) return `¥${round2(amount / 1e4)}万`;
    return `¥${amount}`;
  }
  const sign = { USD: "$", EUR: "€", GBP: "£", JPY: "¥", HKD: "HK$" }[currency ?? ""] ?? "";
  const abs = Math.abs(amount);
  if (abs >= 1e9) return `${sign}${round2(amount / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${round2(amount / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${round2(amount / 1e3)}K`;
  return `${sign}${amount}`;
}

/** 事件视图: 由仓储行映射为 API 视图 (折算 amountUsd) */
export function toDealEventView(e: DealEvent): DealEventView {
  return {
    id: e.id,
    company: e.company,
    round: e.round,
    amountUsd: e.amountUsd,
    amount: e.amount,
    currency: e.currency,
    announcedAt: e.announcedAt,
    sector: e.sector,
    source: e.source,
    title: e.title,
    url: e.url,
    notes: e.notes,
  };
}

/** 数据源展示名 (事件行来源徽标 / 过滤) */
export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  techcrunch: "TechCrunch",
  hn: "Hacker News",
  manual: "手动录入",
};

/** 创投板块二级菜单 (spec 010) */
export const VC_SECTIONS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/ai-vc", label: "事件流" },
  { href: "/ai-vc/analytics", label: "分析" },
] as const;

/** 抓取滞后容忍 (自然日): 融资事件稀疏, 3 天未更新即提示 (US-6 AC2) */
export const VC_STALE_DAYS = 3;

/** 人工录入轮次预置列表 (表单下拉; 自定义可另填) */
export const ROUND_OPTIONS: readonly string[] = [
  "Pre-seed",
  "Seed",
  "Angel",
  "A",
  "B",
  "C",
  "D",
  "E",
  "Growth",
  "Strategic",
  "Bridge",
];

/** 人工录入币种预置列表 */
export const CURRENCY_OPTIONS: readonly string[] = ["USD", "EUR", "GBP", "CNY", "JPY", "HKD"];
