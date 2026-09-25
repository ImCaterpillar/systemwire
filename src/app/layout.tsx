import type { Metadata } from "next";
import "./globals.css";
import "@copilotkit/react-core/v2/styles.css";

export const metadata: Metadata = {
  title: "内网安全智能体平台",
  description: "集网络拓扑体检、蜜点部署、归因分析于一体的对话式安全智能体平台（演示）",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        {/* IBM Plex Mono + Noto Sans SC（CDN） */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router 的根 layout 即全站唯一文档入口，不存在该规则针对的 pages/_document.js 场景 */}
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "IBM Plex Mono, Noto Sans SC, monospace" }}>{children}</body>
    </html>
  );
}
