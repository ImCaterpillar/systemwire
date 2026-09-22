import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // 清空默认 external 列表：让 Turbopack 直接打包 shiki/streamdown，消除解析警告
  serverExternalPackages: [],
  // 开发指示浮标挪到右下角，避免遮挡左下角引擎/模式切换
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
