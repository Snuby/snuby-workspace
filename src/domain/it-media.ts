// Spec: 016-nav-modules — IT 资讯内置媒体集 (D1 定案: 内置 7 家) + 合并逻辑 (D2: 动态添加)
// 内置集为静态常量, 零数据库依赖; 自定义集由用户动态添加, 存 localStorage (见 it-media-tabs.tsx)。

export type MediaItem = {
  /** 本地唯一键 (内置 = 英文 slug; 自定义 = custom-<timestamp>) */
  slug: string;
  label: string;
  url: string;
  desc?: string;
  /** 内置集固定不可删; 自定义集可删 (D2) */
  builtin?: boolean;
  /**
   * Web 版是否可用 iframe 内嵌阅读 (默认 true)。实测反 iframe 机制 (2026-09-23):
   * 量子位点击文章强制顶层跳转、新智元/InfoQ 点击被静默拦截 → 中文媒体站标 false,
   * Web 版降级为「在新窗口打开」外链卡片; 桌面版 webview 不受影响。
   */
  embed?: boolean;
};

export const BUILTIN_IT_MEDIA: readonly MediaItem[] = [
  {
    slug: "the-verge",
    label: "The Verge",
    url: "https://www.theverge.com/",
    desc: "科技消费与行业综合, 报道快、可读性强",
    builtin: true,
  },
  {
    slug: "ars-technica",
    label: "Ars Technica",
    url: "https://arstechnica.com/",
    desc: "技术深度解读与实测, 工程师向",
    builtin: true,
  },
  {
    slug: "mit-tech-review",
    label: "MIT Technology Review",
    url: "https://www.technologyreview.com/",
    desc: "深度分析与伦理/政策评论, 质量最高",
    builtin: true,
  },
  {
    slug: "qbitai",
    label: "量子位",
    url: "https://www.qbitai.com/",
    desc: "AI 前沿快讯, 小时级更新",
    builtin: true,
    embed: false,
  },
  {
    slug: "aiera",
    label: "新智元",
    url: "https://aiera.com.cn/",
    desc: "AI 产业评论、论文解读",
    builtin: true,
    embed: false,
  },
  {
    slug: "jiqizhixin",
    label: "机器之心",
    url: "https://www.jiqizhixin.com/",
    desc: "深度技术解读、论文评测",
    builtin: true,
    embed: false,
  },
  {
    slug: "infoq-cn",
    label: "InfoQ 中文",
    url: "https://www.infoq.cn/",
    desc: "开发者工程实践、大厂案例",
    builtin: true,
    embed: false,
  },
];

/** 内置 + 自定义合并: 内置在前; 自定义 slug 与内置冲突时丢弃自定义项 (容错)。 */
export function mergeMedia(builtin: readonly MediaItem[], custom: readonly MediaItem[]): MediaItem[] {
  const builtinSlugs = new Set(builtin.map((m) => m.slug));
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const m of [...builtin, ...custom]) {
    if (seen.has(m.slug)) continue; // 全量去重 (含自定义互相冲突)
    if (builtinSlugs.has(m.slug) && !m.builtin) continue; // 自定义撞内置 slug → 丢弃
    seen.add(m.slug);
    out.push(m);
  }
  return out;
}
