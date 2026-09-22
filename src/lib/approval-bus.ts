// 审批事件总线（客户端）
// 聊天流里的 ApprovalCard 持有 CopilotKit HITL 的 respond 句柄；
// 右栏「待审批」列表的批准/拒绝按钮通过本总线远程触发同一个 respond，
// 从而保证「聊天卡片」与「右栏队列」两个入口对同一条审批始终同步。

"use client";

export interface ApprovalBusHandlers {
  /** 批准；payload 可携带方案（默认采用推荐项） */
  approve: (payload?: { strategy?: string; chosenPort?: number }) => void;
  /** 拒绝 */
  reject: () => void;
}

type Key = string;

export function approvalKey(mode: string, ip: string, type: string): Key {
  return `${mode}:${ip}:${type}`;
}

const registry = new Map<Key, ApprovalBusHandlers>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function registerApproval(key: Key, handlers: ApprovalBusHandlers): () => void {
  registry.set(key, handlers);
  emit();
  return () => {
    if (registry.get(key) === handlers) {
      registry.delete(key);
      emit();
    }
  };
}

export function unregisterApproval(key: Key) {
  if (registry.delete(key)) emit();
}

export function hasApprovalHandler(key: Key): boolean {
  return registry.has(key);
}

/** 从右栏等外部入口批准一条审批（默认采用推荐方案） */
export function approveByKey(key: Key, payload?: { strategy?: string; chosenPort?: number }): boolean {
  const h = registry.get(key);
  if (!h) return false;
  h.approve(payload);
  return true;
}

/** 从右栏等外部入口拒绝一条审批 */
export function rejectByKey(key: Key): boolean {
  const h = registry.get(key);
  if (!h) return false;
  h.reject();
  return true;
}

/** 订阅总线变化（用于外部按钮在卡片挂载/卸载时刷新可用态） */
export function subscribeApprovalBus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
