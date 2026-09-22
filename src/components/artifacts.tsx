"use client";

// Artifact 组件：把工具结果渲染成聊天流内 HUD 卡片，并联动右栏面板
// 分层：中栏放"可视化产物"（拓扑 / 部署状态 / 告警+溯源图谱），明细与控制台在右栏
import { useEffect, useRef, useState } from "react";
import TopologyMap from "./TopologyMap";
import AttackGraph from "./AttackGraph";
import { sendToChat, crossPageSend } from "./chat-actions";
import {
  useAppState, setAppState, getAppState, setScanProgress,
  addDeployment, updateDeploymentProgress, deploymentOf,
  setCurrentAlertId, setAlertStatus, removeDeployment, pushActivity,
} from "../lib/app-store";
import { HONEYPOT_TEMPLATES } from "../lib/mock-data";
import type { Asset, Link, HoneypotType } from "../lib/mock-data";
import { Tag, CountUp, CornerFrame } from "./hud";

// ---------- 通用卡片壳 ----------
export function ArtifactShell({
  title, children, badge, badgeColor = "#22d3ee",
}: {
  title: string;
  children: React.ReactNode;
  badge?: string;
  badgeColor?: string;
}) {
  return (
    <div className="hud-card hud-slide-up" style={{ margin: "10px 0" }}>
      <CornerFrame color={badgeColor} />
      <div className="hud-card-head" style={{ color: badgeColor }}>
        <span>{title}</span>
        {badge && <Tag color={badgeColor}>{badge}</Tag>}
      </div>
      <div className="hud-card-body">{children}</div>
    </div>
  );
}

function ActionBtn({ label, onClick, primary, danger }: { label: string; onClick: () => void; primary?: boolean; danger?: boolean }) {
  const cls = primary ? "hud-btn hud-btn-primary hud-btn-sm" : danger ? "hud-btn hud-btn-danger hud-btn-sm" : "hud-btn hud-btn-ghost hud-btn-sm";
  return <button className={cls} onClick={onClick}>{label}</button>;
}

// ---------- 1. 扫描 Artifact ----------
export function ScanArtifact({ result }: { result: any }) {
  const s = useAppState();
  const [done, setDone] = useState(false);

  useEffect(() => {
    const prev = getAppState();
    if (result?.replay === true && prev.assets && prev.assets.length > 0) {
      setDone(true);
      return;
    }
    if (prev.assets && prev.assets.length > 0 && prev.scanProgress >= 100) {
      setDone(true);
      return;
    }
    setAppState({ assets: result.assets as Asset[] });
    setScanProgress(0, true);
    pushActivity(`开始内网体检 · ${result.cidr ?? "192.168.1.0/24"}（主机发现 / 端口 / 漏洞）`, "cyan");
    const t = setInterval(() => {
      const cur = getAppState().scanProgress ?? 0;
      if (cur >= 100) {
        clearInterval(t);
        setScanProgress(100, false);
        setDone(true);
        pushActivity(`资产测绘完成 · ${result.total} 在线 / ${result.risky} 高危 / ${result.low ?? 0} 低风险`, "green");
        return;
      }
      setScanProgress(cur + 2, true);
    }, 70);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const high = (result.assets as Asset[])?.filter((a) => a.risk === "high") ?? [];
  const scanPct = Math.min(100, s.scanProgress ?? 0);

  return (
    <>
      <ArtifactShell title="ASSET-MAPPING / 实时资产拓扑" badge={done ? "TOPOLOGY READY" : "SCANNING…"} badgeColor={done ? "#34d399" : "#f59e0b"}>
        {!done && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#7c8aa5", fontFamily: "IBM Plex Mono, monospace", letterSpacing: 1, marginBottom: 4 }}>
              <span className={done ? "" : "hud-scanning"}>ACTIVE RECON · 主动探测</span>
              <span style={{ color: "#22d3ee" }}>{Math.round(scanPct)}%</span>
            </div>
            <div className="hud-bar"><i style={{ width: `${scanPct}%`, background: "linear-gradient(90deg,#22d3ee,#3984ff)", boxShadow: "0 0 8px #22d3ee", transition: "width .1s linear" }} /></div>
          </div>
        )}
        <TopologyMap
          assets={(result.assets as Asset[]) ?? []}
          links={(result.links as Link[]) ?? []}
          deployments={s.deployments}
          selectedIp={s.selectedIp}
          highlightIp={s.highlightIp}
          onSelectNode={(ip) => setAppState({ selectedIp: ip })}
          onDeploy={(ip) => setAppState({ page: "deception", selectedIp: ip, lastEvent: `进入蜜点部署 · ${ip}` })}
          onMention={(ip) => sendToChat(`分析节点 ${ip} 的风险情况`)}
          onHighlightConsumed={() => setAppState({ highlightIp: null })}
        />
      </ArtifactShell>

      {done && (
        <ArtifactShell title="SCAN REPORT / 体检报告" badge={`${result.total} ASSETS`} badgeColor="#3984ff">
          <div style={{ display: "flex", gap: 26, padding: "2px 0 10px" }}>
            <ReportStat label="资产总数" value={result.total} color="#e8eefc" />
            <ReportStat label="高危" value={result.risky} color="#ef4444" />
            <ReportStat label="低风险" value={result.low ?? 0} color="#f59e0b" />
            <ReportStat label="在线诱饵" value={s.deployments.length} color="#22d3ee" />
          </div>
          <div className="hud-divider" />
          <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8 }}>
            {high.map((a, i) => (
              <div key={a.ip} className="hud-slide-up" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12, animationDelay: `${i * 70}ms` }}>
                <span className="hud-dot pulse" style={{ ["--dot" as string]: "#ef4444", width: 6, height: 6 }} />
                <span style={{ color: "#e8eefc", fontFamily: "IBM Plex Mono, monospace", width: 138, fontSize: 11 }}>{a.ip} · {a.name}</span>
                <span style={{ color: "#a1aec2", fontSize: 11 }}>{a.riskNote}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
            <ActionBtn label="部署 SSH 诱饵 → 105" primary onClick={() => crossPageSend("deception", "在 192.168.1.105 部署 SSH 蜜点")} />
            <ActionBtn label="Agent 自主部署" onClick={() => crossPageSend("deception", "根据体检结果自动部署蜜点")} />
            <ActionBtn label="分析攻击链" onClick={() => crossPageSend("attribution", "分析最近一条蜜点告警")} />
          </div>
        </ArtifactShell>
      )}
    </>
  );
}

function ReportStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 23, color, fontWeight: 700, fontFamily: "IBM Plex Mono, monospace", lineHeight: 1.1, textShadow: `0 0 12px ${color}55` }}>
        <CountUp value={value} />
      </div>
      <div className="hud-kicker" style={{ marginTop: 3 }}>{label}</div>
    </div>
  );
}

// ---------- 2. 蜜点部署 Artifact ----------
const DEPLOY_STAGES = ["预检", "下发运行时", "伪装服务激活", "诱捕上线"];
function stageOf(p: number): number {
  if (p < 25) return 0;
  if (p < 60) return 1;
  if (p < 100) return 2;
  return 3;
}

export function DeployArtifact({ result }: { result: any }) {
  const s = useAppState();
  const [progress, setProgress] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => {
    if (result?.error) { pushActivity(`部署被阻断 · ${result.ip} ${result.type ?? ""}`, "red"); return; }
    const existing = deploymentOf(result.ip, result.type as HoneypotType);
    if (existing && existing.status === "active" && existing.progress >= 100) {
      setProgress(100);
      return;
    }
    addDeployment(result.ip, result.type as HoneypotType, result.port);
    pushActivity(`请求部署 ${result.type} 诱饵 → ${result.ip}:${result.port}`, "blue");
    const t = setInterval(() => setProgress((p) => Math.min(100, p + 5)), 64);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (result?.error) return;
    if (progress > 0 && progress < 100) updateDeploymentProgress(result.ip, result.type as HoneypotType, progress);
    if (progress >= 100) {
      updateDeploymentProgress(result.ip, result.type as HoneypotType, 100);
      if (!doneRef.current) {
        doneRef.current = true;
        pushActivity(`${result.type} 诱饵上线 · ${result.ip}:${result.port} 开始诱捕`, "green");
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  if (result?.error) {
    return (
      <ArtifactShell title="DECEPTION-DEPLOY / 蜜点部署" badge="BLOCKED" badgeColor="#ef4444">
        <div style={{ fontSize: 12, color: "#ef7c7c", border: "1px solid rgba(239,68,68,.3)", background: "rgba(239,68,68,.07)", padding: "10px 12px", lineHeight: 1.7, clipPath: "polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,0 100%)" }}>
          ✕ {result.error}
        </div>
      </ArtifactShell>
    );
  }

  const tpl = HONEYPOT_TEMPLATES[result.type as HoneypotType];
  const checks: { label: string; status: string; msg: string }[] = result.checks ?? [
    { label: `端口 ${result.port}`, status: "ok", msg: result.preflight ?? "预检通过" },
  ];
  const done = progress >= 100;
  const stage = stageOf(progress);
  const gatewayDeployed = s.deployments.some((d) => d.ip === "192.168.1.1");

  return (
    <ArtifactShell title="DECEPTION-DEPLOY / 蜜点部署" badge={done ? "ACTIVE" : "DEPLOYING…"} badgeColor={done ? tpl.color : "#f59e0b"}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        {/* lock-on 六边形徽标 */}
        <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
          <svg width="50" height="50" viewBox="0 0 50 50" style={{ filter: `drop-shadow(0 0 6px ${tpl.color}${done ? "aa" : "44"})` }}>
            <polygon points="25,3 45,14.5 45,35.5 25,47 5,35.5 5,14.5" fill="rgba(0,0,0,.3)" stroke={tpl.color} strokeWidth="1.5" />
            <text x="25" y="30" textAnchor="middle" fontSize="12" fontWeight="700" fill={tpl.color} fontFamily="IBM Plex Mono, monospace">{tpl.badge}</text>
          </svg>
          {!done && <span className="hud-dot pulse" style={{ ["--dot" as string]: tpl.color, position: "absolute", top: -2, right: -2 }} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "#e8eefc", fontWeight: 600, fontFamily: "IBM Plex Mono, monospace" }}>
            {result.name ? `${result.name} · ` : ""}{result.ip}
          </div>
          <div style={{ fontSize: 11, color: "#7c8aa5", marginTop: 2 }}>{tpl.display} · 监听端口 {result.port}</div>
          {!done && <div style={{ fontSize: 10, color: tpl.color, marginTop: 2, letterSpacing: 1 }} className="hud-scanning">▸ {DEPLOY_STAGES[stage]}…</div>}
        </div>
        <ProgressRing progress={progress} color={tpl.color} />
      </div>

      {/* 阶段轨 */}
      <div style={{ display: "flex", gap: 4, marginTop: 11 }}>
        {DEPLOY_STAGES.map((st, i) => (
          <div key={st} style={{ flex: 1, textAlign: "center" }}>
            <div style={{ height: 3, background: i <= stage ? tpl.color : "#16263f", boxShadow: i === stage && !done ? `0 0 6px ${tpl.color}` : "none", transition: "background .3s" }} />
            <div style={{ fontSize: 8.5, color: i <= stage ? tpl.color : "#4d5a70", marginTop: 3, letterSpacing: 0.5, whiteSpace: "nowrap" }}>{st}</div>
          </div>
        ))}
      </div>

      {/* 预检明细 */}
      <div style={{ marginTop: 9, borderTop: "1px dashed #1e2c45", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: "IBM Plex Mono, monospace", alignItems: "baseline" }}>
            <span style={{ color: c.status === "ok" ? "#34d399" : "#f59e0b", width: 14 }}>{c.status === "ok" ? "✓" : "⚠"}</span>
            <span style={{ color: "#5c6b85", width: 80, flexShrink: 0 }}>{c.label}</span>
            <span style={{ color: "#a1aec2" }}>{c.msg}</span>
          </div>
        ))}
        {result?.strategy && (
          <div style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: "IBM Plex Mono, monospace", alignItems: "baseline" }}>
            <span style={{ color: "#3984ff", width: 14 }}>◎</span>
            <span style={{ color: "#5c6b85", width: 80, flexShrink: 0 }}>部署策略</span>
            <span style={{ color: "#a1aec2" }}>{result.strategy}</span>
          </div>
        )}
      </div>

      {done && (
        <div className="hud-slide-up">
          <div style={{ marginTop: 9, fontSize: 12, color: tpl.color, borderTop: "1px dashed #1e2c45", paddingTop: 9, lineHeight: 1.7 }}>
            ◎ {result.advice}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {!gatewayDeployed && <ActionBtn label="在网关部署 Web 仿冒" onClick={() => sendToChat("在网关部署 Web 仿冒诱饵")} />}
            <ActionBtn label="进入归因分析 →" primary onClick={() => crossPageSend("attribution", "分析最近一条蜜点告警")} />
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: "#5c6b85", fontFamily: "IBM Plex Mono, monospace", letterSpacing: 0.5 }}>
            当前全网已激活 {s.deployments.filter((d) => d.status === "active").length} 个诱饵
          </div>
        </div>
      )}
    </ArtifactShell>
  );
}

function ProgressRing({ progress, color }: { progress: number; color: string }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  return (
    <svg width="50" height="50" viewBox="0 0 50 50" style={{ flexShrink: 0 }}>
      <circle cx="25" cy="25" r={r} fill="none" stroke="#15233a" strokeWidth="3.5" />
      <circle cx="25" cy="25" r={r} fill="none" stroke={color} strokeWidth="3.5" strokeDasharray={c}
        strokeDashoffset={c * (1 - progress / 100)} strokeLinecap="round" transform="rotate(-90 25 25)"
        style={{ transition: "stroke-dashoffset .1s linear", filter: `drop-shadow(0 0 3px ${color})` }} />
      <text x="25" y="29" textAnchor="middle" fontSize="10" fill="#c7d3e8" fontFamily="IBM Plex Mono, monospace">{Math.round(progress)}%</text>
    </svg>
  );
}

// ---------- 3. 溯源 Artifact ----------
export function TraceArtifact({ result }: { result: any }) {
  const s = useAppState();
  const alert = result?.alert;
  const alertId: string | null = result?.alertId ?? result?.alert?.id ?? null;
  const layerCount: number = result?.layers?.length ?? 4;

  useEffect(() => {
    setAppState({ traceData: result, traceLayersRevealed: 0 });
    if (alertId) {
      setCurrentAlertId(alertId);
      setAlertStatus(alertId, "研判中");
      pushActivity(`告警 ${alertId.split("-").slice(-2).join("-")} 进入自动溯源 · ${alert?.decoyType ?? ""}诱饵`, "red");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alertId]);

  const replay = result?.replay === true;
  const sevColor = alert?.severity === "紧急" ? "#ef4444" : alert?.severity === "高危" ? "#ff6a3d" : "#f59e0b";

  return (
    <>
      <ArtifactShell title="THREAT-ATTRIBUTION / 蜜点告警" badge={alert?.id ?? result?.alertId ?? "ALERT"} badgeColor="#ef4444">
        <div className="hud-card hud-glow-red" style={{ borderLeft: `2.5px solid ${sevColor}`, margin: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 10, fontFamily: "IBM Plex Mono, monospace", color: sevColor, letterSpacing: 1.5, display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="hud-dot pulse" style={{ ["--dot" as string]: sevColor }} />
              {alert?.decoyType ?? "SSH"} HONEYPOT TRIGGERED
            </span>
            <Tag color={sevColor}>严重度 · {alert?.severity ?? "高危"}</Tag>
          </div>
          <div style={{ fontSize: 13.5, color: "#e8eefc", fontWeight: 600, marginTop: 7 }}>{alert?.title ?? "SSH 诱饵被触发"}</div>
          <div style={{ fontSize: 11, color: "#7c8aa5", fontFamily: "IBM Plex Mono, monospace", marginTop: 3 }}>
            {alert?.decoyName}（{alert?.decoyIp}）· {alert?.time}
          </div>
          <div style={{ marginTop: 9, display: "flex", flexDirection: "column", gap: 4 }}>
            {(alert?.behavior ?? []).map((b: string, i: number) => (
              <div key={i} className="hud-slide-up" style={{ display: "flex", gap: 8, fontSize: 11, color: "#c7d3e8", lineHeight: 1.6, animationDelay: `${i * 80}ms` }}>
                <span style={{ color: sevColor }}>▸</span><span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </ArtifactShell>

      <ArtifactShell title="ATTACK GRAPH / 溯源图谱" badge={`L${s.traceLayersRevealed}/${layerCount}`} badgeColor={s.traceLayersRevealed >= layerCount ? "#34d399" : "#f59e0b"}>
        <AttackGraph
          layersRevealed={s.traceLayersRevealed}
          result={result}
          replay={replay}
          onRevealChange={(n) => {
            setAppState({ traceLayersRevealed: n, lastEvent: `溯源图谱展开第 ${n} 层` });
            if (n >= layerCount) {
              const conf = result?.verdict?.confidence;
              const benign = typeof conf === "number" && conf < 40;
              pushActivity(
                benign ? `溯源完成 · 判定良性（置信度 ${conf ?? "--"}%）` : `溯源完成 · 攻击研判置信度 ${conf ?? "--"}%`,
                benign ? "green" : conf >= 80 ? "red" : "amber",
              );
            }
          }}
        />
      </ArtifactShell>
    </>
  );
}

// ---------- 4. 蜜点卸载 Artifact ----------
export function UndeployArtifact({ result }: { result: any }) {
  const [p, setP] = useState(100);
  const doneRef = useRef(false);

  useEffect(() => {
    if (result?.error) { pushActivity(`卸载被阻断 · ${result.ip}`, "red"); return; }
    pushActivity(`开始回收 ${result.ip} 的 ${result.type ?? "全部"} 诱饵`, "muted");
    const t = setInterval(() => setP((v) => (v <= 0 ? 0 : v - 4)), 42);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (result?.error) return;
    if (p <= 0 && !doneRef.current) {
      doneRef.current = true;
      if (result?.ip) removeDeployment(result.ip, result.type);
    }
  }, [p, result]);

  if (result?.error) {
    return (
      <ArtifactShell title="DECEPTION-UNDEPLOY / 蜜点卸载" badge="FAILED" badgeColor="#ef4444">
        <div style={{ fontSize: 12, color: "#ef7c7c", border: "1px solid rgba(239,68,68,.3)", background: "rgba(239,68,68,.07)", padding: "10px 12px", lineHeight: 1.7 }}>
          ✕ {result.error}
        </div>
      </ArtifactShell>
    );
  }

  const removed: { type: HoneypotType; port: number }[] = result?.removed ?? (result?.type ? [{ type: result.type, port: result?.port ?? 0 }] : []);
  const released: number[] = result?.releasedPorts ?? removed.map((r) => r.port);
  const archivedLogs: number = result?.archivedLogs ?? 0;
  const checks = [
    { label: "已停止监听", done: p < 85 },
    { label: `已释放端口${released.map((x) => " :" + x).join("")}`, done: p < 50 },
    { label: `日志已归档 ${archivedLogs} 条（保留 30 天）`, done: p <= 0 },
  ];

  return (
    <ArtifactShell title="DECEPTION-UNDEPLOY / 蜜点卸载" badge={p <= 0 ? "STOPPED" : "UNDEPLOYING…"} badgeColor={p <= 0 ? "#7c8aa5" : "#ef4444"}>
      <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
        <div style={{
          width: 50, height: 50, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)",
          border: "1px solid #7c8aa5", color: "#7c8aa5", fontSize: 10, fontWeight: 700,
          background: "rgba(0,0,0,.3)", fontFamily: "IBM Plex Mono, monospace",
        }}>
          OFF
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "#e8eefc", fontWeight: 600, fontFamily: "IBM Plex Mono, monospace" }}>
            {result?.ip ?? ""} · 移除 {removed.map((r) => r.type).join(" / ")}
          </div>
          <div style={{ fontSize: 11, color: "#7c8aa5", marginTop: 2 }}>{p > 0 ? "逆向回收诱饵运行时…" : "诱饵已停止，资源已释放"}</div>
        </div>
        <ProgressRing progress={p} color={p > 0 ? "#ef4444" : "#7c8aa5"} />
      </div>

      <div style={{ marginTop: 10, borderTop: "1px dashed #1e2c45", paddingTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
        {checks.map((c, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, fontFamily: "IBM Plex Mono, monospace", alignItems: "baseline", opacity: c.done ? 1 : 0.45, transition: "opacity .3s" }}>
            <span style={{ color: c.done ? "#34d399" : "#5c6b85", width: 14 }}>{c.done ? "✓" : "○"}</span>
            <span style={{ color: c.done ? "#a1aec2" : "#5c6b85" }}>{c.label}</span>
          </div>
        ))}
      </div>

      {result?.warning && (
        <div style={{ marginTop: 9, border: "1px solid rgba(245,158,11,.35)", background: "rgba(245,158,11,.07)", padding: "8px 11px", fontSize: 11, color: "#e8c98a", lineHeight: 1.6, clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))" }}>
          ⚠ {result.warning}
        </div>
      )}
    </ArtifactShell>
  );
}
