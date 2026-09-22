// 全局联动状态（三栏共享：聊天流 Artifact ↔ 右栏面板 ↔ 左栏导航）
// 简单的外部 store + React hook，避免额外依赖

"use client";

import { useSyncExternalStore } from "react";
import { MOCK_ALERTS } from "./mock-data";
import type { Asset, HoneypotType, AlertStatus, ApprovalState } from "./mock-data";

export type PageKey = "asset" | "deception" | "attribution";
export type Engine = "mock" | "deepseek";

export interface Deployment {
  ip: string;
  type: HoneypotType;
  port: number;
  status: "deploying" | "active";
  progress: number;
  since?: string;     // 部署完成时间标签
  preset?: boolean;   // 演示剧本预置（告警来源）
}

export type ActivityTone = "blue" | "cyan" | "green" | "amber" | "red" | "muted";
export interface ActivityItem {
  id: number;
  time: string;
  tone: ActivityTone;
  text: string;
}

interface AppState {
  page: PageKey;
  engine: Engine;
  runs: Record<PageKey, number>;      // 每页重放轮次（拼进 threadId）
  assets: Asset[] | null;             // scanAsset 结果到达后填充
  scanProgress: number;               // 0-100
  scanning: boolean;
  selectedIp: string | null;          // 当前选中节点（右栏详情/部署目标）
  highlightIp: string | null;         // 跨页定位时拓扑高亮节点
  deployments: Deployment[];          // 已部署蜜点（含 108 预置诱饵；同节点可多条）
  traceLayersRevealed: number;        // 溯源图谱已展开层数 0-4
  traceData: unknown | null;
  lastEvent: string | null;           // 最新事件（用于状态灯/日志）
  activity: ActivityItem[];           // 智能体行动轨迹（右栏 AGENT ACTIVITY）
  demoMode: "play" | "free";         // 播放模式（自动演示）/ 自由模式（手动输入）
  currentAlertId: string | null;      // 当前分析的告警 ID
  alertStatusMap: Record<string, AlertStatus>; // 告警状态流转
  approval: ApprovalState | null;     // 当前待审批（null=无待决）
  authMode: "confirm" | "auto";        // 操作授权模式
  autoApproveTypes: HoneypotType[];   // 本次会话已勾选自动批准的类型（数组，可序列化）
}

const nowLabel = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const clockLabel = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

let activitySeq = 0;
export function pushActivity(text: string, tone: ActivityTone = "blue") {
  const item: ActivityItem = { id: ++activitySeq, time: clockLabel(), tone, text };
  state = { ...state, activity: [...state.activity, item].slice(-80) };
  listeners.forEach((l) => l());
}

let state: AppState = {
  page: "asset",
  engine: "mock",
  runs: { asset: 1, deception: 1, attribution: 1 },
  assets: null,
  scanProgress: 0,
  scanning: false,
  selectedIp: null,
  highlightIp: null,
  // 剧本预置：108 上已有一枚 SSH 诱饵（本次告警来源，端口冲突改用 2222）
  deployments: [
    { ip: "192.168.1.108", type: "SSH", port: 2222, status: "active", progress: 100, since: "09-12 21:04", preset: true },
  ],
  traceLayersRevealed: 0,
  traceData: null,
  lastEvent: null,
  activity: [
    { id: ++activitySeq, time: clockLabel(), tone: "green" as ActivityTone, text: "智能体内核就绪 · 确定性脚本引擎在线" },
    { id: ++activitySeq, time: clockLabel(), tone: "cyan" as ActivityTone, text: "12 资产 / 9 告警 / 3 战役数据已载入" },
    { id: ++activitySeq, time: clockLabel(), tone: "muted" as ActivityTone, text: "等待指令，可从建议命令开始…" },
  ],
  demoMode: "play",
  // 二期：告警工作台 / 授权模式
  currentAlertId: null,
  alertStatusMap: Object.fromEntries(MOCK_ALERTS.map((a) => [a.id, a.status])) as Record<string, AlertStatus>,
  approval: null,
  authMode: "confirm",
  autoApproveTypes: [],
};

const listeners = new Set<() => void>();

export function getAppState(): AppState {
  return state;
}

export function setAppState(partial: Partial<AppState>) {
  state = { ...state, ...partial };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React hook：订阅全局状态（含 SSR 快照） */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getAppState, getAppState);
}

// ---- 便捷动作 ----
export function setScanProgress(progress: number, scanning: boolean) {
  setAppState({
    scanProgress: Math.max(0, Math.min(100, progress)),
    scanning,
    lastEvent: scanning ? `扫描进度 ${Math.round(progress)}%` : "内网体检完成",
  });
}

export function selectNode(ip: string | null) {
  setAppState({ selectedIp: ip, lastEvent: ip ? `选中节点 ${ip}` : null });
}

/** 跨页定位：跳到体检页并在拓扑上高亮节点 */
export function locateNode(ip: string) {
  const next: Partial<AppState> = { selectedIp: ip, highlightIp: ip, lastEvent: `定位节点 ${ip}` };
  if (state.page !== "asset") next.page = "asset";
  setAppState(next);
}

export function clearHighlight() {
  if (state.highlightIp) setAppState({ highlightIp: null });
}

export function addDeployment(ip: string, type: HoneypotType, port: number) {
  // 同节点同类型：更新进度，不再覆盖该节点其他类型部署
  const existing = state.deployments.find((d) => d.ip === ip && d.type === type);
  if (existing) {
    setAppState({
      deployments: state.deployments.map((d) =>
        d.ip === ip && d.type === type ? { ...d, port, status: "deploying", progress: 0 } : d,
      ),
      lastEvent: `${ip} ${type} 蜜点重新部署中`,
    });
    return;
  }
  setAppState({
    deployments: [...state.deployments, { ip, type, port, status: "deploying", progress: 0 }],
    lastEvent: `${ip} 部署 ${type} 蜜点`,
  });
}

export function updateDeploymentProgress(ip: string, type: HoneypotType, progress: number) {
  setAppState({
    deployments: state.deployments.map((d) =>
      d.ip === ip && d.type === type
        ? { ...d, progress, status: progress >= 100 ? "active" : "deploying", since: progress >= 100 ? d.since ?? nowLabel() : d.since }
        : d,
    ),
    lastEvent: progress >= 100 ? `${ip} ${type} 蜜点部署完成` : `${ip} ${type} 蜜点部署 ${Math.round(progress)}%`,
  });
}

/** 返回某节点全部部署（同节点可共存异类型诱饵） */
export function deploymentsOf(ip: string): Deployment[] {
  return state.deployments.filter((d) => d.ip === ip);
}

/** 返回该节点指定类型部署；省略 type 时兼容旧调用返回第一条 */
export function deploymentOf(ip: string, type?: HoneypotType): Deployment | undefined {
  const all = deploymentsOf(ip);
  return type ? all.find((d) => d.type === type) ?? all[0] : all[0];
}

// ---- 二期：告警工作台 / 授权审批 动作 ----
export function setCurrentAlertId(id: string | null) {
  setAppState({ currentAlertId: id });
}

export function setAlertStatus(alertId: string, status: AlertStatus) {
  setAppState({ alertStatusMap: { ...state.alertStatusMap, [alertId]: status } });
  const short = alertId.split("-").slice(-2).join("-");
  pushActivity(`告警 ${short} 状态流转 → ${status}`, status === "误报" ? "cyan" : status === "已闭环" ? "green" : "amber");
}

export function setApproval(approval: ApprovalState | null) {
  setAppState({ approval });
}

export function setAuthMode(mode: "confirm" | "auto") {
  setAppState({ authMode: mode, lastEvent: mode === "auto" ? "切换为自动执行模式" : "切换为逐次确认模式" });
}

export function addAutoApproveType(type: HoneypotType) {
  if (!state.autoApproveTypes.includes(type)) {
    setAppState({ autoApproveTypes: [...state.autoApproveTypes, type] });
  }
}

/** 从部署列表移除：指定 type 只移除该类型，省略则清空该节点全部诱饵 */
export function removeDeployment(ip: string, type?: HoneypotType) {
  setAppState({
    deployments: type
      ? state.deployments.filter((d) => !(d.ip === ip && d.type === type))
      : state.deployments.filter((d) => d.ip !== ip),
    lastEvent: type ? `已卸载 ${ip} 的 ${type} 诱饵` : `已清空 ${ip} 全部诱饵`,
  });
  pushActivity(type ? `卸载 ${ip} 的 ${type} 诱饵` : `清空 ${ip} 全部诱饵`, "muted");
}

/** 重放当前页：重置该页状态切片，bump run（新 threadId），由 AutoSend 重新触发预设 */
export function replayPage(page: PageKey) {
  const next: Partial<AppState> = {
    runs: { ...state.runs, [page]: state.runs[page] + 1 },
    selectedIp: null,
    approval: null,          // 未决审批作废
    currentAlertId: null,
    lastEvent: `重放演示 · ${page}`,
  };
  if (page === "asset") Object.assign(next, { assets: null, scanProgress: 0, scanning: false, highlightIp: null });
  if (page === "attribution") Object.assign(next, { traceData: null, traceLayersRevealed: 0 });
  setAppState(next);
  pushActivity(`重放演示剧本 · ${page === "asset" ? "内网体检" : page === "deception" ? "蜜点部署" : "归因分析"}`, "muted");
}

// 每次页面加载生成唯一会话 nonce：刷新后不复用 CopilotKit 本地持久化的旧线程，
// 避免「刷新页面 → 自动播放把预设问题再发一遍到历史线程」的重复问题
const sessionNonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function threadIdFor(page: PageKey): string {
  return `${page}-r${state.runs[page]}-${sessionNonce}`;
}
