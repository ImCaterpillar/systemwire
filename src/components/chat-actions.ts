"use client";

// 聊天输入注入工具：用原生 setter + InputEvent 同步 React 19 受控状态，
// 轮询等待发送按钮就绪（SSE 连接建立前是 disabled）后点击发送。
// 所有"点击即发送"的按钮（推荐提示词、报告卡、右栏操作、自动播放）统一走这里。

import { setAppState, threadIdFor } from "../lib/app-store";
import type { PageKey } from "../lib/app-store";

/**
 * 已自动/跨页发送过的线程 id（与 page.tsx 的 AutoPlay 共享）。
 * 跨页按钮发送成功后必须占位，否则播放模式 AutoPlay 会在目标线程再发一遍。
 */
export const sentThreads = new Set<string>();

/** 跨页发送：先切页（聊天 remount），等新输入框挂载后再发送 */
export function crossPageSend(page: PageKey, text: string, delay = 650) {
  setAppState({ page, lastEvent: `跨页发送：${text}` });
  setTimeout(async () => {
    const ok = await sendToChat(text);
    if (ok) sentThreads.add(threadIdFor(page));
  }, delay);
}

function findTextarea(): HTMLTextAreaElement | null {
  const list = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>(".copilotKitChat textarea, .copilotKitInput textarea"),
  );
  // 优先可见的输入框
  const visible = list.find((el) => el.offsetParent !== null && !el.disabled);
  return visible ?? list[0] ?? null;
}

/** 找到发送按钮（排除 + 附件等 tooltip 按钮） */
function findSendButton(ta: HTMLTextAreaElement): HTMLButtonElement | null {
  const root = ta.closest(".copilotKitInput") ?? document;
  const btns = Array.from(root.querySelectorAll<HTMLButtonElement>("button"));
  const candidates = btns.filter((b) => b.getAttribute("data-slot") !== "tooltip-trigger");
  return candidates[candidates.length - 1] ?? null;
}

export function isChatRunning(): boolean {
  const el = document.querySelector<HTMLElement>(".copilotKitChat[data-copilot-running='true']");
  return !!el;
}

/**
 * 只把文本填入输入框（不发送），用于 composer 草稿建议 / 回复下方建议动作的「填入」场景。
 * 复用 sendToChat 的原生 setter + InputEvent 写法同步 React 19 受控状态，
 * 但不点击发送按钮；聚焦并把光标置于末尾。返回是否成功。
 */
export function fillInputOnly(text: string): boolean {
  const ta = findTextarea();
  if (!ta) return false;
  if (!text) {
    ta.focus();
    return true;
  }
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  ta.focus();
  const end = ta.value.length;
  try {
    ta.setSelectionRange(end, end);
  } catch {
    /* 部分非标准 textarea 不支持，忽略 */
  }
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function sendToChat(text: string): Promise<boolean> {
  // 运行中不重复发送
  if (isChatRunning()) return false;
  const ta = findTextarea();
  if (!ta) return false;
  if (ta.value.trim() === text) return false;

  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  ta.focus();

  // 轮询等待发送按钮变为可用（连接握手 / dev 冷编译 / remount 可能较久）
  let liveTa: HTMLTextAreaElement | null = ta;
  let btn = findSendButton(ta);
  for (let i = 0; i < 100 && !(btn && !btn.disabled); i++) {
    await sleep(150);
    // remount 后旧 textarea 会失效，每轮重新获取可见输入框
    const fresh = findTextarea();
    if (fresh && fresh !== ta && fresh.isConnected) liveTa = fresh;
    btn = liveTa ? findSendButton(liveTa) : null;
  }
  const targetTa = liveTa ?? ta;
  if (!btn || btn.disabled) {
    // 兜底：回车发送
    targetTa.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
    await sleep(200);
    return targetTa.value.trim() === "";
  }
  btn.click();
  await sleep(200);
  // 发送成功的判定：输入框已清空（可能已 remount，重新查找）
  const after = findTextarea();
  return !after || after.value.trim() === "";
}
