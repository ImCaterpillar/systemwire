"use client";

import type { ReactNode } from "react";
import { CopilotKitProvider, useConfigureSuggestions } from "@copilotkit/react-core/v2";
import { DEMO_RUNTIME_URL } from "../app/runtime-url";
import {
  securityToolRenderers,
  SecurityHitl,
  securityHeaders,
  OPEN_GENERATIVE_UI,
} from "./security-copilot";

/** 辅助形态页共用的 CopilotKit Provider（与主控制台同一套安全工具 / HITL / mock 引擎） */
export function AuxProvider({ children }: { children: ReactNode }) {  return (
    <CopilotKitProvider
      runtimeUrl={DEMO_RUNTIME_URL}
      renderToolCalls={securityToolRenderers}
      openGenerativeUI={OPEN_GENERATIVE_UI}
      headers={securityHeaders}
      enableInspector={false}
    >
      <SecurityHitl />
      <AuxSuggestions />
      {children}
    </CopilotKitProvider>
  );
}

const AUX_SUGGESTIONS = [
  "对 192.168.1.0/24 做内网体检",
  "在 192.168.1.105 部署 SSH 蜜点",
  "分析最近一条蜜点告警",
  "网段里有哪些高危资产？",
];

function AuxSuggestions() {
  useConfigureSuggestions(
    {
      suggestions: AUX_SUGGESTIONS.map((t) => ({ title: t, message: t })),
      available: "always",
    },
    [],
  );
  return null;
}

const NAV = [
  { href: "/", label: "作战控制台", en: "CONSOLE" },
  { href: "/popup", label: "悬浮助手", en: "POPUP" },
  { href: "/sidebar", label: "侧边栏助手", en: "SIDEBAR" },
  { href: "/single", label: "嵌入式终端", en: "EMBED" },
  { href: "/mcp-apps", label: "能力中心", en: "HUB" },
];

/** 深色 SOC 页面骨架：顶栏 + 形态切换导航 + 背景网格 */
export function AuxShell({
  active,
  title,
  en,
  children,
}: {
  active: string;
  title: string;
  en: string;
  children: ReactNode;
}) {
  return (
    <div
      className="aux-shell"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(900px 420px at 12% -10%, rgba(57,132,255,.1), transparent 60%), radial-gradient(700px 380px at 110% 110%, rgba(34,211,238,.06), transparent 55%), #06080c",
        color: "#a1aec2",
        fontFamily: "'Noto Sans SC', system-ui, sans-serif",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "12px 22px",
          borderBottom: "1px solid #16263f",
          background: "linear-gradient(180deg,rgba(13,20,34,.85),rgba(8,11,17,.85))",
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(6px)",
        }}
      >
        <AuxBrand />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "#dbeaff", fontWeight: 700, letterSpacing: 2, fontFamily: "'IBM Plex Mono',monospace" }}>
            SYSTEMWIRE
          </div>
          <div className="hud-kicker" style={{ color: "#5b9bff" }}>{en}</div>
        </div>
        <span style={{ flex: 1 }} />
        <nav style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {NAV.map((n) => {
            const on = n.href === active;
            return (
              <a
                key={n.href}
                href={n.href}
                style={{
                  fontSize: 11,
                  padding: "6px 12px",
                  textDecoration: "none",
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: on ? "#cfe0ff" : "#5c6b85",
                  border: `1px solid ${on ? "#294a79" : "#16263f"}`,
                  borderLeft: `2px solid ${on ? "#3984ff" : "transparent"}`,
                  background: on ? "linear-gradient(90deg,rgba(57,132,255,.16),transparent)" : "transparent",
                  clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%)",
                }}
              >
                {n.label}
              </a>
            );
          })}
        </nav>
      </header>
      <main style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 160px" }}>
        <h1 style={{ fontSize: 22, color: "#e8eefc", fontWeight: 700, letterSpacing: 2, margin: "0 0 6px", fontFamily: "'IBM Plex Mono',monospace" }}>
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

function AuxBrand() {
  return (
    <svg width="30" height="30" viewBox="0 0 48 48" style={{ flex: "none", filter: "drop-shadow(0 0 6px rgba(57,132,255,.6))" }}>
      <path d="M24 5 L40 11 V24 C40 33 33.5 39.5 24 43 C14.5 39.5 8 33 8 24 V11 Z" fill="rgba(57,132,255,.16)" stroke="#5b9bff" strokeWidth="1.6" />
      <path d="M16 24 L22 30 L33 18" fill="none" stroke="#aee9ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 形态页背后的模拟安全运营看板（告警队列） */
const DASH_ALERTS = [
  { id: "ALERT-2026-0919-001", level: "高危", color: "#ef4444", title: "SSH 蜜点捕获爆破登录", src: "192.168.1.103", time: "09:19:42" },
  { id: "ALERT-2026-0917-003", level: "高危", color: "#ef4444", title: "Web 蜜点检出扫描器 UA", src: "192.168.1.102", time: "09:17:05" },
  { id: "ALERT-2026-0915-007", level: "中危", color: "#f59e0b", title: "SQL 诱饵触发异常查询", src: "192.168.1.107", time: "09:15:38" },
  { id: "ALERT-2026-0912-002", level: "低危", color: "#22d3ee", title: "网关端口探测行为", src: "192.168.1.1", time: "09:12:11" },
];

export function DashboardDecoy({ compact }: { compact?: boolean }) {
  const stats = [
    { label: "在线资产", value: "12", color: "#3984ff" },
    { label: "高危告警", value: "2", color: "#ef4444" },
    { label: "运行诱饵", value: "5", color: "#22d3ee" },
    { label: "攻击战役", value: "3", color: "#a78bfa" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${stats.length},1fr)`, gap: 10 }}>
        {stats.map((s) => (
          <div key={s.label} className="hud-panel-flat" style={{ padding: "12px 14px", borderTop: `2px solid ${s.color}` }}>
            <div style={{ fontSize: 22, color: s.color, fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700 }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#7c8aa5", marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>
      <div className="hud-panel-flat" style={{ padding: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 13px", borderBottom: "1px solid #16263f" }}>
          <span className="hud-kicker" style={{ color: "#5b9bff" }}>ALERT QUEUE / 实时告警队列</span>
          <span className="hud-dot pulse" style={{ ["--dot" as string]: "#ef4444" }} />
        </div>
        {DASH_ALERTS.slice(0, compact ? 3 : 4).map((a) => (
          <div
            key={a.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 13px",
              borderBottom: "1px solid #101c30",
              fontSize: 11.5,
            }}
          >
            <span style={{ fontSize: 9, fontFamily: "'IBM Plex Mono',monospace", color: a.color, border: `1px solid ${a.color}66`, background: `${a.color}14`, padding: "1px 7px", flex: "none" }}>
              {a.level}
            </span>
            <span style={{ color: "#c3d0e6", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</span>
            <span style={{ color: "#5c6b85", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10 }}>{a.src}</span>
            <span style={{ color: "#42506b", fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, flex: "none" }}>{a.time}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
