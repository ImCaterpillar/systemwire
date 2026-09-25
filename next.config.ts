import type { NextConfig } from "next";

// 演示站点的安全响应头：禁止 MIME 嗅探 / 限制 referrer / 禁止被 iframe 嵌套 / 关闭无用的浏览器能力。
// 未启用 CSP：App Router 依赖内联样式与脚本，硬开 CSP 会破坏 HUD 主题，故只做低风险加固。
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
  // 清空默认 external 列表：让 Turbopack 直接打包 shiki/streamdown，消除解析警告
  serverExternalPackages: [],
  // 开发指示浮标挪到右下角，避免遮挡左下角引擎/模式切换
  devIndicators: { position: "bottom-right" },
  // 显式声明响应压缩（Next 默认开启，写明避免被误关）
  compress: true,
  // 生产构建剔除 console.log/debug，保留 warn/error 供 DeepSeek 回退日志使用
  compiler: { removeConsole: { exclude: ["warn", "error"] } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
