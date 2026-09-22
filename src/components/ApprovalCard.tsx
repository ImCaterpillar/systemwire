"use client";

// HITL 授权确认卡（useHumanInTheLoop render 组件）
// 三态：inProgress（准备中）/ executing（完整审批卡）/ complete（已决摘要）
// - 部署：端口冲突四方案 / 无冲突单一确认；卸载：列出将停止的诱饵
// - 挂载即同步 store 并在审批总线注册 respond，供右栏「待审批」远程批准/拒绝
// - 已勾选自动批准的类型：executing 后短暂展示即自动批准
import { useEffect, useMemo, useRef, useState } from "react";
import {
  HONEYPOT_TEMPLATES,
  MOCK_ASSETS,
} from "../lib/mock-data";
import type {
  ApprovalOption,
  HoneypotType,
} from "../lib/mock-data";
import { setApproval, deploymentsOf, useAppState, addAutoApproveType, pushActivity } from "../lib/app-store";
import { approvalKey, registerApproval } from "../lib/approval-bus";
import { CornerFrame } from "./hud";

// useHumanInTheLoop render props 判别联合（已调研确认）
export interface ApprovalRenderProps {
  name: string;
  description: string;
  toolCallId: string;
  agentId?: string;
  args: {
    mode: "deploy" | "remove";
    ip: string;
    type: "SSH" | "SQL" | "WEB" | "SMB";
    conflict?: { port: number; process: string; pid: number };
  };
  status: "inProgress" | "executing" | "complete";
  result?: string;
  respond?: (result: unknown) => Promise<void>;
}

const UNSUPPORTED_ASSET_TYPES = ["industrial", "printer", "camera", "chip"];

function recommendOtherNodes(ip: string, type: HoneypotType): { ip: string; reason: string }[] {
  const candidates = MOCK_ASSETS.filter((a) => {
    if (a.ip === ip) return false;
    if (UNSUPPORTED_ASSET_TYPES.includes(a.type)) return false;
    if (a.ip === "192.168.1.1" && type !== "WEB") return false;
    if (deploymentsOf(a.ip).some((d) => d.type === type)) return false;
    return true;
  });
  candidates.sort((a, b) => (b.risk === "high" ? 1 : 0) - (a.risk === "high" ? 1 : 0));
  return candidates.slice(0, 2).map((a) => ({
    ip: a.ip,
    reason: `${a.name}${a.risk === "high" ? "（高危节点，诱捕价值高）" : "（无端口冲突）"}`,
  }));
}

function buildOptions(
  mode: "deploy" | "remove",
  ip: string,
  type: HoneypotType,
  conflict?: { port: number; process: string; pid: number },
): ApprovalOption[] {
  if (mode === "remove") return [];
  const tpl = HONEYPOT_TEMPLATES[type];
  if (!conflict) {
    return [
      { id: "direct", label: `确认在 ${ip} 部署 ${tpl.display}（端口 ${tpl.port}）`, pros: `零业务影响，使用标准端口 ${tpl.port}`, cons: "—", impact: "低", recommended: true, port: tpl.port },
    ];
  }
  const altNodes = recommendOtherNodes(ip, type);
  return [
    { id: "alt-port", label: `A · 改用备用端口 ${tpl.altPort}`, pros: "零业务影响", cons: "非标准端口，对只扫默认端口的自动化攻击命中率略降", impact: "低", recommended: true, port: tpl.altPort },
    { id: "stop-service", label: `B · 停止占用服务后使用默认端口 ${tpl.port}`, pros: "伪装最逼真，与真实服务同端口", cons: "影响现有业务，需业务窗口", impact: "高", port: tpl.port },
    { id: "reverse-proxy", label: "C · 端口复用 / 反向代理转发（高级）", pros: "标准端口对外可见", cons: "配置复杂、可能与真实服务互相干扰（方案已生成，待实施）", impact: "中", port: tpl.port },
    { id: "other-node", label: `D · 改在其他节点部署${altNodes.length ? "（" + altNodes.map((n) => n.ip).join(" / ") + "）" : ""}`, pros: "避开当前节点端口冲突", cons: altNodes[0]?.reason ?? "需重新选择诱捕位置", impact: "低", targetIp: altNodes[0]?.ip },
  ];
}

const impactColor = (impact: string) => (impact === "高" ? "#ef4444" : impact === "中" ? "#f59e0b" : "#34d399");

/** 策略代码 → 中文展示名（活动日志 / 审批结论用） */
const STRATEGY_LABEL: Record<string, string> = {
  direct: "标准端口直挂",
  "alt-port": "备用端口",
  "stop-service": "停服占用默认端口",
  "reverse-proxy": "端口复用 / 反向代理",
  "other-node": "改在其他节点部署",
};
const strategyLabel = (id?: string | null) => (id ? STRATEGY_LABEL[id] ?? id : "标准端口直挂");

export function ApprovalCard(props: ApprovalRenderProps) {
  const { status, args, respond, toolCallId } = props;
  const { mode = "deploy", ip = "", type = "SSH", conflict } = args ?? {};
  const autoApproveTypes = useAppState().autoApproveTypes;

  const options = useMemo(() => buildOptions(mode, ip, type, conflict), [mode, ip, type, conflict]);
  const recommendedIdx = Math.max(0, options.findIndex((o) => o.recommended));
  const [selectedIndex, setSelectedIndex] = useState(recommendedIdx);
  const [autoApprove, setAutoApprove] = useState(false);
  const [busy, setBusy] = useState(false);
  const [autoNote, setAutoNote] = useState(false);
  const actedRef = useRef(false);

  // 挂载（executing）：同步 store
  useEffect(() => {
    if (status !== "executing") return;
    setApproval({
      id: `approval-${toolCallId}`, mode, ip, type, conflict, options,
      selectedIndex: -1, status: "waiting", toolCallId,
    });
    pushActivity(
      mode === "deploy"
        ? `等待人工授权 · 部署 ${type} 诱饵 → ${ip}${conflict ? `（端口 ${conflict.port} 冲突）` : ""}`
        : `等待人工授权 · 卸载 ${ip} 的 ${type} 诱饵`,
      "amber",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, toolCallId]);

  useEffect(() => {
    if (status === "complete") setApproval(null);
  }, [status]);

  const doApprove = async (overrideIndex?: number) => {
    if (busy || actedRef.current) return;
    const idx = overrideIndex ?? selectedIndex;
    const selectedOpt = options[idx];
    const isDeploy = mode === "deploy";
    if (isDeploy && !selectedOpt) return;
    actedRef.current = true;
    setBusy(true);
    try {
      if (isDeploy) {
        if (autoApprove) addAutoApproveType(type);
        pushActivity(`已批准 · ${type} 诱饵部署到 ${ip}（策略：${strategyLabel(selectedOpt?.id)}）`, "green");
        await respond?.({
          decision: "approve", mode, ip, type,
          strategy: selectedOpt!.id, chosenPort: selectedOpt!.port, autoApprove,
        });
      } else {
        pushActivity(`已批准 · 卸载 ${ip} 的 ${type} 诱饵`, "green");
        await respond?.({ decision: "approve", mode, ip, type });
      }
    } finally {
      setApproval(null);
      setBusy(false);
    }
  };

  const doReject = async () => {
    if (busy || actedRef.current) return;
    actedRef.current = true;
    setBusy(true);
    try {
      pushActivity(mode === "deploy" ? `已拒绝 · ${type} 诱饵部署到 ${ip}，未做变更` : `已取消卸载 · ${ip} 的 ${type} 诱饵继续运行`, "red");
      await respond?.({ decision: "reject", mode, ip, type });
    } finally {
      setApproval(null);
      setBusy(false);
    }
  };

  // 在审批总线注册 respond，供右栏按钮远程触发
  const approveRef = useRef(doApprove);
  const rejectRef = useRef(doReject);
  approveRef.current = doApprove;
  rejectRef.current = doReject;
  useEffect(() => {
    if (status !== "executing") return;
    const key = approvalKey(mode, ip, type);
    return registerApproval(key, {
      approve: () => approveRef.current(recommendedIdx),
      reject: () => rejectRef.current(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode, ip, type, recommendedIdx]);

  // 已授权自动批准该类型：短暂展示后自动执行推荐方案
  useEffect(() => {
    if (status !== "executing" || mode !== "deploy") return;
    if (!autoApproveTypes.includes(type) || actedRef.current) return;
    setSelectedIndex(recommendedIdx);
    setAutoNote(true);
    const t = setTimeout(() => { approveRef.current(recommendedIdx); }, 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, mode, type, autoApproveTypes, recommendedIdx]);

  // ---------- InProgress ----------
  if (status === "inProgress") {
    return (
      <div className="hud-card hud-glow-red" style={{ margin: "10px 0", boxShadow: "inset 2px 0 0 #f59e0b", padding: "13px 15px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#f59e0b", fontFamily: "IBM Plex Mono, monospace", fontSize: 11, letterSpacing: 1.5 }}>
          <RadarMini />
          <span>正在准备授权确认</span>
          <span className="hud-slow-blink">···</span>
        </div>
      </div>
    );
  }

  // ---------- Complete ----------
  if (status === "complete") {
    let decision: string | null = null;
    let strategy: string | undefined;
    try {
      const parsed = props.result ? JSON.parse(props.result) : null;
      decision = parsed?.decision ?? null;
      strategy = parsed?.strategy;
    } catch {
      decision = null;
    }
    const approved = decision === "approve";
    const color = approved ? "#34d399" : "#ef4444";
    return (
      <div className="hud-card hud-slide-up" style={{ margin: "10px 0", boxShadow: `inset 2px 0 0 ${color}`, padding: "11px 15px", opacity: 0.92 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, fontFamily: "IBM Plex Mono, monospace", fontSize: 12, color: approved ? "#34d399" : "#a1aec2" }}>
          <span className="hud-dot" style={{ ["--dot" as string]: color }} />
          <span style={{ color }}>
            {approved ? `已批准并执行${mode === "deploy" ? `（策略：${strategyLabel(strategy)}）` : "（卸载已执行）"}` : "已拒绝 · 未做任何变更"}
          </span>
        </div>
        <div style={{ fontSize: 10, color: "#5c6b85", marginTop: 4, fontFamily: "IBM Plex Mono, monospace", letterSpacing: 0.5 }}>
          {ip} · {type} · {mode === "deploy" ? "部署" : "卸载"}
        </div>
      </div>
    );
  }

  // ---------- Executing ----------
  const tpl = HONEYPOT_TEMPLATES[type];
  const selectedOpt = selectedIndex >= 0 ? options[selectedIndex] : null;
  const isDeploy = mode === "deploy";
  const deployedHere = deploymentsOf(ip);
  const targetDecoy = deployedHere.find((d) => d.type === type);
  const is108SSH = ip === "192.168.1.108" && type === "SSH";
  const canApprove = !busy && (!isDeploy || !!selectedOpt);

  return (
    <div className="hud-card hud-slide-up hud-glow-red" style={{ margin: "10px 0", boxShadow: "inset 0 2px 0 #f59e0b" }}>
      <CornerFrame color="#f59e0b" />
      <div className="hud-card-head" style={{ color: "#f59e0b" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span className="hud-dot pulse" style={{ ["--dot" as string]: "#f59e0b" }} />
          {isDeploy ? "DEPLOY APPROVAL · 部署授权" : "REMOVE APPROVAL · 卸载授权"}
        </span>
        <span className="hud-tag hud-slow-blink" style={{ color: "#f59e0b" }}>WAITING APPROVAL</span>
      </div>

      <div className="hud-card-body">
        {/* 终端命令 */}
        <div className="hud-term" style={{ overflowX: "auto", whiteSpace: "nowrap" }}>
          <span className="prompt">▸</span>
          {isDeploy
            ? `honeypot deploy --type ${type} --host ${ip} --port ${selectedOpt?.port ?? "?"}`
            : `honeypot remove --type ${type} --host ${ip}`}
        </div>

        {isDeploy ? (
          <>
            {conflict && (
              <div style={{ marginTop: 10, border: "1px solid rgba(245,158,11,.35)", background: "rgba(245,158,11,.07)", padding: "8px 11px", fontSize: 11, color: "#e8c98a", lineHeight: 1.7, clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))" }}>
                ▲ 端口 {conflict.port} 被进程 <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{conflict.process}</span>（PID {conflict.pid}）占用。当前节点无可直接复用的空闲 {type} 端口，请选择处置方案。
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
              {options.map((opt, i) => {
                const sel = selectedIndex === i;
                const ic = impactColor(opt.impact);
                return (
                  <div key={opt.id} onClick={() => !busy && !autoNote && setSelectedIndex(i)}
                    style={{
                      border: `1px solid ${sel ? "#3984ff" : "#16263f"}`,
                      borderLeft: `2.5px solid ${sel ? "#3984ff" : "#1e2c45"}`,
                      background: sel ? "rgba(57,132,255,.1)" : "rgba(11,16,25,.6)",
                      padding: "8px 11px", cursor: busy || autoNote ? "default" : "pointer",
                      transition: "all .15s", boxShadow: sel ? "0 0 14px rgba(57,132,255,.2)" : "none",
                      clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,0 100%)",
                    }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ width: 14, height: 14, borderRadius: 7, border: `1.5px solid ${sel ? "#3984ff" : "#3a4a66"}`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {sel && <span style={{ width: 6, height: 6, borderRadius: 3, background: "#3984ff", boxShadow: "0 0 6px #3984ff" }} />}
                      </span>
                      <span style={{ fontSize: 12, color: "#e8eefc", fontWeight: 600, fontFamily: "IBM Plex Mono, monospace" }}>{opt.label}</span>
                      {opt.recommended && <span className="hud-tag" style={{ color: "#3984ff", fontSize: 9 }}>推荐</span>}
                      <span className="hud-tag" style={{ marginLeft: "auto", color: ic, fontSize: 9 }}>影响 {opt.impact}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#a1aec2", marginTop: 5, lineHeight: 1.6, paddingLeft: 22 }}>
                      <span style={{ color: "#34d399" }}>利：</span>{opt.pros}
                      <br />
                      <span style={{ color: "#ef7c7c" }}>弊：</span>{opt.cons}
                      {opt.id === "other-node" && opt.targetIp && <div style={{ color: "#7c8aa5", marginTop: 2 }}>目标节点：{opt.targetIp}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            {targetDecoy ? (
              <div className="hud-panel-flat" style={{ padding: "9px 11px", fontSize: 11, color: "#a1aec2", lineHeight: 1.9 }}>
                将停止诱饵：<span style={{ color: "#e8eefc", fontFamily: "IBM Plex Mono, monospace" }}>{tpl.display}（{targetDecoy.port} 端口）</span>
                <br />
                释放端口：<span style={{ color: "#e8eefc", fontFamily: "IBM Plex Mono, monospace" }}>:{targetDecoy.port}</span>
                <br />
                <span style={{ color: "#7c8aa5" }}>日志归档保留 30 天，不影响历史事件回溯。</span>
              </div>
            ) : (
              <div className="hud-panel-flat" style={{ padding: "9px 11px", fontSize: 11, color: "#e8c98a", lineHeight: 1.9, borderColor: "rgba(245,158,11,.4)" }}>
                ▲ 该节点当前没有运行中的 {tpl.display}，可能已在其他操作中卸载；确认后将仅做一次状态核对，不会产生变更。
              </div>
            )}
            {is108SSH && (
              <div style={{ border: "1px solid rgba(245,158,11,.35)", background: "rgba(245,158,11,.07)", padding: "8px 11px", fontSize: 11, color: "#e8c98a", lineHeight: 1.6, clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))" }}>
                ▲ 该诱饵为当前告警来源（ALERT-2026-0919-001）。卸载后历史告警保留，但将不再采集新的触发事件。
              </div>
            )}
          </div>
        )}

        {/* 操作区 */}
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 13, flexWrap: "wrap" }}>
          {autoNote ? (
            <span className="hud-tag hud-slow-blink" style={{ color: "#34d399", fontSize: 11 }}>
              该类型已授权自动批准，正在执行推荐方案…
            </span>
          ) : (
            <>
              <button className="hud-btn hud-btn-primary" onClick={() => doApprove()} disabled={!canApprove}>
                {isDeploy ? "✓ 批准并执行" : "✓ 确认卸载"}
              </button>
              <button className="hud-btn hud-btn-danger" onClick={doReject} disabled={busy}>
                {isDeploy ? "✕ 拒绝" : "✕ 取消"}
              </button>
              {isDeploy && (
                <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10, color: "#7c8aa5", marginLeft: 4, cursor: busy ? "default" : "pointer", letterSpacing: 0.5 }}>
                  <input type="checkbox" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} disabled={busy}
                    style={{ accentColor: "#3984ff", cursor: "pointer" }} />
                  本次会话对同类部署自动批准
                </label>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RadarMini() {
  return (
    <svg width="16" height="16" viewBox="0 0 40 40" style={{ flex: "none" }}>
      <circle cx="20" cy="20" r="16" fill="none" stroke="#f59e0b" strokeOpacity="0.4" strokeWidth="2" />
      <g style={{ transformOrigin: "20px 20px", animation: "hud-radar-sweep 1.2s linear infinite" }}>
        <path d="M20 20 L20 4 A16 16 0 0 1 36 20 Z" fill="#f59e0b" fillOpacity="0.3" />
      </g>
    </svg>
  );
}

export default ApprovalCard;
