"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CopilotChat,
  CopilotKitProvider,
  useConfigureSuggestions,
} from "@copilotkit/react-core/v2";
import { DEMO_RUNTIME_URL } from "./runtime-url";
import RightPanel from "../components/RightPanel";
import {
  securityToolRenderers,
  SecurityHitl,
  securityHeaders,
  securityLabels,
  OPEN_GENERATIVE_UI,
} from "../components/security-copilot";
import { sendToChat, sentThreads, fillInputOnly, isChatRunning } from "../components/chat-actions";
import { deriveFollowUps, deriveComposerDrafts } from "../lib/suggestions-engine";
import {
  useAppState, setAppState, getAppState, replayPage, threadIdFor, locateNode, setAuthMode, pushActivity,
} from "../lib/app-store";
import type { PageKey } from "../lib/app-store";
import { Backdrop, BootSequence, Segmented, StatusDot } from "../components/hud";

/** 当前溯源样本的总层数（动态，兼容 2/3/4 层与默认 4 层） */
function traceTotalOf(st: ReturnType<typeof getAppState>): number {
  const td = st.traceData as { layers?: unknown[] } | null;
  return td?.layers?.length ?? 4;
}

const BOOT_STEPS = [
  "安全智能体内核加载完成",
  "资产/诱饵/威胁情报数据链路在线",
  "CopilotKit 运行时握手成功",
  "DeepSeek 通道待命（离线自动回退脚本引擎）",
];

// 播放模式：每页首次进入（或重放）时自动发送的预设问题
const PLAY_PRESET: Record<PageKey, string> = {
  asset: "对 192.168.1.0/24 做内网体检",
  deception: "在 192.168.1.105 部署 SSH 蜜点",
  attribution: "分析最近一条蜜点告警",
};

const PAGES: Record<PageKey, { kicker: string; title: string; sub: string }> = {
  asset: { kicker: "SYSTEMWIRE / 01 / ASSET-MAPPING", title: "内网体检", sub: "资产测绘 · 风险评估" },
  deception: { kicker: "SYSTEMWIRE / 02 / DECEPTION-DEPLOY", title: "蜜点部署", sub: "诱饵投放 · 主动防御" },
  attribution: { kicker: "SYSTEMWIRE / 03 / THREAT-ATTRIBUTION", title: "归因分析", sub: "攻击溯源 · 研判结论" },
};

// ---------- 自动播放触发器 ----------
function AutoPlay() {
  const s = useAppState();
  const tid = threadIdFor(s.page);

  useEffect(() => {
    if (s.demoMode !== "play") return;
    if (sentThreads.has(tid)) return;
    let cancelled = false;
    // remount（切页/重放）后旧聊天框可能短暂残留、连接未就绪，
    // 采用「延迟 + 重试」直到真正发送成功，成功后才占位防重
    const run = async () => {
      for (let i = 0; i < 24; i++) {
        if (cancelled || sentThreads.has(tid)) return;
        // 用户已手动发送（点推荐词/卡片按钮）则不再自动补发
        if (document.querySelectorAll(".copilotKitUserMessage").length > 0) {
          sentThreads.add(tid);
          return;
        }
        const ok = await sendToChat(PLAY_PRESET[s.page]);
        if (ok) { sentThreads.add(tid); return; }
        await new Promise((r) => setTimeout(r, 500));
      }
    };
    const t = setTimeout(run, 1200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [tid, s.demoMode, s.page]);

  return null;
}

// ---------- 自定义欢迎覆盖层 ----------
// keyed thread 会被 CopilotKit 判定为 explicit thread，官方 welcomeScreen 分支不渲染，
// 因此在聊天容器内自渲染 HUD 欢迎屏：当前线程无任何用户消息时展示，点击快捷指令直接发送。
const WELCOME_QUICK: Record<PageKey, { label: string; prompt: string; tone?: string }[]> = {
  asset: [
    { label: "▶ 对 192.168.1.0/24 做内网体检", prompt: "对 192.168.1.0/24 做内网体检", tone: "#3984ff" },
    { label: "网段里有哪些高危资产？", prompt: "网段里有哪些高危资产？" },
    { label: "你能做什么？", prompt: "你能做什么？" },
  ],
  deception: [
    { label: "▶ 在 192.168.1.105 部署 SSH 蜜点", prompt: "在 192.168.1.105 部署 SSH 蜜点", tone: "#22d3ee" },
    { label: "107 上的 MySQL 能放诱饵吗？", prompt: "192.168.1.107 上部署 SQL 蜜点怎么处理端口冲突？" },
    { label: "查看当前已部署的诱饵", prompt: "查看当前已部署的诱饵与告警情况" },
  ],
  attribution: [
    { label: "▶ 分析最近一条蜜点告警", prompt: "分析最近一条蜜点告警", tone: "#ef4444" },
    { label: "分析攻击活动 C-0919", prompt: "分析攻击活动 C-0919，把相关告警串起来" },
    { label: "分析账号 wangwei 的关联事件", prompt: "分析关联事件 wangwei" },
  ],
};

function WelcomeOverlay({ page }: { page: PageKey }) {
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const check = () => {
      const hasUser = document.querySelectorAll(".ck-chat .copilotKitUserMessage").length > 0;
      setEmpty(!hasUser);
    };
    check();
    const obs = new MutationObserver(check);
    const root = document.querySelector(".ck-chat") ?? document.body;
    obs.observe(root, { childList: true, subtree: true });
    const timer = setInterval(check, 800);
    return () => { obs.disconnect(); clearInterval(timer); };
  }, []);

  if (!empty) return null;
  const quick = WELCOME_QUICK[page];

  return (
    <div
      className="hud-slide-up"
      style={{
        position: "absolute", inset: "6px 0 78px", zIndex: 5, overflow: "auto",
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "10px 6px", pointerEvents: "auto",
        background:
          "radial-gradient(620px 300px at 12% -10%, rgba(57,132,255,0.1), transparent 60%), radial-gradient(480px 280px at 110% 112%, rgba(34,211,238,0.06), transparent 55%), #06080c",
      }}
    >
      <div className="hud-card hud-glow" style={{ margin: 0 }}>
        <CornerMarks />
        <div className="hud-card-body" style={{ display: "flex", gap: 16, alignItems: "flex-start", padding: "22px 24px" }}>
          <BrandMark size={52} />
          <div style={{ flex: 1 }}>
            <div className="hud-kicker" style={{ color: "#5b9bff" }}>SYSTEMWIRE // INTERNAL DEFENSE COPILOT</div>
            <div style={{ fontSize: 19, color: "#e8eefc", fontWeight: 700, letterSpacing: 2, margin: "7px 0 4px", fontFamily: "IBM Plex Mono, monospace" }}>
              内网安全智能体
            </div>
            <div style={{ fontSize: 12, color: "#9fb0cc", lineHeight: 1.9 }}>
              演示网段 <span className="hud-term" style={{ padding: "1px 7px" }}>192.168.1.0/24</span> 共 <b style={{ color: "#e8eefc" }}>12</b> 个资产在线。
              集成资产测绘、漏洞评估、主动诱捕（蜜点投放）、攻击溯源与人工授权闭环；
              推理引擎可在 <span style={{ color: "#34d399" }}>离线演示脚本</span> 与 <span style={{ color: "#22d3ee" }}>DeepSeek</span> 间切换，断网自动回退。
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 12 }}>
        {[
          { t: "资产测绘", en: "ASSET-MAPPING", d: "LLDP/端口扫描、漏洞检测、实时拓扑", c: "#3984ff" },
          { t: "主动诱捕", en: "DECEPTION-DEPLOY", d: "端口冲突四方案、HITL 授权、自动批准", c: "#22d3ee" },
          { t: "攻击溯源", en: "THREAT-ATTRIBUTION", d: "杀伤链逐层解锁、置信度、攻击活动关联", c: "#ef4444" },
        ].map((x) => (
          <div key={x.en} className="hud-panel-flat" style={{ padding: "11px 13px", borderTop: `2px solid ${x.c}` }}>
            <div style={{ fontSize: 12, color: "#e8eefc", fontWeight: 700 }}>{x.t}</div>
            <div style={{ fontSize: 8.5, color: x.c, letterSpacing: 1.5, fontFamily: "IBM Plex Mono, monospace", margin: "2px 0 6px" }}>{x.en}</div>
            <div style={{ fontSize: 10.5, color: "#7c8aa5", lineHeight: 1.7 }}>{x.d}</div>
          </div>
        ))}
      </div>

      <div className="hud-kicker" style={{ color: "#5c6b85", margin: "14px 2px 8px" }}>QUICK START / 快捷指令</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {quick.map((q) => (
          <button
            key={q.label}
            className="hud-btn hud-btn-ghost"
            style={{ textAlign: "left", justifyContent: "flex-start", borderColor: q.tone ? q.tone : "#1e2c45", color: q.tone ? "#cfe0ff" : "#a1aec2" }}
            onClick={() => sendToChat(q.prompt)}
          >
            {q.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CornerMarks() {
  const c = "#3984ff";
  const s: CSSProperties = { position: "absolute", width: 12, height: 12, borderColor: c, borderStyle: "solid", pointerEvents: "none" };
  return (
    <>
      <span style={{ ...s, top: -1, left: -1, borderWidth: "1.5px 0 0 1.5px" }} />
      <span style={{ ...s, top: -1, right: -1, borderWidth: "1.5px 1.5px 0 0" }} />
      <span style={{ ...s, bottom: -1, left: -1, borderWidth: "0 0 1.5px 1.5px" }} />
      <span style={{ ...s, bottom: -1, right: -1, borderWidth: "0 1.5px 1.5px 0" }} />
    </>
  );
}

// ---------- 输入框上方推荐提示词（随页面与进度变化；点击只填入不发送） ----------
// 命中 suggestion chip（含 welcomeScreen 的 suggestionView）时，在捕获阶段拦截：
// preventDefault + stopPropagation 阻断 CopilotKit 默认的「点击即发送」，
// 改为 fillInputOnly 只把文本填入输入框、光标置末，不点击发送。
function suggestionChipFrom(el: EventTarget | null): HTMLElement | null {
  let node = el as HTMLElement | null;
  let depth = 0;
  while (node && depth < 6) {
    const cls = typeof node.className === "string" ? node.className : "";
    const ds = node.getAttribute?.("data-suggestion");
    if (/uggestion|Suggestion|pill|Pill/.test(cls) || ds) return node;
    node = node.parentElement;
    depth++;
  }
  return null;
}

function SuggestionsConfigurator() {
  const s = useAppState();

  const drafts = deriveComposerDrafts(s);

  useConfigureSuggestions(
    { suggestions: drafts.map((t) => ({ title: t, message: t })), available: "always" },
    [drafts.join("|")],
  );

  useEffect(() => {
    const onClick = (e: Event) => {
      const chip = suggestionChipFrom(e.target);
      if (!chip) return;
      // 不拦截我们自己渲染的回复下方建议按钮组
      if (chip.closest(".ck-followups")) return;
      e.preventDefault();
      e.stopPropagation();
      const text = (chip.textContent || "").trim();
      if (text) fillInputOnly(text);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}

// ---------- 消息内 IP 自动可点击（CIDR 排除），点击定位拓扑节点 ----------
function IpLinkifier() {
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const IP_RE = /(?<!\d)(192\.168\.1\.(?:1\d\d?|1[01]\d|11[0-2]))(?!\/)/g;
    const SKIP = new Set(["BUTTON", "A", "SCRIPT", "STYLE", "TEXTAREA"]);
    // 已处理且不含 IP 的文本节点（流式增长的尾节点不标记，后续可再次切分）
    const cleanNodes = new WeakSet<Text>();

    const splitNode = (node: Text) => {
      IP_RE.lastIndex = 0;
      const text = node.nodeValue ?? "";
      if (!IP_RE.test(text)) { cleanNodes.add(node); return; }
      IP_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      let m: RegExpExecArray | null;
      while ((m = IP_RE.exec(text))) {
        frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const btn = document.createElement("button");
        btn.className = "ck-ip-link";
        btn.textContent = m[0];
        const ip = m[0];
        btn.addEventListener("click", () => locateNode(ip));
        frag.appendChild(btn);
        last = m.index + m[0].length;
      }
      // 尾部文本保持未标记，流式追加的 IP 仍能被二次切分
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode?.replaceChild(frag, node);
    };

    const process = (root: ParentNode | Node) => {
      const scope = (root as ParentNode).querySelectorAll
        ? (root as ParentNode)
        : (root.parentNode as ParentNode | null);
      if (!scope) return;
      const msgs =
        (root as Element).classList?.contains("copilotKitAssistantMessage")
          ? [root as Element]
          : Array.from(scope.querySelectorAll?.(".copilotKitAssistantMessage") ?? []);
      msgs.forEach((msg) => {
        const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) => {
            const p = (node as Text).parentElement;
            if (!p || SKIP.has(p.tagName) || p.classList?.contains("ck-ip-link")) return NodeFilter.FILTER_REJECT;
            if (cleanNodes.has(node as Text)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const targets: Text[] = [];
        while (walker.nextNode()) targets.push(walker.currentNode as Text);
        targets.forEach(splitNode);
      });
    };

    process(document);
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") process(m.target);
        m.addedNodes.forEach((n) => { if (n.nodeType === 1) process(n as ParentNode); });
      }
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    // 兜底轮询（流式渲染时序问题）
    const timer = setInterval(() => process(document), 1200);
    observerRef.current = obs;
    return () => { obs.disconnect(); clearInterval(timer); };
  }, []);

  return null;
}

// ---------- AI 回复下方建议执行动作（MutationObserver + 纯 DOM 按钮，点击即发送） ----------
// 与 IpLinkifier 同模式：不依赖 React portal，直接在最后一条完成态 assistant 消息内 append 按钮组。
// 仅在消息流空闲（非流式、图谱不在解锁中、无待审批）时渲染一次，按 id/文案去重。
function FollowUpActionsRenderer() {
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const processed = new WeakSet<Element>();

    const busy = () => {
      const st = getAppState();
      return (
        isChatRunning() ||
        (!!st.traceData && st.traceLayersRevealed > 0 && st.traceLayersRevealed < traceTotalOf(st)) ||
        !!st.approval
      );
    };

    const lastAssistantMsg = (): Element | null => {
      const msgs = document.querySelectorAll(".copilotKitAssistantMessage");
      return msgs.length ? msgs[msgs.length - 1] : null;
    };

    const inferLastTool = (msg: Element): string | undefined => {
      const html = msg.innerHTML;
      if (html.includes("ASSET-MAPPING")) return "scanAsset";
      if (html.includes("THREAT-ATTRIBUTION")) return "traceAttack";
      if (html.includes("DECEPTION-DEPLOY")) return "deployHoneypot";
      if (html.includes("DECEPTION-UNDEPLOY")) return "removeHoneypot";
      if (html.includes("APPROVAL")) return "requestDeployApproval";
      return undefined;
    };

    const scan = () => {
      if (busy()) return;
      const msg = lastAssistantMsg();
      if (!msg || processed.has(msg)) return;
      const text = (msg.textContent || "").trim();
      if (!text) return;

      const state = getAppState();
      const lastTool = inferLastTool(msg);
      const actions = deriveFollowUps(state, text, lastTool);
      if (!actions.length) { processed.add(msg); return; }

      // 去重：同一文案的按钮若卡片内已存在则跳过
      const existing = new Set(
        Array.from(msg.querySelectorAll("button")).map((b) => (b.textContent || "").trim()),
      );
      const filtered = actions.filter((a) => !existing.has(a.label));
      processed.add(msg);
      if (!filtered.length) return;

      const box = document.createElement("div");
      box.className = "ck-followups";
      box.style.cssText =
        "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0 4px;";
      const kicker = document.createElement("div");
      kicker.className = "ck-followups-kicker";
      kicker.style.cssText =
        "font-size:9px;letter-spacing:2px;color:#5c6b85;font-family:IBM Plex Mono,monospace;width:100%;";
      kicker.textContent = "建议操作";
      box.appendChild(kicker);

      filtered.forEach((a) => {
        const btn = document.createElement("button");
        btn.className = "ck-followup-btn";
        btn.textContent = a.label;
        const primary = a.kind === "primary";
        btn.style.cssText = [
          "font-family:IBM Plex Mono,monospace",
          "font-size:11px",
          "padding:6px 12px",
          "border-radius:6px",
          "cursor:pointer",
          "transition:all .15s",
          primary ? "background:#0b1220" : "background:transparent",
          primary ? "border:1px solid #3984ff" : "border:1px solid #294a79",
          primary ? "color:#cfe0ff" : "color:#a1aec2",
          primary ? "box-shadow:0 0 10px rgba(57,132,255,0.18)" : "none",
        ].join(";");
        btn.addEventListener("click", () => { sendToChat(a.prompt); });
        box.appendChild(btn);
      });
      msg.appendChild(box);
    };

    scan();
    const obs = new MutationObserver(() => {
      const anyObs = obs as unknown as { _t?: ReturnType<typeof setTimeout> };
      clearTimeout(anyObs._t);
      anyObs._t = setTimeout(scan, 500);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    observerRef.current = obs;
    const timer = setInterval(scan, 1500);
    return () => { obs.disconnect(); clearInterval(timer); };
  }, []);

  return null;
}

// ---------- 主页面 ----------
export default function Home() {
  const s = useAppState();
  const page = s.page;
  const tid = threadIdFor(page);
  const [booted, setBooted] = useState(false);

  // 键盘 1/2/3 切页（输入框聚焦时不拦截）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "1") setAppState({ page: "asset" });
      if (e.key === "2") setAppState({ page: "deception" });
      if (e.key === "3") setAppState({ page: "attribution" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 默认「逐次确认」：蜜点页自动播放会停在 HITL 审批卡上，突出人机协同；
  // 「自动执行」由左下角授权开关手动开启（演示 Agent 自主决策链路）
  useEffect(() => {
    setAuthMode("confirm");
  }, [s.demoMode]);

  const waitingApproval = !!s.approval;
  const working =
    !waitingApproval &&
    (s.scanning ||
      s.deployments.some((d) => d.status === "deploying") ||
      (page === "attribution" && !!s.traceData && s.traceLayersRevealed > 0 && s.traceLayersRevealed < traceTotalOf(s)));

  return (
    <CopilotKitProvider
      runtimeUrl={DEMO_RUNTIME_URL}
      renderToolCalls={securityToolRenderers}
      openGenerativeUI={OPEN_GENERATIVE_UI}
      headers={securityHeaders}
      enableInspector={false}
    >
      <SecurityHitl />
      <AutoPlay />
      <SuggestionsConfigurator />
      <IpLinkifier />
      <FollowUpActionsRenderer />

      <Backdrop />
      {!booted && <BootSequence steps={BOOT_STEPS} onDone={() => setBooted(true)} />}

      <div style={{ position: "relative", display: "flex", height: "100vh", width: "100vw", background: "transparent", color: "#a1aec2", overflow: "hidden" }}>
        <SideNav page={page} onChange={(p) => setAppState({ page: p, lastEvent: `切换到 ${PAGES[p].title}` })} />

        <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <SessionHeader
            kicker={PAGES[page].kicker}
            title={PAGES[page].title}
            sub={PAGES[page].sub}
            working={working}
            waitingApproval={waitingApproval}
            onReplay={() => {
              const wasPlay = getAppState().demoMode === "play";
              replayPage(page);
              // 播放模式由 AutoPlay effect 自动发送；自由模式手动补发
              if (!wasPlay) setTimeout(() => sendToChat(PLAY_PRESET[page]), 700);
            }}
          />

          <div style={{ flex: 1, minHeight: 0, padding: "0 20px 12px", display: "flex", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: 880, display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
              <CopilotChat
                className="ck-chat"
                key={tid}
                threadId={tid}
                hasExplicitThreadId={false}
                welcomeScreen={false}
                labels={securityLabels}
              />
              <WelcomeOverlay key={"welcome-" + tid} page={page} />
            </div>
          </div>
        </main>

        <RightPanel />
      </div>
    </CopilotKitProvider>
  );
}

/** 盾形品牌标 */
function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ flex: "none", filter: "drop-shadow(0 0 6px rgba(57,132,255,.6))" }}>
      <path d="M24 5 L40 11 V24 C40 33 33.5 39.5 24 43 C14.5 39.5 8 33 8 24 V11 Z" fill="rgba(57,132,255,.16)" stroke="#5b9bff" strokeWidth="1.6" />
      <path d="M16 24 L22 30 L33 18" fill="none" stroke="#aee9ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- 左栏导航 ----------
function SideNav({ page, onChange }: { page: PageKey; onChange: (p: PageKey) => void }) {
  const s = useAppState();
  const items: { key: PageKey; en: string; title: string; icon: string }[] = [
    { key: "asset", en: "ASSET-MAPPING", title: "内网体检", icon: "◎" },
    { key: "deception", en: "DECEPTION-DEPLOY", title: "蜜点部署", icon: "◈" },
    { key: "attribution", en: "THREAT-ATTRIBUTION", title: "归因分析", icon: "◉" },
  ];
  return (
    <aside style={{ width: 232, minWidth: 232, borderRight: "1px solid #14233c", background: "linear-gradient(180deg,#0a0e16,#080b11)", display: "flex", flexDirection: "column", padding: "16px 13px", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 6px 15px", borderBottom: "1px solid #16263f" }}>
        <BrandMark size={34} />
        <div>
          <div className="hud-glow" style={{ fontSize: 13, letterSpacing: 3, color: "#dbeaff", fontWeight: 700, fontFamily: "IBM Plex Mono, monospace" }}>SYSTEMWIRE</div>
          <div style={{ fontSize: 11, color: "#8fa0bb", marginTop: 2 }}>内网安全智能体</div>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#46566f", marginTop: 1, fontFamily: "IBM Plex Mono, monospace" }}>AI SECURITY AGENT</div>
        </div>
      </div>

      {items.map((it, i) => {
        const active = page === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{
              position: "relative", textAlign: "left", cursor: "pointer", padding: "10px 12px",
              border: `1px solid ${active ? "#294a79" : "transparent"}`,
              borderLeft: `2.5px solid ${active ? "#3984ff" : "transparent"}`,
              background: active ? "linear-gradient(90deg,rgba(57,132,255,.16),rgba(11,18,32,.4))" : "transparent",
              color: active ? "#e8eefc" : "#7c8aa5",
              clipPath: "polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)",
              boxShadow: active ? "0 0 16px rgba(57,132,255,.15)" : "none",
              transition: "all .15s", fontFamily: "inherit",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 9, color: active ? "#3984ff" : "#3a465c", fontFamily: "IBM Plex Mono, monospace" }}>0{i + 1}</span>
              <span style={{ fontSize: 13, color: active ? "#7db0ff" : "#46566f" }}>{it.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{it.title}</span>
            </div>
            <div style={{ fontSize: 8, letterSpacing: 1.5, color: active ? "#5b82b8" : "#3f4c63", marginTop: 3, paddingLeft: 26, fontFamily: "IBM Plex Mono, monospace" }}>
              {it.en}
            </div>
          </button>
        );
      })}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 11, borderTop: "1px solid #16263f", paddingTop: 12 }}>
        <ControlLabel en="LLM ENGINE" zh="推理引擎" tone={s.engine === "deepseek" ? "#22d3ee" : "#34d399"} />
        <Segmented
          options={[
            { value: "mock", label: "演示脚本" },
            { value: "deepseek", label: "DeepSeek" },
          ]}
          value={s.engine}
          onChange={(m) => {
            setAppState({ engine: m });
            pushActivity(m === "deepseek" ? "推理引擎切换为 DeepSeek（失败自动回退脚本）" : "推理引擎切换为离线演示脚本", m === "deepseek" ? "cyan" : "green");
          }}
        />
        <ControlLabel en="DEMO MODE" zh="演示模式" />
        <Segmented
          options={[
            { value: "play", label: "▶ 自动播放" },
            { value: "free", label: "✎ 自由操作" },
          ]}
          value={s.demoMode}
          onChange={(m) => setAppState({ demoMode: m })}
        />
        <ControlLabel en="AUTHORITY" zh="操作授权" tone={s.authMode === "auto" ? "#f59e0b" : "#34d399"} />
        <Segmented
          options={[
            { value: "confirm", label: "逐次确认" },
            { value: "auto", label: "自动执行", danger: true },
          ]}
          value={s.authMode}
          onChange={(m) => setAuthMode(m)}
          dangerOn="auto"
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 4, border: "1px solid #14233c", padding: "7px 8px" }}>
          <div style={{ fontSize: 8, letterSpacing: 2, color: "#46566f", fontFamily: "IBM Plex Mono, monospace", padding: "0 2px 3px" }}>EMBED FORMS / 嵌入形态</div>
          {[
            { href: "/popup", label: "◔ 悬浮助手" },
            { href: "/sidebar", label: "▥ 侧边栏助手" },
            { href: "/single", label: "▣ 嵌入式终端" },
            { href: "/mcp-apps", label: "⬡ 能力中心" },
          ].map((l) => (
            <a
              key={l.href}
              href={l.href}
              style={{ fontSize: 10.5, color: "#7c8aa5", textDecoration: "none", padding: "3px 4px", fontFamily: "IBM Plex Mono, monospace" }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "#7db0ff"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "#7c8aa5"; }}
            >
              {l.label}
            </a>
          ))}
        </div>
        <div style={{ fontSize: 9, color: "#3a465c", fontFamily: "IBM Plex Mono, monospace", padding: "0 2px", letterSpacing: 1 }}>
          [1] [2] [3] 键盘切页
        </div>
      </div>
    </aside>
  );
}

function ControlLabel({ en, zh, tone = "#5c6b85" }: { en: string; zh: string; tone?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px" }}>
      <span className="hud-dot" style={{ ["--dot" as string]: tone, width: 5, height: 5 }} />
      <span style={{ fontSize: 9, letterSpacing: 2, color: "#7c8aa5", fontFamily: "IBM Plex Mono, monospace" }}>{en}</span>
      <span style={{ fontSize: 9, color: "#46566f" }}>· {zh}</span>
    </div>
  );
}

// ---------- 实时时钟 ----------
function HudClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setNow(`${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
    };
    fmt();
    const t = setInterval(fmt, 1000);
    return () => clearInterval(t);
  }, []);
  return <span style={{ fontSize: 11, color: "#8fa0bb", letterSpacing: 1, fontVariantNumeric: "tabular-nums" }}>{now}</span>;
}

// ---------- 会话头 + 状态灯 + 重放 ----------
function SessionHeader({
  kicker, title, sub, working, waitingApproval, onReplay,
}: {
  kicker: string; title: string; sub: string; working: boolean; waitingApproval: boolean; onReplay: () => void;
}) {
  const tone = waitingApproval ? "amber" : working ? "cyan" : "green";
  const label = waitingApproval ? "WAITING APPROVAL · 待授权" : working ? "AGENT WORKING · 执行中" : "AGENT READY · 就绪";

  return (
    <div style={{ padding: "13px 20px 11px", borderBottom: "1px solid #16263f", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "linear-gradient(180deg,rgba(13,20,34,.5),transparent)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 13, minWidth: 0 }}>
        <span style={{ width: 3, height: 30, background: "linear-gradient(180deg,#3984ff,transparent)", flex: "none", boxShadow: "0 0 8px #3984ff" }} />
        <div style={{ minWidth: 0 }}>
          <div className="hud-kicker" style={{ color: "#5b9bff" }}>{kicker}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 }}>
            <h1 style={{ fontSize: 18, color: "#e8eefc", fontWeight: 700, margin: 0, letterSpacing: 1, whiteSpace: "nowrap", flex: "none" }}>{title}</h1>
            <span style={{ fontSize: 11, color: "#5c6b85", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, flex: "none" }}>
        <HudClock />
        <button className="hud-btn hud-btn-ghost hud-btn-sm" onClick={onReplay} title="重置本页并重新播放演示">
          ↻ 重放
        </button>
        <div className="hud-tag" style={{ color: waitingApproval ? "#f59e0b" : working ? "#22d3ee" : "#34d399", display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px" }}>
          <StatusDot tone={tone} pulse={waitingApproval || working} />
          {label}
        </div>
      </div>
    </div>
  );
}
