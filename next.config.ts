import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // 固定 workspace 根, 避免上层目录 lockfile 干扰推断
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
