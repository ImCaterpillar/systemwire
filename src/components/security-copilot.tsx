"use client";

import { useMemo } from "react";
import {
  defineToolCallRenderer,
  useHumanInTheLoop,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import { ScanArtifact, DeployArtifact, TraceArtifact, UndeployArtifact } from "./artifacts";
import { ApprovalCard } from "./ApprovalCard";
import { getAppState } from "../lib/app-store";

/** 工具执行中的 HUD 占位卡 */
export function ArtifactPlaceholder({ label, text, color }: { label: string; text: string; color: string }) {
  return (
    <div className="hud-card hud-slide-up" style={{ margin: "10px 0" }}>
      <div className="hud-card-head" style={{ color }}>
        <span className="hud-scanning">{label}</span>
        <span className="hud-tag hud-slow-blink" style={{ color: "#f59e0b" }}>RUNNING</span>
      </div>
      <div className="hud-card-body" style={{ display: "flex", alignItems: "center", gap: 11 }}>
        <span style={{ position: "relative", width: 26, height: 26, flex: "none" }}>
          <svg width="26" height="26" viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="15" fill="none" stroke={color} strokeOpacity="0.3" strokeWidth="2" />
            <g style={{ transformOrigin: "20px 20px", animation: "hud-radar-sweep 1.1s linear infinite" }}>
              <path d="M20 20 L20 5 A15 15 0 0 1 35 20 Z" fill={color} fillOpacity="0.35" />
            </g>
          </svg>
        </span>
        <span style={{ fontSize: 12, color: "#9fb0cc", letterSpacing: 0.5 }}>{text}</span>
      </div>
    </div>
  );
}

// 注意：render 每次组件重渲染都会执行，JSON.parse 必须 useMemo 缓存，
// 否则 result 对象每次都是新引用，会把 Artifact 内部 [result] 效果反复重置
// （曾导致溯源图谱层数一直被重置为 L1）。
function ScanToolResult({ result }: { result: string }) {
  const data = useMemo(() => { try { return JSON.parse(result); } catch { return null; } }, [result]);
  if (!data) return <ArtifactPlaceholder label="ASSET-MAPPING" text="结果解析中…" color="#3984ff" />;
  return <ScanArtifact result={data} />;
}
function DeployToolResult({ result }: { result: string }) {
  const data = useMemo(() => { try { return JSON.parse(result); } catch { return null; } }, [result]);
  if (!data) return <ArtifactPlaceholder label="DECEPTION-DEPLOY" text="结果解析中…" color="#22d3ee" />;
  return <DeployArtifact result={data} />;
}
function TraceToolResult({ result }: { result: string }) {
  const data = useMemo(() => { try { return JSON.parse(result); } catch { return null; } }, [result]);
  if (!data) return <ArtifactPlaceholder label="THREAT-ATTRIBUTION" text="结果解析中…" color="#ef4444" />;
  return <TraceArtifact result={data} />;
}
function UndeployToolResult({ result }: { result: string }) {
  const data = useMemo(() => { try { return JSON.parse(result); } catch { return null; } }, [result]);
  if (!data) return <ArtifactPlaceholder label="DECEPTION-REMOVE" text="结果解析中…" color="#ef4444" />;
  return <UndeployArtifact result={data} />;
}

/** SYSTEMWIRE 四个安全工具的 Generative UI 渲染器（主界面 / 悬浮窗 / 侧边栏 / 单聊共用） */
export const securityToolRenderers = [
  defineToolCallRenderer({
    name: "scanAsset",
    args: z.object({ cidr: z.string() }),
    render: ({ status, result }) =>
      status !== "complete" || !result
        ? <ArtifactPlaceholder label="ASSET-MAPPING" text="正在执行内网资产测绘…" color="#3984ff" />
        : <ScanToolResult result={result} />,
  }),
  defineToolCallRenderer({
    name: "deployHoneypot",
    args: z.object({ ip: z.string(), type: z.enum(["SSH", "SQL", "WEB", "SMB"]) }),
    render: ({ status, result }) =>
      status !== "complete" || !result
        ? <ArtifactPlaceholder label="DECEPTION-DEPLOY" text="正在执行端口预检与诱饵部署…" color="#22d3ee" />
        : <DeployToolResult result={result} />,
  }),
  defineToolCallRenderer({
    name: "traceAttack",
    args: z.object({ alertId: z.string() }),
    render: ({ status, result }) =>
      status !== "complete" || !result
        ? <ArtifactPlaceholder label="THREAT-ATTRIBUTION" text="正在回溯攻击链路…" color="#ef4444" />
        : <TraceToolResult result={result} />,
  }),
  defineToolCallRenderer({
    name: "removeHoneypot",
    args: z.object({ ip: z.string(), type: z.enum(["SSH", "SQL", "WEB", "SMB"]).optional() }),
    render: ({ status, result }) =>
      status !== "complete" || !result
        ? <ArtifactPlaceholder label="DECEPTION-REMOVE" text="正在执行诱饵卸载…" color="#ef4444" />
        : <UndeployToolResult result={result} />,
  }),
  defineToolCallRenderer({
    name: "*",
    render: ({ name, args, status }) => (
      <div style={{ fontSize: 12, color: "#7c8aa5", border: "1px dashed #294a79", borderRadius: 8, padding: 8, margin: "8px 0" }}>
        <span style={{ color: "#3984ff" }}>TOOL</span> {name} · {status}
        {args && Object.keys(args).length > 0 && <pre style={{ fontSize: 11, margin: "6px 0 0" }}>{JSON.stringify(args, null, 2)}</pre>}
      </div>
    ),
  }),
];

// HITL 在 inProgress 分支传 Partial<args>，而 ApprovalCard 的 props 类型要求非空；
// ApprovalCard 内部已对缺失字段做默认值（mode=deploy 等），这里用 any 适配层兼容判别联合。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ApprovalRenderer(props: any) {
  return <ApprovalCard {...props} />;
}

/** 部署/卸载人工授权（HITL）注册，所有 CopilotKit 容器都需要挂载 */
export function SecurityHitl() {
  useHumanInTheLoop(
    {
      name: "requestDeployApproval",
      description:
        "部署或卸载蜜点前请求用户授权确认。端口冲突时必须调用，展示四方案供用户选择。卸载操作无论模式一律调用。",
      parameters: z.object({
        mode: z.enum(["deploy", "remove"]),
        ip: z.string(),
        type: z.enum(["SSH", "SQL", "WEB", "SMB"]),
        conflict: z.object({ port: z.number(), process: z.string(), pid: z.number() }).optional(),
      }),
      render: ApprovalRenderer,
    },
    [],
  );
  return null;
}

/** 透传给运行时的演示状态 header（引擎 / 授权模式 / 自动批准类型） */
export const securityHeaders = () => ({
  "x-agent-engine": getAppState().engine,
  "x-auth-mode": getAppState().authMode,
  "x-auto-approve": getAppState().autoApproveTypes.join(","),
});

export const OPEN_GENERATIVE_UI = Object.freeze({ sandboxFunctions: Object.freeze([]) as never[] });

/** CopilotKit v2 文案中文化（占位符 / 免责声明 / 工具条 / 弹窗） */
export const securityLabels = {
  chatInputPlaceholder: "输入指令，例如：对 192.168.1.0/24 做内网体检…",
  chatInputToolbarAddButtonLabel: "添加附件",
  chatInputToolbarToolsButtonLabel: "工具",
  chatInputToolbarStartTranscribeButtonLabel: "开始语音输入",
  chatInputToolbarCancelTranscribeButtonLabel: "取消语音输入",
  chatInputToolbarFinishTranscribeButtonLabel: "结束语音输入",
  assistantMessageToolbarCopyCodeLabel: "复制代码",
  assistantMessageToolbarCopyCodeCopiedLabel: "已复制",
  assistantMessageToolbarCopyMessageLabel: "复制消息",
  assistantMessageToolbarRegenerateLabel: "重新生成",
  assistantMessageToolbarThumbsUpLabel: "有帮助",
  assistantMessageToolbarThumbsDownLabel: "无帮助",
  assistantMessageToolbarReadAloudLabel: "朗读",
  assistantMessageToolbarInspectorLabel: "检查器",
  assistantMessageToolbarInspectorDescription: "打开检查器",
  assistantMessageToolbarInspectorLocalOnlyLabel: "仅本地",
  assistantMessageToolbarInspectorLocalOnlyDescription: "仅本地可用",
  assistantMessageToolbarInspectorTitle: "检查器",
  assistantMessageToolbarInspectorHideLabel: "隐藏",
  assistantMessageToolbarInspectorHideDescription: "隐藏检查器",
  userMessageToolbarCopyMessageLabel: "复制消息",
  userMessageToolbarEditMessageLabel: "编辑消息",
  chatDisclaimerText: "智能体输出可能有误，关键处置操作请以人工核验为准。",
  chatToggleOpenLabel: "打开安全助手",
  chatToggleCloseLabel: "关闭安全助手",
  modalHeaderTitle: "SYSTEMWIRE 内网安全智能体",
  welcomeMessageText: "你好，我是内网安全智能体 SYSTEMWIRE，可以帮你做内网体检、蜜点部署与攻击溯源。",
};
