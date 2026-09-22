"use client";

import { CopilotSidebar } from "@copilotkit/react-core/v2";
import { AuxProvider, AuxShell, DashboardDecoy } from "../../components/aux-shell";
import { securityLabels } from "../../components/security-copilot";

export const dynamic = "force-dynamic";

export default function SidebarDemoPage() {
  return (
    <AuxProvider>
      <AuxShell active="/sidebar" title="侧边栏助手 · SIDEBAR MODE" en="SYSTEMWIRE / EMBED / SIDEBAR">
        <p style={{ fontSize: 12.5, color: "#7c8aa5", lineHeight: 1.9, maxWidth: 760, margin: "0 0 22px" }}>
          SYSTEMWIRE 以右侧常驻边栏形态与运营看板并排呈现，页面内容随边栏开合自动重排。
          边栏内的助手与主控制台共享同一套安全工具、人工授权与可视化卡片。
        </p>
        <DashboardDecoy compact />
        <CopilotSidebar
          defaultOpen={true}
          width="420px"
          labels={securityLabels}
        />
      </AuxShell>
    </AuxProvider>
  );
}
