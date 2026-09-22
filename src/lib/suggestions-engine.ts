// 建议引擎（纯函数规则层，不依赖 React）
// deriveFollowUps：AI 回复下方的「建议执行动作」（点击立即发送）
// deriveComposerDrafts：输入框上方的「草稿建议」（点击只填入不发送）
//
// 注意：app-store.ts 的 AppState 接口未导出，且本阶段不允许修改基础层文件，
// 因此这里用结构最小类型描述所需字段；page.tsx 传入的完整 AppState 结构上兼容。

import { getTraceData } from "./mock-data";

export type SuggestionPage = "asset" | "deception" | "attribution";

export interface SuggestionDeployment {
  ip: string;
  type: string;
  status: string;
}

/** 所需 store 状态子集（结构类型，兼容完整 AppState） */
export interface SuggestionState {
  page: SuggestionPage;
  assets: unknown[] | null;
  scanProgress: number;
  scanning: boolean;
  deployments: SuggestionDeployment[];
  traceLayersRevealed: number;
  traceData: unknown | null;
  alertStatusMap: Record<string, string>;
  approval: unknown;
  /** 当前分析的告警 ID（用于按告警动态确定溯源总层数，2/3/4 层不一） */
  currentAlertId?: string | null;
}

export interface FollowUpAction {
  id: string;
  label: string;
  prompt: string;
  kind: "primary" | "ghost";
}

/** 溯源默认总层数（无法确定具体告警时的兜底） */
const FALLBACK_TOTAL_LAYERS = 4;

interface LayersCarrier {
  layers?: unknown[];
}

/** 当前溯源图谱的总层数：优先取已加载 traceData，其次按告警 ID 计算 */
function totalLayers(state: SuggestionState): number {
  const carried = state.traceData as LayersCarrier | null;
  if (carried && Array.isArray(carried.layers) && carried.layers.length > 0) {
    return carried.layers.length;
  }
  if (state.currentAlertId) {
    return getTraceData(state.currentAlertId).layers.length;
  }
  return FALLBACK_TOTAL_LAYERS;
}

function isApprovalPending(state: SuggestionState): boolean {
  return state.approval != null;
}

function isTraceInProgress(state: SuggestionState): boolean {
  return (
    state.page === "attribution" &&
    !!state.traceData &&
    state.traceLayersRevealed > 0 &&
    state.traceLayersRevealed < totalLayers(state)
  );
}

function isTraceComplete(state: SuggestionState): boolean {
  return !!state.traceData && state.traceLayersRevealed >= totalLayers(state);
}

function hasPendingAlert(state: SuggestionState): boolean {
  return Object.values(state.alertStatusMap).some((v) => v === "待研判");
}

/**
 * 推导 AI 回复下方的建议执行动作（点击立即发送）。
 * lastTool：上一条 assistant 消息触发的工具名（由 DOM 卡片标签推断）。
 */
export function deriveFollowUps(
  state: SuggestionState,
  lastAssistantText: string,
  lastTool?: string,
): FollowUpAction[] {
  // 端口冲突/卸载待审批：审批卡置顶，不出现新动作
  if (isApprovalPending(state)) return [];

  const text = lastAssistantText ?? "";

  // 审批被拒绝后：引导换方案
  if (text.includes("拒绝")) {
    return [
      {
        id: "retry-approval",
        label: "重新选择部署方案",
        prompt: "在 192.168.1.107 部署 SQL 蜜点",
        kind: "primary",
      },
    ];
  }

  // 部署失败 / 不支持
  if (text.includes("未成功") || text.includes("无法部署")) {
    return [
      {
        id: "retry",
        label: "换一个节点部署",
        prompt: "在 192.168.1.105 部署 SSH 蜜点",
        kind: "primary",
      },
      {
        id: "reason",
        label: "查看不能部署原因",
        prompt: "109 为什么不能部署蜜点？",
        kind: "ghost",
      },
    ];
  }

  // 同节点已有同类型诱饵（幂等命中）
  if (text.includes("已在运行") || text.includes("已部署")) {
    return [
      {
        id: "remove",
        label: "卸载现有SSH诱饵",
        prompt: "卸载 192.168.1.108 的 SSH 蜜点",
        kind: "primary",
      },
      {
        id: "change-type",
        label: "改部署其他类型",
        prompt: "在 192.168.1.108 部署 SMB 蜜点",
        kind: "ghost",
      },
    ];
  }

  // 归因进行中：不打扰
  if (lastTool === "traceAttack" && isTraceInProgress(state)) return [];

  // 归因完成
  if (lastTool === "traceAttack" && isTraceComplete(state)) {
    return [
      { id: "ticket", label: "生成处置工单", prompt: "生成处置工单", kind: "primary" },
      { id: "history", label: "查看关联历史事件", prompt: "查看关联历史事件", kind: "ghost" },
      { id: "regraph", label: "重新生成溯源图谱", prompt: "重新生成溯源图谱", kind: "ghost" },
    ];
  }

  // 体检完成
  if (lastTool === "scanAsset") {
    return [
      { id: "auto-deploy", label: "Agent自主部署蜜点", prompt: "根据体检结果自动部署蜜点", kind: "primary" },
      { id: "trace", label: "分析最近一条蜜点告警", prompt: "分析最近一条蜜点告警", kind: "ghost" },
      { id: "risk-list", label: "高危资产有哪些？", prompt: "高危资产有哪些？", kind: "ghost" },
    ];
  }

  // 含图工具结论被追问画图
  if (text.includes("拓扑") || text.includes("图谱") || text.includes("图")) {
    return [
      {
        id: "redraw",
        label: "重新生成拓扑/溯源图谱",
        prompt: "重新生成拓扑图",
        kind: "primary",
      },
    ];
  }

  // 告警队列有待研判（已完成体检、且不在归因进行中）
  if (state.assets != null && hasPendingAlert(state) && !isTraceInProgress(state)) {
    return [
      {
        id: "next-alert",
        label: "分析下一条待研判告警",
        prompt: "分析下一条待研判告警",
        kind: "primary",
      },
    ];
  }

  // 体检前默认
  return [
    {
      id: "scan",
      label: "对网段做内网体检",
      prompt: "对 192.168.1.0/24 做内网体检",
      kind: "primary",
    },
    { id: "guide", label: "你能做什么？", prompt: "你能做什么？", kind: "ghost" },
  ];
}

/**
 * 推导输入框上方的草稿建议（点击只填入不发送）。
 */
export function deriveComposerDrafts(state: SuggestionState): string[] {
  // 有待审批：审批卡置顶，不返回新草稿
  if (isApprovalPending(state)) return [];

  const scanned = !!state.assets && state.scanProgress >= 100;

  if (state.page === "asset") {
    return scanned
      ? ["根据体检结果自动部署蜜点", "分析最近一条蜜点告警", "192.168.1.105 有什么风险？"]
      : ["对 192.168.1.0/24 做内网体检", "网段里有哪些高危资产？", "你能做什么？"];
  }

  if (state.page === "deception") {
    const depIps = new Set(state.deployments.map((d) => d.ip));
    const depTypes = new Set(state.deployments.map((d) => `${d.ip}|${d.type}`));
    const allDone = state.deployments.length >= 3;
    if (allDone) {
      return ["分析最近一条蜜点告警", "生成处置工单", "192.168.1.105 有什么风险？"];
    }
    const drafts: string[] = [];
    if (!depTypes.has("192.168.1.105|SSH")) drafts.push("在 192.168.1.105 部署 SSH 蜜点");
    if (!depIps.has("192.168.1.1")) drafts.push("在网关部署 Web 仿冒诱饵");
    drafts.push("根据体检结果自动部署蜜点");
    return drafts.slice(0, 3);
  }

  // attribution
  if (isTraceInProgress(state)) return []; // 归因中：不打扰
  if (isTraceComplete(state)) {
    return ["生成处置工单", "分析下一条待研判告警", "重新生成溯源图谱"];
  }
  return ["分析最近一条蜜点告警", "攻击源是从哪里进来的？", "生成处置工单"];
}
