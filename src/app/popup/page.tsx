"use client";

import { CopilotPopup } from "@copilotkit/react-core/v2";
import { AuxProvider, AuxShell, DashboardDecoy } from "../../components/aux-shell";
import { securityLabels } from "../../components/security-copilot";

export const dynamic = "force-dynamic";

export default function PopupDemoPage() {
  return (
    <AuxProvider>
      <AuxShell active="/popup" title="悬浮助手 · POPUP MODE" en="SYSTEMWIRE / EMBED / POPUP">
        <p style={{ fontSize: 12.5, color: "#7c8aa5", lineHeight: 1.9, maxWidth: 760, margin: "0 0 22px" }}>
          SYSTEMWIRE 可以悬浮球形态嵌入任意安全运营页面：右下角唤起、不打断当前工作流，
          支持资产测绘、蜜点部署授权与告警归因的全部能力。点击页面右下角的悬浮按钮打开助手。
        </p>
        <DashboardDecoy />
        <CopilotPopup
          defaultOpen={false}
          clickOutsideToClose={true}
          labels={securityLabels}
        />
      </AuxShell>
    </AuxProvider>
  );
}
