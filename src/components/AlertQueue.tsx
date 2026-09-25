"use client";

// 告警工作台列表（二期）：列表 + 三级筛选（级别/状态/蜜点类型）+ 当前分析对象高亮
// 状态从 store.alertStatusMap 实时读取，点击联动 setCurrentAlertId
import { useState } from "react";
import { MOCK_ALERTS, HONEYPOT_TEMPLATES } from "../lib/mock-data";
import type { Alert, AlertSeverity, AlertStatus, HoneypotType } from "../lib/mock-data";
import { useAppState, setCurrentAlertId } from "../lib/app-store";

const MONO = "IBM Plex Mono, monospace";

const SEV_COLOR: Record<AlertSeverity, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#a78bfa",
  low: "#34d399",
};
const STATUS_COLOR: Record<AlertStatus, string> = {
  待研判: "#f59e0b",
  研判中: "#3984ff",
  已闭环: "#34d399",
  误报: "#5c6b85",
};

/** ALERT-2026-0919-001 -> 0919-001 */
function shortId(id: string): string {
  const p = id.split("-");
  return p.slice(-2).join("-");
}
/** 2026-09-19 02:14:33 -> 09-19 02:14 */
function fmtTime(t: string): string {
  return t.slice(5, 16);
}

export interface AlertQueueProps {
  compact?: boolean; // 右栏紧凑模式：只显示级别筛选
  onSelect?: (alertId: string) => void; // 点击告警时回调
}

type SevFilter = "all" | AlertSeverity;
type StFilter = "all" | AlertStatus;
type TpFilter = "all" | HoneypotType;

const SEV_FILTERS: { v: SevFilter; label: string }[] = [
  { v: "all", label: "全部" },
  { v: "critical", label: "critical" },
  { v: "high", label: "high" },
  { v: "medium", label: "medium" },
  { v: "low", label: "low" },
];
const ST_FILTERS: { v: StFilter; label: string }[] = [
  { v: "all", label: "全部" },
  { v: "待研判", label: "待研判" },
  { v: "研判中", label: "研判中" },
  { v: "已闭环", label: "已闭环" },
  { v: "误报", label: "误报" },
];
const TP_FILTERS: { v: TpFilter; label: string }[] = [
  { v: "all", label: "全部" },
  { v: "SSH", label: "SSH" },
  { v: "SQL", label: "SQL" },
  { v: "WEB", label: "WEB" },
  { v: "SMB", label: "SMB" },
];

function FilterChip({ active, color, children, onClick }: { active: boolean; color?: string; children: React.ReactNode; onClick: () => void }) {
  const c = color ?? "#3984ff";
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 9,
        fontFamily: MONO,
        letterSpacing: 0.5,
        cursor: "pointer",
        padding: "2px 8px",
        whiteSpace: "nowrap",
        background: active ? c : "transparent",
        color: active ? "#06080c" : "#6b7a96",
        border: `1px solid ${active ? c : "#1e2c45"}`,
        clipPath: "polygon(0 0,100% 0,100% calc(100% - 4px),calc(100% - 4px) 100%,0 100%)",
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </button>
  );
}

export function AlertQueue({ compact = false, onSelect }: AlertQueueProps) {
  const s = useAppState();
  const [sev, setSev] = useState<SevFilter>("all");
  const [st, setSt] = useState<StFilter>("all");
  const [tp, setTp] = useState<TpFilter>("all");

  const rows = MOCK_ALERTS.slice()
    .sort((a, b) => (a.time < b.time ? 1 : -1))
    .filter((a) => {
      if (sev !== "all" && a.severity !== sev) return false;
      const cur: AlertStatus = s.alertStatusMap[a.id] ?? a.status;
      if (st !== "all" && cur !== st) return false;
      if (tp !== "all" && a.decoyType !== tp) return false;
      return true;
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* 筛选器 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {SEV_FILTERS.map((f) => (
          <FilterChip key={f.v} active={sev === f.v} color={f.v === "all" ? "#3984ff" : SEV_COLOR[f.v as AlertSeverity]} onClick={() => setSev(f.v)}>
            {f.label}
          </FilterChip>
        ))}
      </div>
      {!compact && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {ST_FILTERS.map((f) => (
              <FilterChip key={f.v} active={st === f.v} color={f.v === "all" ? "#3984ff" : STATUS_COLOR[f.v as AlertStatus]} onClick={() => setSt(f.v)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
            {TP_FILTERS.map((f) => (
              <FilterChip key={f.v} active={tp === f.v} color={f.v === "all" ? "#3984ff" : HONEYPOT_TEMPLATES[f.v as HoneypotType].color} onClick={() => setTp(f.v)}>
                {f.label}
              </FilterChip>
            ))}
          </div>
        </>
      )}

      {/* 列表 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: compact ? 260 : 420, overflowY: "auto", paddingRight: 2 }}>
        {rows.length === 0 ? (
          <div style={{ fontSize: 11, color: "#4d5a70", border: "1px dashed #1e2c45", padding: "14px 10px", textAlign: "center", clipPath: "polygon(0 0,calc(100% - 8px) 0,100% 8px,100% 100%,8px 100%,0 calc(100% - 8px))" }}>
            暂无告警
          </div>
        ) : (
          rows.map((a: Alert) => {
            const cur: AlertStatus = s.alertStatusMap[a.id] ?? a.status;
            const active = s.currentAlertId === a.id;
            const tpl = HONEYPOT_TEMPLATES[a.decoyType];
            const sev = SEV_COLOR[a.severity];
            return (
              <button
                key={a.id}
                onClick={() => {
                  setCurrentAlertId(a.id);
                  onSelect?.(a.id);
                }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = "#294a79"; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.borderColor = "rgba(30,44,69,.6)"; }}
                style={{
                  position: "relative",
                  textAlign: "left",
                  cursor: "pointer",
                  padding: "6px 9px 6px 11px",
                  background: active ? `linear-gradient(90deg, ${sev}1f, rgba(11,16,25,.6))` : "rgba(255,255,255,.02)",
                  border: `1px solid ${active ? "#294a79" : "rgba(30,44,69,.6)"}`,
                  borderLeft: `2.5px solid ${sev}`,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: MONO,
                  clipPath: "polygon(0 0,calc(100% - 7px) 0,100% 7px,100% 100%,0 100%)",
                  boxShadow: active ? `0 0 14px ${sev}22` : "none",
                  overflow: "hidden",
                }}
              >
                {/* 严重级别色点 */}
                <span
                  className={a.severity === "critical" && cur !== "已闭环" && cur !== "误报" ? "hud-slow-blink" : undefined}
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: sev,
                    boxShadow: `0 0 6px ${sev}`,
                  }}
                />
                {/* id 短格式 */}
                <span style={{ fontSize: 10, color: active ? "#e8eefc" : "#c7d3e8", flexShrink: 0 }}>{shortId(a.id)}</span>
                {/* 蜜点类型徽标 */}
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    flexShrink: 0,
                    color: tpl.color,
                    border: `1px solid ${tpl.color}66`,
                    padding: "0 4px",
                    clipPath: "polygon(0 0,100% 0,100% calc(100% - 3px),calc(100% - 3px) 100%,0 100%)",
                  }}
                >
                  {a.decoyType}
                </span>
                {/* 行为摘要 + campaign */}
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 10, color: active ? "#e8eefc" : "#a1aec2", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.title.replace(/^(SSH|SQL|Web|SMB)\s*诱饵被触发[:：]\s*/i, "")}
                  </span>
                  {a.campaignId && (
                    <span style={{ fontSize: 8, color: "#5c6b85" }}>{a.campaignId}</span>
                  )}
                </span>
                {/* 时间 + 状态徽标 */}
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                  <span style={{ fontSize: 9, color: "#7c8aa5" }}>{fmtTime(a.time)}</span>
                  <span
                    style={{
                      fontSize: 8,
                      color: STATUS_COLOR[cur],
                      border: `1px solid ${STATUS_COLOR[cur]}55`,
                      padding: "0 4px",
                      clipPath: "polygon(0 0,100% 0,100% calc(100% - 3px),calc(100% - 3px) 100%,0 100%)",
                    }}
                  >
                    {cur}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export default AlertQueue;
