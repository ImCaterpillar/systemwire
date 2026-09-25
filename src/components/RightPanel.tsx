"use client";

// 右栏信息架构（二期重做，300px 可折叠）：身份条 + 可折叠分区
// 01 体检页 5 分区 / 02 蜜点页 5 分区 / 03 归因页 7 分区
import { useState, useEffect, useRef } from "react";
import {
  useAppState, setAppState, selectNode,
  setCurrentAlertId, setAlertStatus, deploymentsOf,
} from "../lib/app-store";
import { sendToChat, crossPageSend } from "./chat-actions";
import { approvalKey, approveByKey, rejectByKey, subscribeApprovalBus } from "../lib/approval-bus";
import {
  MOCK_ASSETS, HONEYPOT_TEMPLATES, SCAN_PHASES, DEPLOY_RECOMMENDATIONS,
  MOCK_ALERTS, getTraceData, getRecentAlerts, ALERT_TREND_14D,
  evaluateDeploy, isHostSupported, recommendedType, unsupportedReason,
  MAX_DEPLOYMENTS_PER_NODE,
} from "../lib/mock-data";
import type { Asset, HoneypotType, Alert, AlertStatus } from "../lib/mock-data";
import { AlertQueue } from "./AlertQueue";
import { Tag, StatusDot, CountUp, Bar } from "./hud";

const MONO = "IBM Plex Mono, monospace";

/** 审批总线版本号：远程批准/拒绝后刷新右栏按钮可用态 */
function useApprovalBusVersion(): number {
  const [v, setV] = useState(0);
  useEffect(() => subscribeApprovalBus(() => setV((x) => x + 1)), []);
  return v;
}

// ---------- 通用小工具 ----------
/** ALERT-2026-0919-001 -> 0919-001 */
function shortId(id: string): string {
  return id.split("-").slice(-2).join("-");
}

/** 只把 IP 填入输入框草稿，不发送。
 *  TODO: chat-actions 后续新增 fillInputOnly(text) 后，替换为该函数。 */
function fillDraft(text: string) {
  const list = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>(".copilotKitChat textarea, .copilotKitInput textarea"),
  );
  const ta = list.find((el) => el.offsetParent !== null && !el.disabled) ?? list[0];
  if (!ta) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(ta, text);
  ta.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  ta.focus();
}

// ---------- 通用 UI 件 ----------
function Chip({ n, label }: { n: React.ReactNode; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3, fontSize: 10, color: "#5c6b85" }}>
      <span style={{ color: "#e8eefc", fontFamily: MONO, fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{n}</span>
      {label}
    </span>
  );
}

function CollapsibleSection({
  title, count, defaultOpen, accent, children,
}: {
  title: string; count?: number; defaultOpen?: boolean; accent?: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? true);
  useEffect(() => {
    setOpen(defaultOpen ?? true);
  }, [defaultOpen]);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: MONO,
        }}
      >
        <span className="hud-kicker" style={{ color: accent ?? "#5c6b85" }}>{title}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {count !== undefined && count > 0 && (
            <span className="hud-tag" style={{ color: accent ?? "#7db0ff", fontSize: 9 }}>{count}</span>
          )}
          <span style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .2s", color: "#5c6b85", fontSize: 8 }}>▶</span>
        </span>
      </button>
      {open && <div style={{ marginTop: 9 }}>{children}</div>}
    </div>
  );
}

function EmptyState({ icon, text, actionLabel, onAction }: { icon: string; text: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div style={{ border: "1px dashed #1e2c45", borderRadius: 8, padding: "12px 10px", textAlign: "center", color: "#5c6b85" }}>
      <div style={{ fontSize: 16 }}>{icon}</div>
      <div style={{ fontSize: 11, marginTop: 5, lineHeight: 1.7, whiteSpace: "pre-line" }}>{text}</div>
      {actionLabel && (
        <button
          onClick={onAction}
          style={{ marginTop: 8, fontSize: 10, fontFamily: MONO, cursor: "pointer", borderRadius: 5, padding: "3px 10px", background: "rgba(57,132,255,0.1)", color: "#3984ff", border: "1px solid #294a79" }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function MiniRing({ progress, color }: { progress: number; color: string }) {
  const r = 11;
  const c = 2 * Math.PI * r;
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" style={{ flexShrink: 0 }}>
      <circle cx="14" cy="14" r={r} fill="none" stroke="#15233a" strokeWidth="3" />
      <circle cx="14" cy="14" r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c}
        strokeDashoffset={c * (1 - progress / 100)} strokeLinecap="round" transform="rotate(-90 14 14)" />
    </svg>
  );
}

/** 近 14 天告警迷你折线（纯 SVG，无图表库） */
function MiniTrendChart({ data }: { data: { date: string; count: number; critical: number }[] }) {
  const w = 260, h = 60, pad = 4;
  const max = Math.max(1, ...data.map((d) => d.count));
  const n = data.length;
  const x = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, n - 1);
  const y = (v: number) => h - 12 - (v / max) * (h - 22);
  const linePts = data.map((d, i) => `${x(i)},${y(d.count)}`).join(" ");
  const area = `M${x(0)},${h - 8} L` + data.map((d, i) => `${x(i)},${y(d.count)}`).join(" L") + ` L${x(n - 1)},${h - 8} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block", maxWidth: "100%" }}>
      <defs>
        <linearGradient id="mtg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3984ff" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#3984ff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#mtg)" />
      <polyline points={linePts} fill="none" stroke="#3984ff" strokeWidth="1.5" />
      {data.map((d, i) => d.critical > 0 && (
        <circle key={"c" + i} cx={x(i)} cy={y(d.count)} r="3" fill="#ef4444" />
      ))}
      {data.map((d, i) => i % 3 === 0 && (
        <text key={"t" + i} x={x(i)} y={h - 1} fontSize="7" fill="#5c6b85" fontFamily={MONO}>{d.date}</text>
      ))}
    </svg>
  );
}

/** 置信度环（纯 SVG） */
function ConfRing({ value }: { value: number }) {
  const r = 16, c = 2 * Math.PI * r;
  return (
    <svg width="46" height="46" viewBox="0 0 46 46" style={{ flexShrink: 0 }}>
      <circle cx="23" cy="23" r={r} fill="none" stroke="#15233a" strokeWidth="4" />
      <circle cx="23" cy="23" r={r} fill="none" stroke="#f59e0b" strokeWidth="4" strokeDasharray={c}
        strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" transform="rotate(-90 23 23)" />
      <text x="23" y="26" textAnchor="middle" fontSize="9" fill="#e8eefc" fontFamily={MONO}>{value}%</text>
    </svg>
  );
}

// ================= 智能体活动轨迹（跨页面常驻，对标 Agentic SOC 调查步骤流） =================
const ACTIVITY_COLOR: Record<string, string> = {
  blue: "#3984ff",
  cyan: "#22d3ee",
  green: "#34d399",
  amber: "#f59e0b",
  red: "#ef4444",
  muted: "#5c6b85",
};

function ActivityLog() {
  const activity = useAppState().activity;
  const boxRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [pinned, setPinned] = useState(true);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const box = boxRef.current;
    if (box && pinned) box.scrollTop = box.scrollHeight;
  }, [activity, pinned]);
  return (
    <div style={{ border: "1px solid #16263f", background: "rgba(8,13,21,.66)", position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 9px", borderBottom: "1px solid #14233c" }}>
        <span className="hud-kicker" style={{ color: "#22d3ee", fontSize: 9 }}>
          <span className="hud-dot pulse" style={{ ["--dot" as string]: "#22d3ee", width: 5, height: 5, marginRight: 5 }} />
          AGENT ACTIVITY / 智能体活动
        </span>
        <span style={{ fontSize: 8, color: "#4d5a70", fontFamily: MONO }}>{activity.length} 步</span>
      </div>
      <div
        ref={boxRef}
        onWheel={(e) => setPinned(!(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight > 30))}
        style={{ maxHeight: 138, overflowY: "auto", padding: "6px 9px", display: "flex", flexDirection: "column", gap: 4 }}
      >
        {activity.map((it) => {
          const c = ACTIVITY_COLOR[it.tone] ?? "#3984ff";
          return (
            <div key={it.id} className="hud-fade-in" style={{ display: "flex", gap: 7, fontSize: 10, lineHeight: 1.55, alignItems: "baseline" }}>
              <span style={{ color: "#42506b", fontFamily: MONO, fontSize: 8.5, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{mounted ? it.time : "--:--:--"}</span>
              <span style={{ width: 5, height: 5, borderRadius: 3, background: c, boxShadow: `0 0 5px ${c}`, flexShrink: 0, transform: "translateY(-1px)" }} />
              <span style={{ color: it.tone === "muted" ? "#7689a8" : "#c3d0e6", wordBreak: "break-word" }}>{it.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ================= 顶层右栏 =================
export default function RightPanel() {
  const s = useAppState();
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <div style={{ width: 40, minWidth: 40, borderLeft: "1px solid #1e2c45", background: "#0b0e14", display: "flex", alignItems: "center", flexDirection: "column", paddingTop: 12, gap: 8 }}>
        <button onClick={() => setCollapsed(false)} style={{ background: "none", border: "none", color: "#5c6b85", cursor: "pointer", fontSize: 18, fontFamily: MONO }}>◀</button>
        <div style={{ writingMode: "vertical-rl", fontSize: 10, letterSpacing: 3, color: "#3984ff", fontFamily: MONO }}>DETAILS</div>
      </div>
    );
  }

  // ---- 身份条数据（随 store 实时变） ----
  const statusOf = (a: Alert): AlertStatus => s.alertStatusMap[a.id] ?? a.status;
  const pending = MOCK_ALERTS.filter((a) => statusOf(a) === "待研判").length;
  const closed = MOCK_ALERTS.filter((a) => statusOf(a) === "已闭环").length;
  const critOpen = MOCK_ALERTS.filter((a) => a.severity === "critical" && statusOf(a) !== "已闭环" && statusOf(a) !== "误报").length;
  const deployedHosts = new Set(s.deployments.map((d) => d.ip)).size;
  const todayAlerts = ALERT_TREND_14D[ALERT_TREND_14D.length - 1]?.count ?? 0;
  const highAssets = MOCK_ASSETS.filter((a) => a.risk === "high").length;
  const deployableHosts = MOCK_ASSETS.filter((a) => isHostSupported(a) || a.type === "monitor").length;

  const meta = {
    asset: {
      kicker: "ASSET-MAPPING · 内网体检",
      conclusion: s.scanning ? "扫描进行中…" : s.assets ? "全网资产已拓扑化" : "等待体检任务下发",
      chips: [<Chip key="a" n={(s.assets ?? MOCK_ASSETS).length} label="资产" />, <Chip key="b" n={highAssets} label="高危" />, <Chip key="c" n={s.deployments.length} label="诱饵" />, <Chip key="d" n={pending} label="待研判" />],
    },
    deception: {
      kicker: "DECEPTION-DEPLOY · 蜜点部署",
      conclusion: s.approval ? "● 有待审批的部署方案" : `已部署 ${s.deployments.length} 枚诱饵，覆盖 ${deployedHosts} 节点`,
      chips: [<Chip key="a" n={s.deployments.length} label="诱饵" />, <Chip key="b" n={`${deployedHosts}/${deployableHosts}`} label="节点覆盖" />, <Chip key="c" n={todayAlerts} label="今日告警" />],
    },
    attribution: {
      kicker: "THREAT-ATTRIBUTION · 归因分析",
      conclusion: s.currentAlertId ? `正在研判 ${shortId(s.currentAlertId)}` : `队列待研判 ${pending} 条`,
      chips: [<Chip key="a" n={pending} label="待研判" />, <Chip key="b" n={critOpen} label="critical" />, <Chip key="c" n={closed} label="已闭环" />],
    },
  }[s.page];

  return (
    <div style={{ width: 300, minWidth: 300, borderLeft: "1px solid #14233c", background: "linear-gradient(180deg,#0a0e16,#080b11)", overflowY: "auto", display: "flex", flexDirection: "column", fontFamily: MONO }}>
      {/* 顶部身份条（sticky） */}
      <div style={{ position: "sticky", top: 0, background: "rgba(8,11,17,.92)", backdropFilter: "blur(6px)", zIndex: 3, borderBottom: "1px solid #16263f", padding: "11px 13px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="hud-kicker" style={{ color: "#3984ff" }}>{meta.kicker}</span>
          <button onClick={() => setCollapsed(true)} style={{ background: "none", border: "1px solid #1e2c45", color: "#7c8aa5", cursor: "pointer", fontSize: 10, width: 18, height: 18, lineHeight: "12px", clipPath: "polygon(0 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%)" }}>▶</button>
        </div>
        <div style={{ fontSize: 11, color: "#e8eefc", marginTop: 6, lineHeight: 1.5, display: "flex", alignItems: "center", gap: 7 }}>
          <StatusDot tone={s.approval ? "red" : s.scanning ? "cyan" : "green"} pulse={!!s.approval || s.scanning} />
          {meta.conclusion}
        </div>
        <div style={{ display: "flex", gap: 11, marginTop: 7, flexWrap: "wrap" }}>{meta.chips}</div>
      </div>

      <div style={{ padding: "13px 13px 24px", display: "flex", flexDirection: "column", gap: 15 }}>
        <ActivityLog />
        {s.page === "asset" && <AssetPanel />}
        {s.page === "deception" && <DeceptionPanel />}
        {s.page === "attribution" && <AttributionPanel />}
      </div>
    </div>
  );
}

// ================= 01 体检页 =================
function AssetPanel() {
  const s = useAppState();
  const [invFilter, setInvFilter] = useState<"all" | "high">("all");
  const [q, setQ] = useState("");
  const assets = s.assets ?? MOCK_ASSETS;
  const selected = s.selectedIp ? assets.find((a) => a.ip === s.selectedIp) : null;

  const phaseIdx = Math.min(SCAN_PHASES.length - 1, Math.floor((s.scanProgress / 100) * SCAN_PHASES.length));
  const started = s.assets !== null || s.scanProgress > 0 || s.scanning;

  const high = assets.filter((a) => a.risk === "high").length;
  const low = assets.filter((a) => a.risk === "low").length;
  const decoyCount = s.deployments.length;

  const list = assets.filter((a) => {
    if (invFilter === "high" && a.risk === "none") return false;
    if (q.trim()) {
      const k = q.trim().toLowerCase();
      return a.ip.toLowerCase().includes(k) || a.name.toLowerCase().includes(k);
    }
    return true;
  });

  const recent = getRecentAlerts(3);

  return (
    <>
      {/* 1. 扫描状态 */}
      <CollapsibleSection title="SCAN STATUS / 扫描状态" defaultOpen={!started || s.scanning}>
        {!started ? (
          <EmptyState
            icon="◎"
            text={"等待任务…\n在对话中输入「对网段做内网体检」"}
            actionLabel="发起内网体检"
            onAction={() => sendToChat("对 192.168.1.0/24 做内网体检")}
          />
        ) : s.scanning ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: 10, color: "#22d3ee" }}>▸ {SCAN_PHASES[phaseIdx]}…</span>
              <span style={{ fontSize: 18, color: "#e8eefc", fontFamily: MONO }}>{Math.round(s.scanProgress)}<span style={{ fontSize: 11, color: "#7c8aa5" }}>%</span></span>
            </div>
            <div style={{ height: 6, background: "#15233a", borderRadius: 3, overflow: "hidden", marginTop: 6 }}>
              <div style={{ height: "100%", width: `${s.scanProgress}%`, background: "linear-gradient(90deg,#3984ff,#22d3ee)", transition: "width .15s linear", borderRadius: 3 }} />
            </div>
            <PhaseChips />
          </>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "#34d399" }}>✓ 已完成 · 五阶段全部通过</div>
            <PhaseChips />
          </>
        )}
      </CollapsibleSection>

      {/* 2. 节点详情 */}
      <CollapsibleSection title="NODE DETAIL / 节点详情" count={selected ? 1 : 0} defaultOpen={!!selected}>
        {!selected ? (
          <EmptyState icon="◉" text="在拓扑中选择节点" />
        ) : (
          <div style={{ border: "1px solid #294a79", borderRadius: 8, padding: "8px 10px", background: "rgba(57,132,255,0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#e8eefc" }}>{selected.name}</span>
              <button onClick={() => selectNode(null)} style={{ background: "none", border: "none", color: "#5c6b85", cursor: "pointer", fontSize: 12 }}>✕</button>
            </div>
            <div style={{ fontSize: 10, color: "#7c8aa5" }}>{selected.ip}</div>
            <div style={{ fontSize: 10, color: "#a1aec2", marginTop: 6, lineHeight: 1.8 }}>
              <div>系统 · {selected.os}</div>
              <div>服务 · {selected.services.join(" / ")}</div>
              <div style={{ color: selected.risk === "high" ? "#ef4444" : selected.risk === "low" ? "#f59e0b" : "#34d399" }}>
                风险 · {selected.risk === "high" ? "高危" : selected.risk === "low" ? "低危" : "无"}
                {selected.riskNote ? `（${selected.riskNote}）` : ""}
              </div>
              <div>
                蜜点 · {deploymentsOf(selected.ip).length > 0
                  ? deploymentsOf(selected.ip).map((d) => d.type).join(" / ")
                  : "未部署"}
              </div>
              <div style={{ color: "#5c6b85" }}>证据 · {selected.evidence ?? "—"}</div>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button
                onClick={() => setAppState({ page: "deception", selectedIp: selected.ip, lastEvent: `进入蜜点部署 · ${selected.ip}` })}
                style={{ flex: 1, background: "rgba(34,211,238,0.08)", color: "#22d3ee", border: "1px solid rgba(34,211,238,0.5)", borderRadius: 6, padding: "5px 0", fontSize: 11, cursor: "pointer", fontFamily: MONO }}
              >
                部署蜜点 →
              </button>
              <button
                onClick={() => fillDraft(selected.ip)}
                style={{ background: "transparent", color: "#5c6b85", border: "1px solid #1e2c45", borderRadius: 6, padding: "5px 8px", fontSize: 11, cursor: "pointer", fontFamily: MONO }}
              >
                在对话中提及
              </button>
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* 3. 资产清单 */}
      <CollapsibleSection title="INVENTORY / 资产清单" count={list.length} defaultOpen={!!s.assets}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6, fontSize: 10 }}>
          <Chip n={assets.length} label="总数" />
          <Chip n={high} label="高危" />
          <Chip n={low} label="低危" />
          <Chip n={decoyCount} label="诱饵" />
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
          {(["all", "high"] as const).map((f) => (
            <button key={f} onClick={() => setInvFilter(f)} style={{
              fontSize: 9, fontFamily: MONO, cursor: "pointer", borderRadius: 4, padding: "1px 6px",
              background: invFilter === f ? "#3984ff" : "transparent",
              color: invFilter === f ? "#06080c" : "#5c6b85", border: "1px solid #294a79",
            }}>{f === "all" ? "全部" : "高危"}</button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索 IP / 名称"
            style={{ flex: 1, minWidth: 0, background: "#080d15", border: "1px solid #1e2c45", borderRadius: 4, color: "#e8eefc", fontSize: 10, fontFamily: MONO, padding: "2px 6px", outline: "none" }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 240, overflowY: "auto" }}>
          {list.length === 0 ? (
            <div style={{ fontSize: 10, color: "#4d5a70", padding: "8px", textAlign: "center" }}>无匹配资产</div>
          ) : list.map((a) => {
            const active = s.selectedIp === a.ip;
            const hot = s.highlightIp === a.ip;
            return (
              <button
                key={a.ip}
                onClick={() => selectNode(a.ip)}
                onMouseEnter={() => setAppState({ highlightIp: a.ip })}
                onMouseLeave={() => setAppState({ highlightIp: null })}
                style={{
                  textAlign: "left", cursor: "pointer", borderRadius: 6, padding: "5px 8px",
                  background: active ? "#122038" : hot ? "rgba(57,132,255,0.08)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${active ? "#294a79" : "transparent"}`,
                  display: "flex", alignItems: "center", gap: 7, fontFamily: MONO,
                }}
              >
                <span style={{
                  width: 6, height: 6, borderRadius: 3, flexShrink: 0,
                  background: a.risk === "high" ? "#ef4444" : a.risk === "low" ? "#f59e0b" : "#3a465c",
                  boxShadow: a.risk === "high" ? "0 0 6px rgba(239,68,68,0.7)" : "none",
                }} />
                <span style={{ fontSize: 11, color: active ? "#e8eefc" : "#c7d3e8", width: 46, flexShrink: 0 }}>{a.ip.replace("192.168.1.", "")}</span>
                <span style={{ fontSize: 10, color: "#7c8aa5", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name} · {a.services[0]}</span>
              </button>
            );
          })}
        </div>
      </CollapsibleSection>

      {/* 4. 图例与连线 */}
      <CollapsibleSection title="LEGEND / 图例与连线" defaultOpen>
        <div style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 10, color: "#7c8aa5" }}>
          <LegendLine type="lldp" label="实线 = 物理邻居（LLDP）" />
          <LegendLine type="probable" label="虚线 = 推测可达" />
          <LegendLine type="flow" label="流动线 = 通信关系（点线看证据）" />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, marginTop: 4, fontSize: 9, color: "#8fa0bb" }}>
            {[["server", "服务器"], ["industrial", "工控"], ["printer", "打印机"], ["camera", "摄像头"], ["chip", "交换机"], ["monitor", "网关"]].map(([t, l]) => (
              <span key={t}><i style={{ background: "#3984ff", opacity: 0.6, borderRadius: t === "chip" ? 2 : "50%", width: 7, height: 7, display: "inline-block", marginRight: 5 }} />{l}</span>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* 5. 最近告警 */}
      <CollapsibleSection title="RECENT ALERTS / 最近告警" count={recent.length} defaultOpen={!!s.assets}>
        {recent.length === 0 ? (
          <EmptyState icon="◈" text="暂无待研判告警" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {recent.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  setCurrentAlertId(a.id);
                  crossPageSend("attribution", `分析告警 ${a.id}`);
                }}
                style={{ textAlign: "left", cursor: "pointer", borderRadius: 6, padding: "5px 8px", background: "rgba(255,255,255,0.02)", border: "1px solid transparent", fontFamily: MONO }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 10, color: "#e8eefc" }}>{shortId(a.id)} · {a.decoyType}</span>
                  <span style={{ fontSize: 9, color: "#7c8aa5" }}>{a.time.slice(5, 16)}</span>
                </div>
                <div style={{ fontSize: 9, color: "#7c8aa5", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</div>
              </button>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </>
  );
}

function PhaseChips() {
  const s = useAppState();
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
      {SCAN_PHASES.map((p, i) => {
        const reached = s.scanProgress >= ((i + 1) / SCAN_PHASES.length) * 100;
        const active = s.scanning && i === Math.min(SCAN_PHASES.length - 1, Math.floor((s.scanProgress / 100) * SCAN_PHASES.length));
        return (
          <span key={p} style={{
            fontSize: 9, padding: "2px 6px", borderRadius: 4, fontFamily: MONO,
            color: reached ? "#34d399" : active ? "#f59e0b" : "#4d5a70",
            border: `1px solid ${reached ? "rgba(52,211,153,0.35)" : active ? "rgba(245,158,11,0.4)" : "#1e2c45"}`,
            background: active ? "rgba(245,158,11,0.08)" : "transparent",
          }}>{p}</span>
        );
      })}
    </div>
  );
}

function LegendLine({ type, label }: { type: "lldp" | "probable" | "flow"; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <svg width="34" height="8" viewBox="0 0 34 8">
        <line x1="0" y1="4" x2="34" y2="4"
          stroke={type === "flow" ? "#3984ff" : type === "probable" ? "#7c8aa5" : "#2a3a57"}
          strokeWidth="1.4"
          strokeDasharray={type === "lldp" ? undefined : type === "probable" ? "4 3" : "6 4"}
          style={type === "flow" ? { animation: "legend-flow 1.2s linear infinite", strokeDasharray: "6 4" } : undefined}
        />
      </svg>
      {label}
      <style>{`@keyframes legend-flow { to { stroke-dashoffset: -20; } }`}</style>
    </span>
  );
}

// ================= 02 蜜点部署页 =================
const TEMPLATE_TYPES: HoneypotType[] = ["SSH", "SQL", "WEB", "SMB"];

function DeceptionPanel() {
  const s = useAppState();
  useApprovalBusVersion(); // 远程审批后刷新按钮可用态
  const target = s.selectedIp ? MOCK_ASSETS.find((a) => a.ip === s.selectedIp) ?? null : null;

  // 部署态势
  const byType = TEMPLATE_TYPES.map((t) => ({ t, n: s.deployments.filter((d) => d.type === t).length }));
  const deployedHosts = new Set(s.deployments.map((d) => d.ip)).size;
  const deployableHosts = MOCK_ASSETS.filter((a) => isHostSupported(a) || a.type === "monitor").length;
  const todayAlerts = ALERT_TREND_14D[ALERT_TREND_14D.length - 1]?.count ?? 0;

  return (
    <>
      {/* 3. 待审批（仅存在时出现并置顶高亮）；批准/拒绝经审批总线远程触发聊天内 HITL respond */}
      {s.approval && (
        <CollapsibleSection title="WAITING APPROVAL / 待审批" accent="#f59e0b" count={1} defaultOpen>
          {(() => {
            const ap = s.approval!;
            const key = approvalKey(ap.mode, ap.ip, ap.type);
            const recommended = ap.options.find((o) => o.recommended) ?? ap.options[0];
            return (
              <div className="hud-card hud-glow-red" style={{ margin: 0, borderLeft: "2px solid #f59e0b" }}>
                <div className="hud-card-body" style={{ padding: "9px 10px" }}>
                  <div style={{ fontSize: 11, color: "#e8eefc", display: "flex", alignItems: "center", gap: 7 }}>
                    <span className="hud-dot pulse" style={{ ["--dot" as string]: "#f59e0b" }} />
                    {ap.mode === "deploy" ? "部署" : "卸载"} · {ap.ip} · <Tag color={HONEYPOT_TEMPLATES[ap.type].color}>{ap.type}</Tag>
                  </div>
                  {ap.conflict && (
                    <div style={{ fontSize: 10, color: "#f5c451", marginTop: 5, lineHeight: 1.6 }}>
                      ▲ 端口冲突 :{ap.conflict.port}（{ap.conflict.process} / pid {ap.conflict.pid}）
                    </div>
                  )}
                  <div style={{ fontSize: 9, color: "#7c8aa5", marginTop: 5, lineHeight: 1.5 }}>
                    推荐方案：{recommended?.label ?? "—"}
                  </div>
                  <div style={{ display: "flex", gap: 7, marginTop: 9 }}>
                    <button
                      className="hud-btn hud-btn-green hud-btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => approveByKey(key)}
                    >
                      ✓ 批准推荐
                    </button>
                    <button
                      className="hud-btn hud-btn-danger hud-btn-sm"
                      style={{ flex: 1 }}
                      onClick={() => rejectByKey(key)}
                    >
                      ✕ 拒绝
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
        </CollapsibleSection>
      )}

      {/* 1. 部署态势 */}
      <CollapsibleSection title="DEPLOY POSTURE / 部署态势" defaultOpen>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <span className="hud-glow" style={{ fontSize: 32, color: "#e8eefc", fontFamily: MONO, lineHeight: 1 }}>
            <CountUp value={s.deployments.length} />
          </span>
          <span className="hud-kicker">全网诱饵总数</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginTop: 9 }}>
          {byType.map(({ t, n }) => {
            const c = HONEYPOT_TEMPLATES[t].color;
            return (
              <div key={t} style={{ border: "1px solid #16263f", borderLeft: `2px solid ${c}`, padding: "4px 8px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(11,16,25,.5)" }}>
                <span style={{ fontSize: 10, color: c, letterSpacing: 1 }}>{t}</span>
                <span style={{ fontSize: 12, color: "#e8eefc", fontFamily: MONO, textShadow: n ? `0 0 8px ${c}88` : "none" }}>{n}</span>
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 11, marginTop: 9, fontSize: 10, color: "#7c8aa5" }}>
          <span>节点覆盖 <b style={{ color: "#e8eefc", fontFamily: MONO }}>{deployedHosts}/{deployableHosts}</b></span>
          <span>今日触发 <b style={{ color: "#f59e0b", fontFamily: MONO }}>{todayAlerts}</b></span>
        </div>
      </CollapsibleSection>

      {/* 2. 目标节点 / 部署控制台 */}
      <CollapsibleSection title="TARGET / 目标节点控制台" count={target ? 1 : 0} defaultOpen={!!target}>
        {!target ? (
          <>
            <EmptyState icon="◉" text="从拓扑或下方清单选择一个节点作为部署目标" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 8, maxHeight: 200, overflowY: "auto" }}>
              {MOCK_ASSETS.map((a) => {
                const supported = isHostSupported(a) || a.type === "monitor";
                const rec = recommendedType(a);
                return (
                  <button key={a.ip} onClick={() => supported && selectNode(a.ip)} style={{
                    textAlign: "left", cursor: supported ? "pointer" : "not-allowed", borderRadius: 6, padding: "5px 8px",
                    background: "rgba(255,255,255,0.02)", border: "1px solid transparent",
                    display: "flex", alignItems: "center", gap: 7, fontFamily: MONO, opacity: supported ? 1 : 0.55,
                  }}>
                    <span style={{ fontSize: 11, color: "#c7d3e8", width: 46, flexShrink: 0 }}>{a.ip.replace("192.168.1.", "")}</span>
                    <span style={{ fontSize: 10, color: "#7c8aa5", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                    {!supported && <span style={{ fontSize: 11 }}>🔒</span>}
                    {rec && <span style={{ fontSize: 8, color: HONEYPOT_TEMPLATES[rec].color, border: `1px solid ${HONEYPOT_TEMPLATES[rec].color}66`, borderRadius: 3, padding: "0 4px" }}>{rec}</span>}
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <TargetConsole asset={target} />
        )}
      </CollapsibleSection>

      {/* 4. Agent 建议 */}
      <CollapsibleSection title="AGENT ADVICE / Agent 建议" defaultOpen>
        <button
          onClick={() => sendToChat("根据体检结果自动部署蜜点")}
          style={{ width: "100%", background: "linear-gradient(90deg,#122038,#0d1829)", border: "1px solid #3984ff", borderRadius: 8, color: "#e8eefc", padding: "9px 10px", fontSize: 11, cursor: "pointer", fontFamily: MONO, boxShadow: "0 0 16px rgba(57,132,255,0.18)", marginBottom: 8 }}
        >
          ◈ Agent 自主决策部署
        </button>
        {DEPLOY_RECOMMENDATIONS.map((r) => {
          const satisfied = s.deployments.some((d) => d.ip === r.ip && d.type === r.type);
          return (
            <div key={r.ip + r.type} style={{ border: "1px solid #1e2c45", borderRadius: 8, padding: "7px 9px", marginBottom: 6, opacity: satisfied ? 0.55 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#e8eefc" }}>
                  {satisfied ? <span style={{ color: "#34d399" }}>● </span> : null}
                  <span style={{ color: HONEYPOT_TEMPLATES[r.type].color }}>[{r.type}]</span> {r.ip.replace("192.168.1.", "")}
                </span>
                {!satisfied && (
                  <button onClick={() => sendToChat(`在 ${r.ip} 部署 ${r.type} 蜜点`)} style={{ fontSize: 10, color: "#3984ff", background: "transparent", border: "1px solid #294a79", borderRadius: 4, padding: "1px 8px", cursor: "pointer", fontFamily: MONO }}>部署</button>
                )}
              </div>
              <div style={{ fontSize: 10, color: "#7c8aa5", marginTop: 3, lineHeight: 1.6 }}>{r.reason}</div>
            </div>
          );
        })}
      </CollapsibleSection>

      {/* 5. 诱饵清单 */}
      <CollapsibleSection title="DECOY INVENTORY / 诱饵清单" count={s.deployments.length} defaultOpen>
        {s.deployments.length === 0 ? (
          <EmptyState icon="◈" text="暂无部署。选择目标节点，或让 Agent 自主决策。" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {s.deployments.map((d) => {
              const tpl = HONEYPOT_TEMPLATES[d.type];
              const a = MOCK_ASSETS.find((x) => x.ip === d.ip);
              const triggers = MOCK_ALERTS.filter((al) => al.decoyIp === d.ip && al.decoyType === d.type).length;
              return (
                <div key={d.ip + d.type} style={{ border: "1px solid #1e2c45", borderRadius: 7, padding: "6px 8px", background: "#080d15" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 26, height: 20, borderRadius: 5, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8, fontWeight: 700, color: "#06080c", background: tpl.color, fontFamily: MONO }}>{d.type}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: "#e8eefc" }}>{d.ip.replace("192.168.1.", "")} · {a?.name ?? d.ip}</div>
                      <div style={{ fontSize: 9, color: d.status === "active" ? "#34d399" : "#f59e0b" }}>
                        {d.status === "active" ? `● active · :${d.port}` : `○ deploying ${Math.round(d.progress)}%`}
                        {d.since ? ` · ${d.since}` : ""}
                      </div>
                    </div>
                    {d.status === "deploying" && <MiniRing progress={d.progress} color={tpl.color} />}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                    <span style={{ fontSize: 9, color: "#5c6b85" }}>触发告警 {triggers} 次</span>
                    <button onClick={() => sendToChat(`卸载 ${d.ip} 的 ${d.type} 蜜点`)} style={{ fontSize: 9, color: "#7c8aa5", background: "transparent", border: "1px solid #1e2c45", borderRadius: 4, padding: "1px 7px", cursor: "pointer", fontFamily: MONO }}>卸载</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>
    </>
  );
}

function TargetConsole({ asset }: { asset: Asset }) {
  const supportedAll = isHostSupported(asset) || asset.type === "monitor";
  const existing = deploymentsOf(asset.ip);
  const reachedCap = existing.length >= MAX_DEPLOYMENTS_PER_NODE;

  return (
    <div style={{ border: "1px solid #294a79", borderRadius: 8, padding: "9px 10px", background: "rgba(57,132,255,0.05)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#e8eefc" }}>{asset.name} · {asset.ip}</span>
        <button onClick={() => selectNode(null)} style={{ background: "none", border: "none", color: "#5c6b85", cursor: "pointer", fontSize: 12 }}>✕</button>
      </div>
      <div style={{ fontSize: 10, color: "#7c8aa5", marginTop: 3 }}>{asset.os} · {asset.services.join(" · ")}</div>

      {!supportedAll ? (
        <div style={{ marginTop: 8, fontSize: 11, color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, background: "rgba(239,68,68,0.06)", padding: "6px 8px", lineHeight: 1.6 }}>
          ✕ 不支持：{unsupportedReason(asset)}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 6, fontSize: 10, color: "#34d399" }}>✓ 支持部署 · 已部署 {existing.length}/{MAX_DEPLOYMENTS_PER_NODE}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 9 }}>
            {TEMPLATE_TYPES.map((t) => {
              const opt = evaluateDeploy(asset, t);
              const tpl = HONEYPOT_TEMPLATES[t];
              const deployedHere = existing.find((d) => d.type === t);
              const locked = opt.support === "unsupported" || (!deployedHere && reachedCap);
              return (
                <div key={t} style={{
                  borderRadius: 7, padding: "7px 8px", fontFamily: MONO, position: "relative",
                  border: `1px solid ${deployedHere ? tpl.color : opt.support === "recommended" ? `${tpl.color}88` : locked ? "#1e2c45" : "#1e2c45"}`,
                  background: deployedHere ? `${tpl.color}18` : opt.support === "recommended" ? `${tpl.color}0c` : "rgba(255,255,255,0.02)",
                  opacity: locked && !deployedHere ? 0.45 : 1,
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: locked && !deployedHere ? "#4d5a70" : tpl.color }}>{tpl.badge}</span>
                    {deployedHere ? <span style={{ fontSize: 8, color: "#34d399" }}>● 已部署</span>
                      : locked ? <span style={{ fontSize: 10 }}>🔒</span>
                      : opt.support === "recommended" ? <span style={{ fontSize: 8, color: tpl.color }}>推荐</span>
                      : <span style={{ fontSize: 8, color: "#4d5a70" }}>可部署</span>}
                  </div>
                  <div style={{ fontSize: 9, color: "#7c8aa5", marginTop: 3 }}>
                    :{deployedHere ? deployedHere.port : opt.port}{opt.conflict && !deployedHere ? " ⚠换端口" : ""}
                  </div>
                  {deployedHere && (
                    <button onClick={() => sendToChat(`卸载 ${asset.ip} 的 ${t} 蜜点`)} style={{ marginTop: 5, width: "100%", fontSize: 9, color: "#7c8aa5", background: "transparent", border: "1px solid #1e2c45", borderRadius: 4, padding: "2px 0", cursor: "pointer", fontFamily: MONO }}>卸载</button>
                  )}
                  {!deployedHere && !locked && (
                    <button onClick={() => sendToChat(`在 ${asset.ip} 部署 ${t} 蜜点`)} style={{ marginTop: 5, width: "100%", fontSize: 9, color: "#3984ff", background: "transparent", border: "1px solid #294a79", borderRadius: 4, padding: "2px 0", cursor: "pointer", fontFamily: MONO }}>部署</button>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 7, fontSize: 9, color: "#4d5a70", lineHeight: 1.6 }}>
            规则：同类型唯一 · 异类型可共存 · 每节点 ≤{MAX_DEPLOYMENTS_PER_NODE}
          </div>
        </>
      )}
    </div>
  );
}

// ================= 03 归因分析页 =================
type KindFilter = "all" | "observed" | "inferred";

function AttributionPanel() {
  const s = useAppState();
  const trace = s.currentAlertId ? getTraceData(s.currentAlertId) : null;
  const totalLayers = trace ? trace.layers.length : 0;
  const riskReady = !!trace && s.traceLayersRevealed >= totalLayers && totalLayers > 0;

  const statusOf = (a: Alert): AlertStatus => s.alertStatusMap[a.id] ?? a.status;
  const openAlerts = MOCK_ALERTS.filter((a) => statusOf(a) === "待研判" || statusOf(a) === "研判中");
  const compromisedHosts = new Set(openAlerts.map((a) => a.decoyIp)).size;
  const activeDecoys = s.deployments.filter((d) => d.status === "active").length;

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  return (
    <>
      {/* 1. 全局态势 */}
      <CollapsibleSection title="GLOBAL / 全局态势" defaultOpen>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10, color: "#7c8aa5" }}>
          <Chip n={openAlerts.length} label="待研判" />
          <Chip n={MOCK_ALERTS.filter((a) => a.severity === "critical" && statusOf(a) !== "已闭环" && statusOf(a) !== "误报").length} label="critical" />
          <Chip n={MOCK_ALERTS.filter((a) => statusOf(a) === "已闭环").length} label="已闭环" />
          <Chip n={compromisedHosts} label="失陷资产" />
          <Chip n={activeDecoys} label="活跃诱饵" />
        </div>
        <div style={{ marginTop: 8, border: "1px solid #1e2c45", borderRadius: 8, padding: "6px 6px 0" }}>
          <MiniTrendChart data={ALERT_TREND_14D} />
        </div>
      </CollapsibleSection>

      {/* 2. 告警队列 */}
      <CollapsibleSection title="ALERT QUEUE / 告警队列" count={openAlerts.length} defaultOpen>
        <AlertQueue />
      </CollapsibleSection>

      {/* 3. 分析进度 */}
      <CollapsibleSection title="TRACE PROGRESS / 分析进度" count={totalLayers} defaultOpen={!!trace}>
        {!trace ? (
          <EmptyState icon="◉" text="在告警队列中选择一条告警开始溯源" />
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {trace.layers.map((L, i) => {
              const done = s.traceLayersRevealed > i;
              const active = s.traceLayersRevealed === i + 1;
              return (
                <div key={L.layer} style={{ display: "flex", alignItems: "center", gap: 8, height: 24 }}>
                  <span style={{
                    width: 13, height: 13, borderRadius: "50%", fontSize: 8, display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: MONO, flexShrink: 0,
                    background: done ? "#34d399" : active ? "#f59e0b" : "transparent",
                    color: done ? "#06080c" : "#4d5a70",
                    border: `1px solid ${done ? "#34d399" : active ? "#f59e0b" : "#2a3a57"}`,
                  }}>{done ? "✓" : active ? i + 1 : "🔒"}</span>
                  <span style={{ fontSize: 10, color: done ? "#c7d3e8" : active ? "#f59e0b" : "#4d5a70" }}>L{L.layer} · {L.title}</span>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* 4. 证据时间线 */}
      <CollapsibleSection title="EVIDENCE TIMELINE / 证据时间线" count={trace ? trace.timeline.length : 0} defaultOpen={!!trace}>
        {!trace ? (
          <EmptyState icon="◈" text="选择告警后在此查看分层证据" />
        ) : (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {([["all", "全部"], ["observed", "观测"], ["inferred", "推断"]] as [KindFilter, string][]).map(([v, l]) => (
                <button key={v} onClick={() => setKindFilter(v)} style={{
                  fontSize: 9, fontFamily: MONO, cursor: "pointer", borderRadius: 4, padding: "1px 6px",
                  background: kindFilter === v ? "#3984ff" : "transparent",
                  color: kindFilter === v ? "#06080c" : "#5c6b85", border: "1px solid #294a79",
                }}>{l}</button>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", maxHeight: 240, overflowY: "auto" }}>
              {trace.timeline
                .filter((e) => kindFilter === "all" || e.kind === kindFilter)
                .map((e, i) => {
                  const unlocked = s.traceLayersRevealed >= e.layer;
                  return (
                    <div key={i} style={{ display: "flex", gap: 10, paddingBottom: 8, opacity: unlocked ? 1 : 0.4 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: e.kind === "observed" ? "50%" : 2, marginTop: 4, flexShrink: 0,
                          background: unlocked ? (e.kind === "observed" ? "#34d399" : "#f59e0b") : "#2a3a57",
                          boxShadow: unlocked ? `0 0 6px ${e.kind === "observed" ? "#34d399" : "#f59e0b"}` : "none",
                        }} />
                        <span style={{ width: 1, flex: 1, background: "#1e2c45", marginTop: 2, minHeight: 14 }} />
                      </div>
                      <div>
                        <div style={{ fontSize: 9, color: "#5c6b85", display: "flex", gap: 6, alignItems: "center" }}>
                          {e.time}
                          <span style={{ color: e.kind === "observed" ? "#34d399" : "#f59e0b", fontSize: 8 }}>
                            {e.kind === "observed" ? "● 观测" : "◇ 推断"}
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: unlocked ? "#c7d3e8" : "#4d5a70", marginTop: 2, lineHeight: 1.5 }}>
                          {unlocked ? e.text : "🔒 待上层溯源解锁"}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* 5. 风险分析 */}
      <CollapsibleSection title="RISK / 风险分析" defaultOpen={riskReady}>
        {!trace ? (
          <EmptyState icon="◉" text="溯源完成后给出综合研判" />
        ) : !riskReady ? (
          <EmptyState icon="🔒" text="风险因子随溯源逐层汇聚，全部展开后给出综合研判" />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ConfRing value={trace.verdict.confidence} />
              <div style={{ fontSize: 10, color: "#7c8aa5", lineHeight: 1.6 }}>
                综合置信度 · 受影响主机 {trace.affected.hosts} / 账号 {trace.affected.accounts} / 诱饵 {trace.affected.decoys}
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {trace.riskFactors.map((f) => (
                <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ flex: 1, fontSize: 9, color: "#8fa0bb", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.label}</div>
                  <Bar value={(f.score / trace.verdict.confidence) * 100} color={f.color} style={{ width: 60 }} />
                  <span style={{ width: 18, textAlign: "right", fontSize: 9, color: f.color, fontFamily: MONO }}>{f.score}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CollapsibleSection>

      {/* 6. MITRE ATT&CK */}
      <CollapsibleSection title="MITRE ATT&CK / 攻击手法" count={trace ? trace.mitre.length : 0} defaultOpen={!!trace}>
        {!trace ? (
          <EmptyState icon="◈" text="选择告警后展示对应 ATT&CK 手法" />
        ) : (
          trace.mitre.map((m) => {
            const unlocked = s.traceLayersRevealed >= m.layer;
            return (
              <div key={m.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                border: "1px solid #1e2c45", borderRadius: 6, padding: "6px 8px", marginBottom: 5, opacity: unlocked ? 1 : 0.4,
              }}>
                <div>
                  <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "#3984ff", fontFamily: MONO }}>{m.id}</span>
                    <span style={{ fontSize: 11, color: "#e8eefc" }}>{m.name}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#5c6b85", marginTop: 2 }}>{unlocked ? m.desc : "🔒 待解锁"}</div>
                </div>
                <span style={{ fontSize: 8, color: "#7c8aa5", border: "1px solid #1e2c45", borderRadius: 3, padding: "1px 5px", whiteSpace: "nowrap" }}>{m.tactic}</span>
              </div>
            );
          })
        )}
      </CollapsibleSection>

      {/* 7. 处置建议 */}
      <CollapsibleSection title="RESPONSE / 处置建议" defaultOpen={riskReady}>
        {!trace ? (
          <EmptyState icon="◉" text="选择告警并完成溯源后给出处置建议" />
        ) : !riskReady ? (
          <EmptyState icon="🔒" text="溯源全部展开后给出分级处置建议" />
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 8 }}>
              {trace.responses.map((r, i) => (
                <div key={i} style={{ display: "flex", gap: 7, fontSize: 10, color: "#c7d3e8", alignItems: "flex-start", lineHeight: 1.6 }}>
                  <span style={{ color: r.color, border: `1px solid ${r.color}66`, borderRadius: 3, padding: "0 4px", fontSize: 8, marginTop: 2, flexShrink: 0 }}>{r.level}</span>
                  <span>{r.text}</span>
                </div>
              ))}
            </div>
            <button
              onClick={() => sendToChat("生成处置工单")}
              style={{ width: "100%", background: "#3984ff", color: "#06080c", border: "1px solid #3984ff", borderRadius: 7, padding: "7px 0", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: MONO, marginBottom: 6 }}
            >
              生成处置工单
            </button>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => setAlertStatus(trace.alert.id, "误报")} style={{ flex: 1, fontSize: 9, color: "#5c6b85", background: "transparent", border: "1px solid #1e2c45", borderRadius: 5, padding: "4px 0", cursor: "pointer", fontFamily: MONO }}>标记误报</button>
              <button onClick={() => setAlertStatus(trace.alert.id, "研判中")} style={{ flex: 1, fontSize: 9, color: "#3984ff", background: "transparent", border: "1px solid #294a79", borderRadius: 5, padding: "4px 0", cursor: "pointer", fontFamily: MONO }}>升级事件</button>
              <button onClick={() => setAlertStatus(trace.alert.id, "已闭环")} style={{ flex: 1, fontSize: 9, color: "#34d399", background: "transparent", border: "1px solid rgba(52,211,153,0.4)", borderRadius: 5, padding: "4px 0", cursor: "pointer", fontFamily: MONO }}>闭环</button>
            </div>
          </>
        )}
      </CollapsibleSection>
    </>
  );
}
