/** 常见自媒体创作后台 — 对话框胶囊快捷填充 + 出厂种子共用 */

export type MatrixPlatformPreset = {
  id: string;
  name: string;
  homeUrl: string;
  homeTitle: string;
  sort: number;
  /** 是否写入出厂种子 */
  factory: boolean;
};

export const MATRIX_PLATFORM_PRESETS: MatrixPlatformPreset[] = [
  {
    id: "weixin",
    name: "微信公众号",
    homeUrl: "https://mp.weixin.qq.com/",
    homeTitle: "公众号主页",
    sort: 0,
    factory: true,
  },
  {
    id: "toutiao",
    name: "今日头条",
    homeUrl: "https://mp.toutiao.com/profile_v4/index",
    homeTitle: "头条创作主页",
    sort: 1,
    factory: true,
  },
  {
    id: "xiaohongshu",
    name: "小红书",
    homeUrl: "https://creator.xiaohongshu.com/",
    homeTitle: "小红书创作主页",
    sort: 2,
    factory: true,
  },
  {
    id: "douyin",
    name: "抖音创作者中心",
    homeUrl: "https://creator.douyin.com/creator-micro/home",
    homeTitle: "抖音创作主页",
    sort: 3,
    factory: true,
  },
  {
    id: "zhihu",
    name: "知乎",
    homeUrl: "https://www.zhihu.com/creator",
    homeTitle: "知乎创作者中心",
    sort: 4,
    factory: false,
  },
  {
    id: "channels",
    name: "微信视频号",
    homeUrl: "https://channels.weixin.qq.com/platform",
    homeTitle: "视频号平台",
    sort: 5,
    factory: false,
  },
];

/** 当前出厂种子版本: 升版时 ensure 会增量 INSERT OR IGNORE 新 factory 项 */
export const MATRIX_FACTORY_SEED_VERSION = 2;

/** 本地品牌图标路径 (public/icons/matrix/*.png ≈ 128²) */
export const MATRIX_BRAND_ICON_SRC: Record<string, string> = Object.fromEntries(
  MATRIX_PLATFORM_PRESETS.map((p) => [p.id, `/icons/matrix/${p.id}.png`]),
);
