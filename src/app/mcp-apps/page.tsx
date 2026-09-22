"use client";

import { AuxShell } from "../../components/aux-shell";

export const dynamic = "force-dynamic";

const CORE_CAPABILITIES = [
  { en: "ASSET-MAPPING", name: "内网资产测绘", tool: "scanAsset", color: "#3984ff", desc: "LLDP/端口扫描、漏洞评估、实时拓扑与蜜点分布同图呈现" },
  { en: "DECEPTION-DEPLOY", name: "主动诱捕部署", tool: "deployHoneypot", color: "#22d3ee", desc: "SSH/SQL/WEB/SMB 四类诱饵、端口冲突四方案、HITL 人工授权" },
  { en: "DECEPTION-REMOVE", name: "诱饵卸载回收", tool: "removeHoneypot", color: "#f59e0b", desc: "授权后卸载、端口释放、攻击日志归档，预置诱饵防误删提示" },
  { en: "THREAT-ATTRIBUTION", name: "攻击溯源归因", tool: "traceAttack", color: "#ef4444", desc: "杀伤链逐层解锁、证据时间线、MITRE ATT&CK、IOC 与置信度研判" },
];

const EMBED_FORMS = [
  { en: "CONSOLE", name: "三栏作战控制台", href: "/", color: "#3984ff", desc: "导航 / 对话 / 工作台的 SOC 大屏主形态" },
  { en: "POPUP", name: "悬浮球助手", href: "/popup", color: "#22d3ee", desc: "任意业务页面右下角唤起，不打断工作流" },
  { en: "SIDEBAR", name: "侧边栏助手", href: "/sidebar", color: "#a78bfa", desc: "右侧常驻边栏，与运营看板并排协作" },
  { en: "EMBED", name: "嵌入式终端", href: "/single", color: "#34d399", desc: "单页全屏对话，可嵌入工单 / IM / 运维门户" },
];

const INTEGRATIONS = [
  ["EDR / 终端", "进程树、主机隔离、终端取证联动"],
  ["NDR / 网络", "流量告警、东西向访问基线"],
  ["SIEM / 日志", "告警聚合、攻击战役串联、工单回写"],
  ["威胁情报", "IOC 富化、C2 域名与哈希比对"],
  ["CMDB / 资产", "责任人、业务系统、资产重要度"],
  ["MCP 生态", "标准化工具协议接入第三方安全能力"],
];

export default function McpAppsPage() {
  return (
    <AuxShell active="/mcp-apps" title="能力中心 · CAPABILITY HUB" en="SYSTEMWIRE / INTEGRATION HUB">
      <p style={{ fontSize: 12.5, color: "#7c8aa5", lineHeight: 1.9, maxWidth: 820, margin: "0 0 24px" }}>
        SYSTEMWIRE 的安全能力以工具（Tool）形式注册到智能体运行时，可通过 CopilotKit 组件嵌入不同产品形态，
        也可经 MCP 标准协议对接 EDR / NDR / SIEM / 威胁情报等第三方安全系统。
      </p>

      <div className="hud-kicker" style={{ marginBottom: 10 }}>CORE TOOLS / 核心安全工具</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 12, marginBottom: 26 }}>
        {CORE_CAPABILITIES.map((c) => (
          <div key={c.en} className="hud-panel-flat" style={{ padding: "14px 16px", borderTop: `2px solid ${c.color}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13, color: "#e8eefc", fontWeight: 700 }}>{c.name}</span>
              <span style={{ fontSize: 8.5, color: c.color, fontFamily: "'IBM Plex Mono',monospace", border: `1px solid ${c.color}66`, background: `${c.color}14`, padding: "1px 6px" }}>
                {c.tool}
              </span>
            </div>
            <div style={{ fontSize: 8.5, color: c.color, letterSpacing: 1.5, fontFamily: "'IBM Plex Mono',monospace", margin: "4px 0 8px" }}>{c.en}</div>
            <div style={{ fontSize: 10.5, color: "#7c8aa5", lineHeight: 1.7 }}>{c.desc}</div>
          </div>
        ))}
      </div>

      <div className="hud-kicker" style={{ marginBottom: 10 }}>EMBEDDING FORMS / 产品嵌入形态</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginBottom: 26 }}>
        {EMBED_FORMS.map((f) => (
          <a
            key={f.en}
            href={f.href}
            style={{
              display: "block", textDecoration: "none", padding: "14px 16px",
              border: "1px solid #16263f", background: "rgba(8,13,21,.66)",
              clipPath: "polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,0 100%)",
            }}
          >
            <div style={{ fontSize: 8.5, color: f.color, letterSpacing: 1.5, fontFamily: "'IBM Plex Mono',monospace" }}>{f.en}</div>
            <div style={{ fontSize: 13, color: "#e8eefc", fontWeight: 700, margin: "4px 0 6px" }}>{f.name} →</div>
            <div style={{ fontSize: 10.5, color: "#7c8aa5", lineHeight: 1.7 }}>{f.desc}</div>
          </a>
        ))}
      </div>

      <div className="hud-kicker" style={{ marginBottom: 10 }}>INTEGRATIONS / 对接生态（MCP）</div>
      <div className="hud-panel-flat" style={{ padding: 0, marginBottom: 26 }}>
        {INTEGRATIONS.map(([name, desc], i) => (
          <div
            key={name}
            style={{
              display: "flex", alignItems: "center", gap: 14, padding: "11px 16px",
              borderBottom: i === INTEGRATIONS.length - 1 ? "none" : "1px solid #101c30",
            }}
          >
            <span style={{ width: 110, flex: "none", fontSize: 11.5, color: "#c3d0e6", fontWeight: 600 }}>{name}</span>
            <span style={{ flex: 1, fontSize: 10.5, color: "#7c8aa5" }}>{desc}</span>
            <span className="hud-tag" style={{ color: "#34d399", fontSize: 8.5 }}>READY</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 10, color: "#42506b", fontFamily: "'IBM Plex Mono',monospace", letterSpacing: 1 }}>
        SYSTEMWIRE // AI SECURITY AGENT · 离线演示脚本 100% 可演 · DeepSeek 通道可选并自动回退
      </div>
    </AuxShell>
  );
}
