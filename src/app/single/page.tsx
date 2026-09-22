"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { AuxProvider } from "../../components/aux-shell";
import { securityLabels } from "../../components/security-copilot";

export const dynamic = "force-dynamic";

export default function SingleEndpointDemo() {
  return (
    <AuxProvider>
      <div
        style={{
          position: "fixed",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          background:
            "radial-gradient(820px 380px at 10% -10%, rgba(57,132,255,.1), transparent 60%), radial-gradient(620px 340px at 112% 112%, rgba(34,211,238,.06), transparent 55%), #06080c",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "11px 20px",
            borderBottom: "1px solid #16263f",
            background: "linear-gradient(180deg,rgba(13,20,34,.85),rgba(8,11,17,.85))",
            flex: "none",
          }}
        >
          <svg width="26" height="26" viewBox="0 0 48 48" style={{ filter: "drop-shadow(0 0 6px rgba(57,132,255,.6))" }}>
            <path d="M24 5 L40 11 V24 C40 33 33.5 39.5 24 43 C14.5 39.5 8 33 8 24 V11 Z" fill="rgba(57,132,255,.16)" stroke="#5b9bff" strokeWidth="1.6" />
            <path d="M16 24 L22 30 L33 18" fill="none" stroke="#aee9ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div>
            <div style={{ fontSize: 12.5, color: "#dbeaff", fontWeight: 700, letterSpacing: 2, fontFamily: "'IBM Plex Mono',monospace" }}>
              SYSTEMWIRE <span style={{ color: "#5c6b85", fontWeight: 400 }}>/ 嵌入式终端</span>
            </div>
            <div className="hud-kicker" style={{ color: "#5b9bff" }}>EMBEDDED AGENT TERMINAL</div>
          </div>
          <span style={{ flex: 1 }} />
          <a href="/" style={{ fontSize: 11, color: "#7db0ff", textDecoration: "none", fontFamily: "'IBM Plex Mono',monospace", border: "1px solid #294a79", padding: "5px 12px" }}>
            ← 返回作战控制台
          </a>
        </header>
        <div style={{ flex: 1, minHeight: 0, padding: "0 20px 14px", display: "flex", justifyContent: "center" }}>
          <div style={{ width: "100%", maxWidth: 880, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <CopilotChat
              className="ck-chat"
              threadId="systemwire-embed"
              hasExplicitThreadId={false}
              welcomeScreen={false}
              labels={securityLabels}
            />
          </div>
        </div>
      </div>
    </AuxProvider>
  );
}
