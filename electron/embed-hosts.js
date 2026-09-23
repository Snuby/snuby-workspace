// Spec: 014-embed-hosts — 内嵌 webview 导航白名单 (主进程侧, CJS)
// 条目格式:
//   *.example.com  → example.com 及其所有子域 (通配)
//   example.com    → 仅 example.com 精确匹配 (不含子域)
//   accounts.google.com → 精确子域
const DEFAULT_EMBED_HOSTS = [
  "*.openrouter.ai",
  "*.artificialanalysis.ai",
  "accounts.google.com",
  "github.com",
];

/** 解析并校验一个条目; 非法返回 null */
function normalizeEntry(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (!s) return null;
  const wildcard = s.startsWith("*.");
  const base = wildcard ? s.slice(2) : s;
  // 合法域名: 字母/数字/连字符标签 + 至少一个点, 不允许 http://、空格、端口等
  const label = "[a-z0-9]([a-z0-9-]*[a-z0-9])?";
  if (!new RegExp(`^${label}(\\.${label})+$`).test(base)) return null;
  return { raw: s, base, wildcard };
}

/** 判断 host 是否命中条目列表 */
function isHostAllowed(host, entries) {
  if (!host) return false;
  const h = String(host).trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  return entries.some((e) => {
    const n = typeof e === "string" ? normalizeEntry(e) : e;
    if (!n) return false;
    if (n.wildcard) return h === n.base || h.endsWith("." + n.base);
    return h === n.base;
  });
}

/** 清洗一份原始列表: 去掉非法与重复, 返回 {valid, invalid} */
function sanitizeList(rawList) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of rawList || []) {
    const n = normalizeEntry(raw);
    if (n && !seen.has(n.raw)) {
      seen.add(n.raw);
      valid.push(n.raw);
    } else if (!n) {
      invalid.push(String(raw));
    }
  }
  return { valid, invalid };
}

module.exports = { DEFAULT_EMBED_HOSTS, normalizeEntry, isHostAllowed, sanitizeList };
