"use client";

// 溯源图谱：HUD 垂直杀伤链时间线，逐层展开
// - 左侧编号节点 + 数据流连接线；悬停实体高亮一跳链路
// - 资产实体可点击跳到拓扑定位；历史实体可跳转关联事件
// - 全部层展开后呈现研判结论（置信环 + 风险因子 + 攻击链 + 处置/状态流转）
import { useEffect, useRef, useState } from "react";
import {
  TRACE_LAYERS,
  VERDICT,
  ATTACK_CHAIN,
  RISK_FACTORS,
  MOCK_ENTITIES,
} from "../lib/mock-data";
import type { TraceLayer } from "../lib/mock-data";
import { sendToChat } from "./chat-actions";
import { locateNode, setAlertStatus } from "../lib/app-store";
import { Ring, CornerFrame } from "./hud";

interface Props {
  layersRevealed: number;
  onRevealChange?: (n: number) => void;
  result?: {
    alert?: { id?: string };
    layers?: TraceLayer[];
    chain?: string[];
    riskFactors?: { label: string; score: number; color: string }[];
    verdict?: { confidence: number; summary: string };
  };
  revealDelay?: number;
  replay?: boolean;
}

const COLORS = ["#22d3ee", "#f59e0b", "#a78bfa", "#ef4444"];

function confidenceColor(v: number): string {
  if (v >= 80) return "#ef4444";
  if (v >= 60) return "#f59e0b";
  if (v >= 40) return "#3984ff";
  return "#34d399";
}

/** 在实体库中按 IP / 账号名模糊匹配当前层实体，命中且历史事件 >1 时返回徽标 */
function matchHistory(entity: string): { count: number; value: string } | null {
  for (const e of MOCK_ENTITIES) {
    if (e.historyCount > 1 && entity.includes(e.value)) {
      return { count: e.historyCount, value: e.value };
    }
  }
  return null;
}

export default function AttackGraph({ layersRevealed: external, onRevealChange, result, revealDelay = 950, replay = false }: Props) {
  const layers = result?.layers ?? TRACE_LAYERS;
  const chain = result?.chain ?? ATTACK_CHAIN;
  const factors = result?.riskFactors ?? RISK_FACTORS;
  const verdict = result?.verdict ?? VERDICT;
  const alertId = result?.alert?.id;
  const confColor = confidenceColor(verdict.confidence);
  const benign = verdict.confidence < 40;

  const [internal, setInternal] = useState(0);
  const revealed = Math.max(internal, external);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [showVerdict, setShowVerdict] = useState(false);
  const onRevealRef = useRef(onRevealChange);
  onRevealRef.current = onRevealChange;
  const animRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const kick = (startAt: number) => {
    if (animRef.current) clearInterval(animRef.current);
    setInternal(startAt);
    setShowVerdict(false);
    animRef.current = setInterval(() => {
      setInternal((n) => (n >= layers.length ? n : n + 1));
    }, revealDelay);
  };

  useEffect(() => {
    kick(external > 0 ? external : 0);
    return () => { if (animRef.current) clearInterval(animRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (replay) kick(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  useEffect(() => {
    if (internal > 0) onRevealRef.current?.(internal);
  }, [internal]);

  useEffect(() => {
    if (revealed >= layers.length) {
      const t = setTimeout(() => setShowVerdict(true), 650);
      return () => clearTimeout(t);
    }
    setShowVerdict(false);
  }, [revealed, layers.length]);

  const gotoRelated = (value: string) => sendToChat(`分析关联事件 ${value}`);

  // 与当前告警关联的实体指标（IOC / IP / 账号），TTP 已在各层 ATT&CK 标签中呈现
  const indicators = alertId
    ? MOCK_ENTITIES.filter((e) => e.relatedAlertIds.includes(alertId) && e.type !== "ttp")
    : [];
  const IOC_META: Record<string, { label: string; color: string }> = {
    ioc: { label: "IOC", color: "#ef4444" },
    ip: { label: "IP", color: "#3984ff" },
    account: { label: "账号", color: "#a78bfa" },
  };
  const affected = (result as { affected?: { hosts: number; accounts: number; decoys: number } } | null)?.affected;

  return (
    <div style={{ width: "100%" }}>
      {/* ===== 杀伤链时间线 ===== */}
      <div style={{ display: "flex", flexDirection: "column", position: "relative" }}>
        {layers.map((layer, i) => {
          const shown = i < revealed;
          const dimmed = hoverIdx !== null && hoverIdx !== i && hoverIdx !== i - 1;
          const active = hoverIdx === i;
          const hist = shown ? matchHistory(layer.entity) : null;
          const color = COLORS[i % COLORS.length];
          return (
            <div key={layer.layer} style={{ display: "flex", position: "relative", paddingLeft: 38, minHeight: 56 }}>
              {/* 左侧轨道 */}
              <div style={{ position: "absolute", left: 0, top: 0, bottom: i === layers.length - 1 ? "50%" : 0, width: 24 }}>
                {/* 连接线 */}
                {i > 0 && (
                  <div style={{ position: "absolute", left: 11, top: -2, bottom: 14, width: 2, background: "rgba(41,74,121,0.5)", overflow: "hidden" }}>
                    {shown && (
                      <div style={{
                        width: 2, height: "100%",
                        background: `repeating-linear-gradient(180deg, ${color} 0 5px, transparent 5px 11px)`,
                        animation: "hud-flow-v 1s linear infinite",
                        filter: `drop-shadow(0 0 3px ${color})`,
                      }} />
                    )}
                  </div>
                )}
                {/* 编号节点 */}
                <div
                  style={{
                    position: "absolute", left: 0, top: 12, width: 24, height: 24,
                    transform: shown ? "scale(1)" : "scale(0.5)", opacity: shown ? 1 : 0.25,
                    transition: "transform .4s cubic-bezier(.2,.8,.2,1), opacity .4s",
                  }}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" style={{ filter: shown ? `drop-shadow(0 0 5px ${color})` : "none" }}>
                    <polygon points="12,1.5 21.5,7 21.5,17 12,22.5 2.5,17 2.5,7" fill="rgba(8,13,21,0.95)" stroke={color} strokeWidth="1.4" />
                    <text x="12" y="15.5" textAnchor="middle" fontSize="9.5" fontWeight="700" fill={color} fontFamily="IBM Plex Mono, monospace">{layer.layer}</text>
                  </svg>
                </div>
              </div>

              {/* 卡片 */}
              <div
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
                className={shown ? "hud-slide-up" : ""}
                style={{
                  width: "100%", boxSizing: "border-box", marginBottom: 8,
                  opacity: shown ? (dimmed ? 0.45 : 1) : 0,
                  transform: shown ? "translateY(0)" : "translateY(-8px)",
                  transition: "opacity .4s ease, transform .4s ease",
                  position: "relative",
                  background: active ? `linear-gradient(180deg, ${color}14, rgba(9,13,21,.9))` : "linear-gradient(180deg, rgba(15,22,37,.85), rgba(8,12,20,.92))",
                  border: `1px solid ${active ? color : "#16263f"}`,
                  borderLeft: `2.5px solid ${color}`,
                  clipPath: "polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%)",
                  padding: "9px 11px",
                  boxShadow: active ? `0 0 18px ${color}2e` : "0 4px 14px rgba(0,0,0,.35)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, fontFamily: "IBM Plex Mono, monospace", color, letterSpacing: 1.5, border: `1px solid ${color}66`, padding: "1px 7px", background: `${color}14` }}>
                    L{layer.layer} · {layer.title}
                  </span>
                  <span style={{ fontSize: 9, fontFamily: "IBM Plex Mono, monospace", color: layer.evidenceType === "observed" ? "#34d399" : "#f59e0b", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span className="hud-dot" style={{ ["--dot" as string]: layer.evidenceType === "observed" ? "#34d399" : "#f59e0b", width: 5, height: 5 }} />
                    {layer.evidenceType === "observed" ? "观测证据" : "行为推断"}
                  </span>
                  {hist && (
                    <button onClick={() => gotoRelated(hist.value)} title="查看关联历史事件"
                      style={{ fontSize: 9, fontFamily: "IBM Plex Mono, monospace", color: "#f5c451", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.45)", padding: "1px 7px", cursor: "pointer", clipPath: "polygon(0 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%)" }}>
                      历史事件 {hist.count} 起 →
                    </button>
                  )}
                  {layer.ip && shown && (
                    <button onClick={() => locateNode(layer.ip!)} title="在拓扑中定位该资产"
                      style={{ marginLeft: "auto", background: "transparent", border: "1px solid #294a79", color: "#8fb4e8", fontSize: 9, padding: "1px 8px", cursor: "pointer", fontFamily: "IBM Plex Mono, monospace", clipPath: "polygon(0 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%)" }}>
                      ⌖ 定位资产
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: "#e8eefc", fontWeight: 600, marginTop: 5, fontFamily: "IBM Plex Mono, monospace" }}>{layer.entity}</div>
                <div style={{ fontSize: 12, color: "#a1aec2", marginTop: 2, lineHeight: 1.7 }}>{layer.detail}</div>
                {layer.attck?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 7 }}>
                    {layer.attck.map((t) => (
                      <span key={t} style={{ fontSize: 10, fontFamily: "IBM Plex Mono, monospace", color: "#9db4d8", background: "rgba(18,32,56,.8)", border: "1px solid #1e2c45", padding: "1px 7px", letterSpacing: 0.5 }}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ===== 研判结论 ===== */}
      <div
        className="hud-card"
        style={{
          marginTop: 12, borderTop: `2px solid ${confColor}`,
          opacity: showVerdict ? 1 : 0, transform: showVerdict ? "translateY(0)" : "translateY(12px)",
          transition: "opacity .5s ease, transform .5s ease",
        }}
      >
        <CornerFrame color={confColor} />
        <div className="hud-card-head" style={{ color: confColor }}>
          <span>◆ VERDICT · {benign ? "良性研判" : "攻击研判"}</span>
          <span style={{ color: "#5c6b85" }}>{alertId ? alertId.split("-").slice(-2).join("-") : ""}</span>
        </div>
        <div className="hud-card-body">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Ring value={verdict.confidence} size={96} stroke={6} color={confColor}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 19, fontWeight: 700, color: confColor, fontFamily: "IBM Plex Mono, monospace", lineHeight: 1, textShadow: `0 0 10px ${confColor}88` }}>{verdict.confidence}%</div>
                <div style={{ fontSize: 7, color: "#5c6b85", letterSpacing: 1, marginTop: 3 }}>CONFIDENCE</div>
              </div>
            </Ring>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "#c3d0e6", lineHeight: 1.75 }}>{verdict.summary}</div>
              {affected && (
                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                  {[["受影响主机", affected.hosts, "#ef4444"], ["涉事账号", affected.accounts, "#a78bfa"], ["触发诱饵", affected.decoys, "#22d3ee"]].map(([label, n, c]) => (
                    <span key={label as string} style={{ fontSize: 9, fontFamily: "IBM Plex Mono, monospace", color: c as string, border: `1px solid ${c as string}55`, background: `${c as string}12`, padding: "2px 8px" }}>
                      {(n as number) > 0 ? "● " : "○ "}{label} {n as number}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 风险因子 */}
          <div style={{ marginTop: 12, borderTop: "1px dashed #1e2c45", paddingTop: 9 }}>
            <div className="hud-kicker" style={{ marginBottom: 7 }}><b>01</b>置信度因子</div>
            {factors.map((f) => (
              <div key={f.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <div style={{ width: 172, fontSize: 10, color: "#8fa0bb", fontFamily: "IBM Plex Mono, monospace", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.label}</div>
                <div className="hud-bar" style={{ flex: 1 }}>
                  <i style={{ width: showVerdict ? `${(f.score / Math.max(1, verdict.confidence)) * 100}%` : "0%", background: f.color, boxShadow: `0 0 8px ${f.color}`, transition: "width .9s cubic-bezier(.2,.8,.2,1) .2s" }} />
                </div>
                <div style={{ width: 24, textAlign: "right", fontSize: 10, color: f.color, fontFamily: "IBM Plex Mono, monospace" }}>{f.score}</div>
              </div>
            ))}
          </div>

          {/* 攻击链 */}
          <div style={{ marginTop: 10 }}>
            <div className="hud-kicker" style={{ marginBottom: 7 }}><b>02</b>杀伤链 KILL-CHAIN</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
              {chain.map((c, i) => (
                <span key={c} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 10, fontFamily: "IBM Plex Mono, monospace", color: "#c7d3e8", background: "rgba(18,32,56,.85)", border: "1px solid #24395c", padding: "3px 9px", clipPath: "polygon(0 0,calc(100% - 6px) 0,100% 6px,100% 100%,6px 100%,0 calc(100% - 6px))" }}>{c}</span>
                  {i < chain.length - 1 && <span style={{ color: "#3984ff" }}>▸</span>}
                </span>
              ))}
            </div>
          </div>

          {/* 关键指标 IOC（实体证据清单） */}
          {indicators.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="hud-kicker" style={{ marginBottom: 7 }}><b>03</b>关键指标 IOC / ENTITIES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {indicators.map((e) => {
                  const meta = IOC_META[e.type] ?? { label: e.type, color: "#5c6b85" };
                  return (
                    <div key={e.type + e.value} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 10.5, lineHeight: 1.5 }}>
                      <span style={{ fontSize: 8.5, fontFamily: "IBM Plex Mono, monospace", color: meta.color, border: `1px solid ${meta.color}66`, background: `${meta.color}14`, padding: "0 5px", flexShrink: 0, width: 38, textAlign: "center" }}>{meta.label}</span>
                      <span style={{ color: "#e8eefc", fontFamily: "IBM Plex Mono, monospace", wordBreak: "break-all" }}>{e.value}</span>
                      <span style={{ color: "#5c6b85", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 快捷处置 */}
          <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
            <button className="hud-btn hud-btn-primary" onClick={() => sendToChat("生成处置工单")}>生成处置工单</button>
            <button className="hud-btn hud-btn-ghost" onClick={() => locateNode("192.168.1.103")}>⌖ 定位攻击源 103</button>
          </div>

          {/* 状态流转 */}
          {alertId && (
            <div style={{ display: "flex", gap: 8, marginTop: 9, flexWrap: "wrap", borderTop: "1px dashed #1e2c45", paddingTop: 9 }}>
              <button className="hud-btn hud-btn-sm hud-btn-green" onClick={() => { setAlertStatus(alertId, "误报"); sendToChat(`已将 ${alertId} 标记为误报`); }}>
                标记误报
              </button>
              <button className="hud-btn hud-btn-sm hud-btn-amber" onClick={() => { setAlertStatus(alertId, "研判中"); sendToChat(`已将 ${alertId} 升级为安全事件，进入研判处置`); }}>
                升级为事件
              </button>
              <button className="hud-btn hud-btn-sm hud-btn-primary" onClick={() => { setAlertStatus(alertId, "已闭环"); sendToChat(`生成处置工单并闭环 ${alertId}`); }}>
                生成工单并闭环
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes hud-flow-v { to { background-position: 0 -22px; } }`}</style>
    </div>
  );
}
