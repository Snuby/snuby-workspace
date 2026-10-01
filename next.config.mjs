// next 配置 (JS 版): 打包态 app 资源不含 typescript, .ts 配置会触发 next 自动安装 devDependencies,
// 导致冷启动联网 yarn add 卡死; .mjs 无 TS 依赖, next start 不再需要 typescript。
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  // 固定 workspace 根, 避免上层目录 lockfile 干扰推断
  outputFileTracingRoot: path.resolve(__dirname),
  transpilePackages: ["@mdxeditor/editor"],
};

export default nextConfig;
