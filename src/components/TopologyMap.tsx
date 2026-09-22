"use client";

// 拓扑图组件：HUD 雷达网络风 SVG
// - 同心雷达环 + 扫描扇面、六边形节点、辉光数据流、诱饵菱形徽标
// - 节点逐个动画出现、可拖拽重排、右键菜单、tooltip、搜索定位、连线证据
import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset, Link, AssetType, HoneypotType } from "../lib/mock-data";
import { HONEYPOT_TEMPLATES } from "../lib/mock-data";

interface Props {
  assets: Asset[];
  links: Link[];
  deployments: { ip: string; type: HoneypotType }[];
  selectedIp?: string | null;
  highlightIp?: string | null;
  revealDelay?: number; // 每个节点出现的间隔(ms)
  onSelectNode?: (ip: string) => void;
  onDeploy?: (ip: string) => void;
  onMention?: (ip: string) => void;
  onHighlightConsumed?: () => void;
}

// ---- 6 种节点图标（16x16 视口） ----
const ICON: Record<AssetType, React.ReactNode> = {
  server: (
    <g>
      <rect x="-6.5" y="-8.5" width="13" height="17" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="-4.5" y1="-4.6" x2="4.5" y2="-4.6" stroke="currentColor" strokeWidth="1.1" />
      <line x1="-4.5" y1="-0.8" x2="4.5" y2="-0.8" stroke="currentColor" strokeWidth="1.1" />
      <line x1="-4.5" y1="3" x2="4.5" y2="3" stroke="currentColor" strokeWidth="1.1" />
      <circle cx="3.4" cy="-7" r="0.9" fill="currentColor" />
    </g>
  ),
  monitor: (
    <g>
      <rect x="-7.5" y="-6.5" width="15" height="10" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <line x1="-2.5" y1="3.5" x2="2.5" y2="3.5" stroke="currentColor" strokeWidth="1.3" />
      <line x1="0" y1="3.5" x2="0" y2="6.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M-4 -3 L4 -3 M-4 0 L2 0" stroke="currentColor" strokeWidth="0.9" opacity="0.7" />
    </g>
  ),
  industrial: (
    <g>
      <circle r="6.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle r="2.4" fill="currentColor" />
      <line x1="0" y1="-6.6" x2="0" y2="-9.6" stroke="currentColor" strokeWidth="1.3" />
      <line x1="0" y1="6.6" x2="0" y2="9.6" stroke="currentColor" strokeWidth="1.3" />
      <line x1="-6.6" y1="0" x2="-9.6" y2="0" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6.6" y1="0" x2="9.6" y2="0" stroke="currentColor" strokeWidth="1.3" />
    </g>
  ),
  printer: (
    <g>
      <rect x="-7.5" y="-7.5" width="15" height="6.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="-5.5" y="-1" width="11" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="-3.6" cy="7" r="0.9" fill="currentColor" />
      <circle cx="3.6" cy="7" r="0.9" fill="currentColor" />
    </g>
  ),
  camera: (
    <g>
      <rect x="-7.5" y="-5.5" width="15" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle r="3.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle r="1.1" fill="currentColor" />
    </g>
  ),
  chip: (
    <g>
      <rect x="-7.5" y="-7.5" width="15" height="15" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <rect x="-3.6" y="-3.6" width="7.2" height="7.2" rx="1" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      <line x1="-7.5" y1="-3.8" x2="-10.4" y2="-3.8" stroke="currentColor" strokeWidth="1.1" />
      <line x1="-7.5" y1="0" x2="-10.4" y2="0" stroke="currentColor" strokeWidth="1.1" />
      <line x1="-7.5" y1="3.8" x2="-10.4" y2="3.8" stroke="currentColor" strokeWidth="1.1" />
      <line x1="7.5" y1="-3.8" x2="10.4" y2="-3.8" stroke="currentColor" strokeWidth="1.1" />
      <line x1="7.5" y1="0" x2="10.4" y2="0" stroke="currentColor" strokeWidth="1.1" />
      <line x1="7.5" y1="3.8" x2="10.4" y2="3.8" stroke="currentColor" strokeWidth="1.1" />
    </g>
  ),
};
// monitor 图标直接使用 currentColor 字面量

const RISK_COLOR = { none: "#6a7ea0", low: "#f59e0b", high: "#ef4444" };
const W = 560;
const H = 520;
const RADAR = { x: 280, y: 272 };

// 六边形顶点
function hexPoints(r: number): string {
  const r2d = (n: number) => Math.round(n * 100) / 100;
  return Array.from({ length: 6 })
    .map((_, i) => {
      const a = (Math.PI / 180) * (60 * i - 30);
      return `${r2d(Math.cos(a) * r)},${r2d(Math.sin(a) * r)}`;
    })
    .join(" ");
}

const ZONES = [
  { x: 470, y: 56, t: "边界 / EDGE" },
  { x: 250, y: 178, t: "核心交换 / CORE" },
  { x: 120, y: 452, t: "服务器区 / FARM" },
  { x: 60, y: 262, t: "工控 / ICS" },
];

export default function TopologyMap({
  assets, links, deployments, selectedIp, highlightIp, revealDelay = 300,
  onSelectNode, onDeploy, onMention, onHighlightConsumed,
}: Props) {
  const [revealed, setRevealed] = useState(0);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [hover, setHover] = useState<{ ip: string; x: number; y: number } | null>(null);
  const [menu, setMenu] = useState<{ ip: string; x: number; y: number } | null>(null);
  const [linkEvidence, setLinkEvidence] = useState<{ text: string; type: Link["type"] } | null>(null);
  const [search, setSearch] = useState("");
  const [drag, setDrag] = useState<{ ip: string; dx: number; dy: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const sweeping = revealed < assets.length;

  useEffect(() => {
    setRevealed(0);
    setPositions(Object.fromEntries(assets.map((a) => [a.ip, { x: a.x, y: a.y }])));
    const t = setInterval(() => {
      setRevealed((r) => {
        if (r >= assets.length) { clearInterval(t); return r; }
        return r + 1;
      });
    }, revealDelay);
    return () => clearInterval(t);
  }, [assets, revealDelay]);

  useEffect(() => {
    if (!highlightIp) return;
    const idx = assets.findIndex((a) => a.ip === highlightIp);
    if (idx < 0) return;
    setRevealed((r) => Math.max(r, idx + 1));
    const a = assets[idx];
    setHover({ ip: a.ip, x: positions[a.ip]?.x ?? a.x, y: positions[a.ip]?.y ?? a.y });
    const t1 = setTimeout(() => setHover(null), 3600);
    const t2 = setTimeout(() => onHighlightConsumed?.(), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightIp]);

  const visible = useMemo(() => assets.slice(0, revealed), [assets, revealed]);
  const visibleIps = useMemo(() => new Set(visible.map((a) => a.ip)), [visible]);
  const searchHit = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    return assets.find((a) => a.ip.includes(q) || a.name.toLowerCase().includes(q)) ?? null;
  }, [search, assets]);

  const onPointerDown = (e: React.PointerEvent, ip: string) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDrag({ ip, dx: e.clientX, dy: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const cur = positions[drag.ip] ?? { x: 0, y: 0 };
    const ns = e.currentTarget.getBoundingClientRect();
    const scale = W / ns.width;
    const nx = cur.x + (e.clientX - drag.dx) * scale;
    const ny = cur.y + (e.clientY - drag.dy) * (H / ns.height);
    setPositions((prev) => ({ ...prev, [drag.ip]: { x: Math.max(24, Math.min(W - 24, nx)), y: Math.max(24, Math.min(H - 24, ny)) } }));
    setDrag({ ip: drag.ip, dx: e.clientX, dy: e.clientY });
  };
  const onPointerUp = () => setDrag(null);

  const deployOf = (ip: string) => deployments.find((d) => d.ip === ip);

  return (
    <div style={{ position: "relative", width: "100%" }}>
      {/* 搜索框 */}
      <div style={{ position: "absolute", top: 10, right: 10, zIndex: 5 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 IP / 名称"
          style={{
            background: "rgba(8,13,21,0.92)", border: "1px solid #294a79", color: "#cfe0ff",
            padding: "5px 10px", fontSize: 11, width: 150, outline: "none",
            fontFamily: "IBM Plex Mono, monospace", letterSpacing: 0.5,
            clipPath: "polygon(0 0,100% 0,100% calc(100% - 6px),calc(100% - 6px) 100%,0 100%)",
          }}
        />
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{
          display: "block",
          background:
            "radial-gradient(460px 460px at 50% 52%, rgba(57,132,255,0.15), transparent 70%), #070b12",
          border: "1px solid #14233c",
          cursor: drag ? "grabbing" : "default",
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { setDrag(null); setMenu(null); }}
        onClick={() => { setMenu(null); setLinkEvidence(null); }}
      >
        {/* ===== 雷达底图 ===== */}
        <defs>
          <radialGradient id="nodeFill" cx="50%" cy="36%" r="80%">
            <stop offset="0%" stopColor="rgba(38,66,112,0.98)" />
            <stop offset="62%" stopColor="rgba(16,28,48,0.97)" />
            <stop offset="100%" stopColor="rgba(8,13,22,0.97)" />
          </radialGradient>
          <linearGradient id="sweepGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(34,211,238,0)" />
            <stop offset="100%" stopColor="rgba(34,211,238,0.28)" />
          </linearGradient>
          <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%">
            <feGaussianBlur stdDeviation="2.2" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* 细网格 */}
        <g opacity="0.5">
          {Array.from({ length: 12 }).map((_, i) => (
            <line key={"v" + i} x1={(i + 1) * (W / 13)} y1="0" x2={(i + 1) * (W / 13)} y2={H} stroke="rgba(57,132,255,0.08)" strokeWidth="0.6" />
          ))}
          {Array.from({ length: 11 }).map((_, i) => (
            <line key={"h" + i} x1="0" y1={(i + 1) * (H / 12)} x2={W} y2={(i + 1) * (H / 12)} stroke="rgba(57,132,255,0.08)" strokeWidth="0.6" />
          ))}
        </g>

        {/* 同心雷达环 + 十字准线（以核心交换机为中心） */}
        {[70, 140, 215, 285].map((r) => (
          <circle key={r} cx={RADAR.x} cy={RADAR.y} r={r} fill="none" stroke="rgba(57,132,255,0.2)" strokeWidth="1" strokeDasharray="2 5" />
        ))}
        <line x1={RADAR.x - 285} y1={RADAR.y} x2={RADAR.x + 285} y2={RADAR.y} stroke="rgba(57,132,255,0.13)" strokeWidth="0.8" />
        <line x1={RADAR.x} y1={RADAR.y - 250} x2={RADAR.x} y2={RADAR.y + 250} stroke="rgba(57,132,255,0.13)" strokeWidth="0.8" />

        {/* 扫描扇面（仅在逐个出现期间） */}
        {sweeping && (
          <g style={{ transformOrigin: `${RADAR.x}px ${RADAR.y}px`, animation: "hud-radar-sweep 2.4s linear infinite" }}>
            <path d={`M${RADAR.x} ${RADAR.y} L${RADAR.x} ${RADAR.y - 285} A285 285 0 0 1 ${RADAR.x + 285} ${RADAR.y} Z`} fill="url(#sweepGrad)" opacity="0.7" />
            <line x1={RADAR.x} y1={RADAR.y} x2={RADAR.x} y2={RADAR.y - 285} stroke="#22d3ee" strokeWidth="1.3" style={{ filter: "drop-shadow(0 0 4px #22d3ee)" }} />
          </g>
        )}

        {/* 区域标签 */}
        {ZONES.map((z) => (
          <text key={z.t} x={z.x} y={z.y} fontSize="8.5" letterSpacing="1.5" fill="rgba(120,136,166,0.85)" fontFamily="IBM Plex Mono, monospace" textAnchor="middle">
            {z.t}
          </text>
        ))}

        {/* ===== 连线 ===== */}
        {links.filter((l) => visibleIps.has(l.from) && visibleIps.has(l.to)).map((l, i) => {
          const a = positions[l.from] ?? { x: 0, y: 0 };
          const b = positions[l.to] ?? { x: 0, y: 0 };
          const isFlow = l.type === "flow";
          const color = isFlow ? "#3984ff" : l.type === "probable" ? "#8a98b5" : "#2a3a57";
          return (
            <g key={i}>
              {/* 辉光底 */}
              {isFlow && (
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3984ff" strokeWidth="4" opacity="0.12" />
              )}
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={color} strokeWidth={isFlow ? 1.7 : 1}
                strokeDasharray={l.type === "lldp" ? undefined : l.type === "probable" ? "4 5" : undefined}
                className={isFlow ? "hud-flow" : undefined}
                opacity={isFlow ? 0.95 : 0.7}
                style={isFlow ? { filter: "drop-shadow(0 0 3px rgba(57,132,255,0.7))" } : undefined}
              />
              <line
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={12}
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onClick={(e) => { e.stopPropagation(); setLinkEvidence({ text: l.evidence, type: l.type }); }}
              />
              {isFlow && (
                <circle r="2.6" fill="#9fd7ff" filter="url(#softGlow)" style={{ pointerEvents: "none" }}>
                  <animateMotion dur="1.1s" repeatCount="indefinite" path={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} />
                </circle>
              )}
            </g>
          );
        })}

        {/* ===== 节点 ===== */}
        {visible.map((a, vi) => {
          const p = positions[a.ip] ?? { x: a.x, y: a.y };
          const color = RISK_COLOR[a.risk];
          const dp = deployOf(a.ip);
          const decoyColor = dp ? HONEYPOT_TEMPLATES[dp.type].color : null;
          const isSelected = selectedIp === a.ip;
          const isHighlight = highlightIp === a.ip;
          const isSearch = searchHit?.ip === a.ip;
          return (
            <g
              key={a.ip}
              transform={`translate(${p.x},${p.y})`}
              opacity={drag && drag.ip !== a.ip ? 0.4 : 1}
              style={{ cursor: "grab", transition: "opacity .3s ease" }}
              onPointerDown={(e) => onPointerDown(e, a.ip)}
              onPointerEnter={() => setHover({ ip: a.ip, x: p.x, y: p.y })}
              onPointerLeave={() => setHover((h) => (h?.ip === a.ip ? null : h))}
              onClick={(e) => { e.stopPropagation(); setLinkEvidence(null); onSelectNode?.(a.ip); }}
              onContextMenu={(e) => {
                e.preventDefault(); e.stopPropagation();
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                const scale = W / rect.width;
                setMenu({ ip: a.ip, x: p.x * scale - 44, y: p.y * scale - 26 });
              }}
            >
              {/* 入场动画内层 g：CSS transform 与外层 SVG 定位 transform 隔离，避免动画把节点塌缩到原点 */}
              <g
                style={{
                  animation: "topo-node-in .45s cubic-bezier(.2,.8,.2,1) both",
                  animationDelay: `${vi * 40}ms`,
                  transformBox: "fill-box",
                  transformOrigin: "center",
                }}
              >
                {/* 高危辉光底晕 */}
                {a.risk === "high" && (
                  <circle r="24" fill="#ef4444" opacity="0.13" style={{ filter: "blur(3px)", transformBox: "fill-box", transformOrigin: "center" }} />
                )}
                {/* 高危 ping 圈 */}
                {a.risk === "high" && (
                  <circle r="17" fill="none" stroke="#ef4444" strokeWidth="1.4" className="hud-ping" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
                )}
                {/* 诱饵节点：彩色旋转环 */}
                {decoyColor && (
                  <circle r="22" fill="none" stroke={decoyColor} strokeWidth="1" strokeDasharray="3 4" opacity="0.9"
                    style={{ transformBox: "fill-box", transformOrigin: "center", animation: "hud-spin 7s linear reverse" }} />
                )}
                {/* 选中环 */}
                {isSelected && (
                  <circle r="21" fill="none" stroke="#3984ff" strokeWidth="1.3" strokeDasharray="3 3"
                    style={{ transformBox: "fill-box", transformOrigin: "center", animation: "hud-spin 9s linear infinite", filter: "drop-shadow(0 0 4px rgba(57,132,255,.8))" }} />
                )}
                {/* 跨页定位脉冲 */}
                {isHighlight && (
                  <circle r="19" fill="none" stroke="#3984ff" strokeWidth="1.8" className="hud-ping" style={{ transformBox: "fill-box", transformOrigin: "center", animationDuration: "1.1s" }} />
                )}
                {/* 六边形节点体 */}
                <polygon
                  points={hexPoints(17)}
                  fill="url(#nodeFill)"
                  stroke={isSearch ? "#3984ff" : color}
                  strokeWidth={a.risk === "high" ? 2.1 : isSelected || isSearch ? 2 : 1.7}
                  filter={a.risk === "high" ? "url(#softGlow)" : undefined}
                  style={{ filter: a.risk === "high" ? "drop-shadow(0 0 6px rgba(239,68,68,.6))" : isSelected || isSearch ? "drop-shadow(0 0 5px rgba(57,132,255,.75))" : "drop-shadow(0 1px 2px rgba(0,0,0,.6))" }}
                />
                <polygon points={hexPoints(12.5)} fill="none" stroke={color} strokeWidth="0.6" opacity="0.45" />
                <g color={isSearch ? "#7db0ff" : color} style={{ pointerEvents: "none" }}>{ICON[a.type]}</g>

                {/* 诱饵菱形徽标 */}
                {dp && decoyColor && (
                  <g transform="translate(13,-13)">
                    <rect x="-9" y="-7" width="18" height="14" rx="1" transform="rotate(45)" fill={decoyColor} fillOpacity="0.92" stroke="#06080c" strokeWidth="0.8" style={{ filter: `drop-shadow(0 0 4px ${decoyColor})` }} />
                    <text x="0" y="2.6" textAnchor="middle" fontSize="6.6" fill="#06080c" fontWeight="700" fontFamily="IBM Plex Mono, monospace" style={{ pointerEvents: "none" }}>{dp.type}</text>
                  </g>
                )}

                <text y="29" textAnchor="middle" fontSize="9.5" fontWeight="700"
                  fill={isSelected ? "#e8eefc" : a.risk === "high" ? "#ffd9dc" : "#c6d6f2"}
                  fontFamily="IBM Plex Mono, monospace"
                  style={{ pointerEvents: "none", letterSpacing: 0.5, paintOrder: "stroke", stroke: "#05070b", strokeWidth: 3.2, strokeLinejoin: "round" }}>{a.ip.replace("192.168.1.", "")}</text>
                <text y="40" textAnchor="middle" fontSize="7.6" fill={a.risk === "high" ? "#ef9a9a" : "#7f92b2"} fontFamily="IBM Plex Mono, monospace"
                  style={{ pointerEvents: "none", paintOrder: "stroke", stroke: "#05070b", strokeWidth: 2.6, strokeLinejoin: "round" }}>{a.name}</text>
              </g>
            </g>
          );
        })}
      </svg>

      <style>{`
        @keyframes topo-node-in { from { opacity: 1; transform: scale(.7); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      {/* tooltip */}
      {hover && (() => {
        const a = assets.find((x) => x.ip === hover.ip);
        if (!a) return null;
        const dp = deployOf(a.ip);
        const leftPct = (hover.x / W) * 100;
        return (
          <div className="hud-card hud-slide-up" style={{
            position: "absolute", left: `calc(${Math.min(leftPct, 60)}% + 14px)`, top: 48, zIndex: 6,
            padding: "9px 11px", minWidth: 218, pointerEvents: "none", fontSize: 11,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span className="hud-dot" style={{ ["--dot" as string]: RISK_COLOR[a.risk] }} />
              <span style={{ color: "#e8eefc", fontWeight: 600, fontSize: 12 }}>{a.name} · {a.ip}</span>
            </div>
            <div style={{ color: "#7c8aa5", marginTop: 5 }}>系统：{a.os}</div>
            <div style={{ color: "#7c8aa5" }}>服务：{a.services.join(" · ")}</div>
            {a.risk !== "none" && <div style={{ color: RISK_COLOR[a.risk], marginTop: 4 }}>▲ {a.riskNote}</div>}
            {dp && <div style={{ color: HONEYPOT_TEMPLATES[dp.type].color, marginTop: 4 }}>◆ 蜜点：{dp.type} 诱饵（端口 {(dp as { port?: number }).port ?? ""}）</div>}
            {a.evidence && <div style={{ color: "#56647d", marginTop: 5, borderTop: "1px solid #16263f", paddingTop: 4, fontSize: 10 }}>证据：{a.evidence}</div>}
          </div>
        );
      })()}

      {/* 右键菜单 */}
      {menu && (
        <div className="hud-card" style={{ position: "absolute", left: menu.x, top: menu.y, zIndex: 7, minWidth: 158, overflow: "hidden" }}
          onClick={(e) => e.stopPropagation()}>
          {[
            { label: "▸ 查看详情", fn: () => onSelectNode?.(menu.ip) },
            { label: "◆ 部署蜜点", fn: () => onDeploy?.(menu.ip) },
            { label: "⌖ 在对话中提及", fn: () => onMention?.(menu.ip) },
          ].map((it, i) => (
            <div key={it.label} style={{ padding: "8px 13px", fontSize: 11, letterSpacing: 1, color: "#c7d3e8", cursor: "pointer", borderTop: i ? "1px solid #14233c" : "none" }}
              onClick={() => { it.fn(); setMenu(null); }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "rgba(57,132,255,0.14)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}>
              {it.label}
            </div>
          ))}
        </div>
      )}

      {/* 连线证据条 */}
      {linkEvidence && (
        <div className="hud-card hud-slide-up" style={{
          position: "absolute", left: 12, right: 12, bottom: 12, zIndex: 6,
          padding: "8px 12px", fontSize: 11, color: "#c7d3e8",
          display: "flex", alignItems: "center", gap: 10,
        }}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="hud-tag" style={{
            color: linkEvidence.type === "flow" ? "#3984ff" : linkEvidence.type === "probable" ? "#a1aec2" : "#5c6b85",
            flex: "none",
          }}>
            {linkEvidence.type === "flow" ? "通信关系" : linkEvidence.type === "probable" ? "推测可达" : "物理邻居 LLDP"}
          </span>
          <span style={{ flex: 1 }}>{linkEvidence.text}</span>
          <span style={{ color: "#5c6b85", cursor: "pointer" }} onClick={() => setLinkEvidence(null)}>✕</span>
        </div>
      )}

      {/* 扫描计数角标 */}
      <div style={{
        position: "absolute", left: 10, top: 10, zIndex: 5, display: "flex", gap: 7, alignItems: "center",
        background: "rgba(8,13,21,0.88)", border: "1px solid #1e2c45", padding: "4px 9px",
        fontSize: 10, color: "#7c8aa5", fontFamily: "IBM Plex Mono, monospace", letterSpacing: 1,
      }}>
        <span style={{ color: sweeping ? "#22d3ee" : "#34d399", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span className={`hud-dot ${sweeping ? "pulse" : ""}`} style={{ ["--dot" as string]: sweeping ? "#22d3ee" : "#34d399" }} />
          {sweeping ? "SCANNING" : "ONLINE"}
        </span>
        <span style={{ color: "#e8eefc" }}>{visible.length}/{assets.length}</span>
      </div>
    </div>
  );
}
