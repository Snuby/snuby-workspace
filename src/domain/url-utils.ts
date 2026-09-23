// Spec: 016-nav-modules — URL 归一化 (Web 访问地址栏 / IT 资讯添加媒体共用)
// 规则: 去空白; 空串无效; 无协议补 https://; 解析失败或缺少 host 视为无效;
// hostname 仅允许 字母/数字/点/连字符/IPv6 括号 (Node URL 对乱码 host 宽容, 需显式收紧);
// 返回规范化 URL。

export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) return null;
    if (!/^[a-z0-9.:[\]]+$/i.test(parsed.hostname)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}
