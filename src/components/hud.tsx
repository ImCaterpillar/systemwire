"use client";

// 高科技 HUD 基础组件：角框 / 面板 / 标签 / 状态灯 / 计数动画 / 置信环 / 迷你趋势 / 启动序列 / 背景
import { useEffect, useRef, useState } from "react";

export const TONE: Record<string, string> = {
  critical: "#ef4444",
  high: "#f59e0b",
  medium: "#3984ff",
  low: "#34d399",
  info: "#22d3ee",
  cyan: "#22d3ee",
  blue: "#3984ff",
  green: "#34d399",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#a78bfa",
  muted: "#5c6b85",
};

export const SEVERITY_LABEL: Record<string, string> = {
  critical: "严重",
  high: "高危",
  medium: "中危",
  low: "低危",
};

/** 四角括框：放在相对定位容器内，绝对铺满 */
export function CornerFrame({ color = "#3984ff", size = 12 }: { color?: string; size?: number }) {
  const s = { width: size, height: size, borderColor: color };
  return (
    <span className="hud-bracket" style={{ ["--bracket-color" as string]: color }}>
      <i className="tr" style={s} />
      <i className="bl" style={s} />
    </span>
  );
}

/** HUD 面板：标题栏 + 角框 + 内容 */
export function HudPanel({
  title,
  en,
  index,
  right,
  accent = "#3984ff",
  children,
  className = "",
  bodyClassName = "",
  brackets = true,
  pad = true,
}: {
  title?: React.ReactNode;
  en?: string;
  index?: string;
  right?: React.ReactNode;
  accent?: string;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  brackets?: boolean;
  pad?: boolean;
}) {
  return (
    <section className={`hud-panel ${className}`} style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      {brackets && <CornerFrame color={accent} />}
      {(title || right) && (
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "10px 13px",
            borderBottom: "1px solid var(--line)",
            flex: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span style={{ width: 6, height: 6, background: accent, boxShadow: `0 0 8px ${accent}`, flex: "none" }} />
            {index && (
              <span style={{ color: accent, fontSize: 10, letterSpacing: 2, opacity: 0.8 }}>{index}</span>
            )}
            <span style={{ fontSize: 11, letterSpacing: 2.5, color: "var(--text-bright)", whiteSpace: "nowrap", fontWeight: 600 }}>
              {title}
            </span>
            {en && (
              <span style={{ fontSize: 9, letterSpacing: 2, color: "var(--muted)", textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {en}
              </span>
            )}
          </div>
          {right && <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8 }}>{right}</div>}
        </header>
      )}
      <div className={bodyClassName} style={{ padding: pad ? 13 : 0, flex: 1, minHeight: 0, overflow: "hidden" }}>
        {children}
      </div>
    </section>
  );
}

export function Tag({ tone = "info", color, children, style }: { tone?: string; color?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  const c = color ?? TONE[tone] ?? tone;
  return (
    <span className="hud-tag" style={{ color: c, ...style }}>
      {children}
    </span>
  );
}

export function StatusDot({ tone = "green", pulse = false, size = 7 }: { tone?: string; pulse?: boolean; size?: number }) {
  const color = TONE[tone] ?? tone;
  return (
    <span
      className={`hud-dot${pulse ? " pulse" : ""}`}
      style={{ ["--dot" as string]: color, width: size, height: size }}
    />
  );
}

/** 数字滚动动画 */
export function CountUp({
  value,
  duration = 900,
  decimals = 0,
  suffix = "",
  prefix = "",
  style,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  style?: React.CSSProperties;
}) {
  const [v, setV] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(value * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    // 兜底：页面在后台/离屏渲染时 rAF 可能整段不触发，用定时器补帧并保证落到最终值
    const safety = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setV(value * eased);
      if (t >= 1) window.clearInterval(safety);
    }, 120);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      window.clearInterval(safety);
    };
  }, [value, duration]);
  return (
    <span className="hud-value" style={style}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** 环形置信度仪表 */
export function Ring({
  value,
  size = 92,
  stroke = 6,
  color = "#3984ff",
  track = "rgba(41,74,121,0.35)",
  children,
  ticks = true,
  animate = true,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
  ticks?: boolean;
  animate?: boolean;
}) {
  const [shown, setShown] = useState(animate ? 0 : value);
  const r = (size - stroke) / 2 - (ticks ? 8 : 0);
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // 兜底：离屏渲染时 rAF 不触发，定时器补帧并保证落到最终值
    const safety = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / 900);
      setShown(value * (1 - Math.pow(1 - t, 3)));
      if (t >= 1) window.clearInterval(safety);
    }, 120);
    return () => { cancelAnimationFrame(raf); window.clearInterval(safety); };
  }, [value, animate]);
  const off = c * (1 - Math.max(0, Math.min(100, shown)) / 100);
  const r2d = (n: number) => Math.round(n * 100) / 100;
  const tickEls = ticks
    ? Array.from({ length: 36 }).map((_, i) => {
        const a = (i / 36) * Math.PI * 2;
        const r1 = size / 2 - 2;
        const r2 = i % 3 === 0 ? size / 2 - 7 : size / 2 - 5;
        return (
          <line
            key={i}
            x1={r2d(cx + Math.cos(a) * r1)}
            y1={r2d(size / 2 + Math.sin(a) * r1)}
            x2={r2d(cx + Math.cos(a) * r2)}
            y2={r2d(size / 2 + Math.sin(a) * r2)}
            stroke={i / 36 <= value / 100 ? color : "rgba(92,107,133,0.35)"}
            strokeWidth={1}
          />
        );
      })
    : null;
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      {tickEls}
      <circle cx={cx} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={off}
        strokeLinecap="round"
        transform={`rotate(-90 ${cx} ${size / 2})`}
        style={{ filter: `drop-shadow(0 0 5px ${color})`, transition: "stroke 0.3s" }}
      />
      {children != null && (
        <foreignObject x={0} y={0} width={size} height={size}>
          <div style={{ width: size, height: size, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            {children}
          </div>
        </foreignObject>
      )}
    </svg>
  );
}

/** 迷你柱状趋势 */
export function MiniBars({
  data,
  width = 220,
  height = 44,
  color = "#3984ff",
  highlightLast = true,
}: {
  data: { label: string; value: number; critical?: number }[];
  width?: number;
  height?: number;
  color?: string;
  highlightLast?: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = width / data.length;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * (height - 6);
        const last = highlightLast && i === data.length - 1;
        const c = d.critical ? "#ef4444" : last ? "#22d3ee" : color;
        return (
          <g key={d.label + i}>
            <rect
              x={i * bw + bw * 0.22}
              y={height - h}
              width={bw * 0.56}
              height={Math.max(1, h)}
              fill={c}
              opacity={last || d.critical ? 1 : 0.5}
              style={{ filter: last || d.critical ? `drop-shadow(0 0 3px ${c})` : "none" }}
            />
          </g>
        );
      })}
      <line x1={0} y1={height - 0.5} x2={width} y2={height - 0.5} stroke="rgba(41,74,121,0.5)" />
    </svg>
  );
}

/** 水平进度条 */
export function Bar({ value, tone = "", percent = true, height = 5, color, style }: { value: number; tone?: "" | "red" | "amber" | "green"; percent?: boolean; height?: number; color?: string; style?: React.CSSProperties }) {
  void percent;
  return (
    <div className={`hud-bar ${tone}`} style={{ height, ...style }}>
      <i style={{
        width: `${Math.max(0, Math.min(100, value))}%`,
        background: color,
        boxShadow: color ? `0 0 8px ${color}` : undefined,
      }} />
    </div>
  );
}

/** 分段控制器 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  dangerOn,
}: {
  options: { value: T; label: React.ReactNode; danger?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  dangerOn?: T;
}) {
  return (
    <div className="hud-seg">
      {options.map((o) => {
        const isOn = value === o.value;
        const isDanger = value === dangerOn && o.value === dangerOn;
        return (
          <button
            key={o.value}
            className={`${isOn ? "on" : ""} ${isDanger ? "red" : ""}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** 全局高科技背景 */
export function Backdrop() {
  return <div className="hud-backdrop" aria-hidden />;
}

/** 雷达扫描标记（SVG，可放任意容器中心） */
export function RadarMark({ size = 40, color = "#22d3ee", sweep = true }: { size?: number; color?: string; sweep?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" style={{ display: "block" }}>
      <circle cx="20" cy="20" r="18" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="20" cy="20" r="11" fill="none" stroke={color} strokeOpacity="0.25" strokeWidth="1" />
      <circle cx="20" cy="20" r="4" fill="none" stroke={color} strokeOpacity="0.4" strokeWidth="1" />
      {sweep && (
        <g style={{ transformOrigin: "20px 20px", animation: "hud-radar-sweep 2.6s linear infinite" }}>
          <path d="M20 20 L20 2 A18 18 0 0 1 38 20 Z" fill={color} fillOpacity="0.18" />
          <line x1="20" y1="20" x2="20" y2="2" stroke={color} strokeWidth="1.4" style={{ filter: `drop-shadow(0 0 3px ${color})` }} />
        </g>
      )}
      <circle cx="20" cy="20" r="2" fill={color} style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

/** 启动序列覆盖层 */
export function BootSequence({ steps, onDone }: { steps: string[]; onDone: () => void }) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (idx < steps.length) {
      const t = setTimeout(() => setIdx((i) => i + 1), 340);
      return () => clearTimeout(t);
    }
    const t1 = setTimeout(() => setDone(true), 380);
    const t2 = setTimeout(onDone, 1000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);
  return (
    <div className={`hud-boot ${done ? "done" : ""}`}>
      <div className="hud-boot-ring">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(41,74,121,0.4)" strokeWidth="1.5" />
          <circle
            cx="48"
            cy="48"
            r="42"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeDasharray={`${2 * Math.PI * 42}`}
            strokeDashoffset={`${2 * Math.PI * 42 * (1 - Math.min(1, idx / steps.length) * 0.92)}`}
            strokeLinecap="round"
            transform="rotate(-90 48 48)"
            style={{ filter: "drop-shadow(0 0 6px #22d3ee)", transition: "stroke-dashoffset .3s" }}
          />
          {Array.from({ length: 24 }).map((_, i) => {
            const a = (i / 24) * Math.PI * 2;
            const r2d = (n: number) => Math.round(n * 100) / 100;
            return (
              <line
                key={i}
                x1={r2d(48 + Math.cos(a) * 40)}
                y1={r2d(48 + Math.sin(a) * 40)}
                x2={r2d(48 + Math.cos(a) * (i % 2 ? 35 : 32))}
                y2={r2d(48 + Math.sin(a) * (i % 2 ? 35 : 32))}
                stroke={i / 24 <= idx / steps.length ? "#22d3ee" : "rgba(92,107,133,0.4)"}
                strokeWidth="1"
              />
            );
          })}
          <g style={{ transformOrigin: "48px 48px", animation: "hud-radar-sweep 2.2s linear infinite" }}>
            <path d="M48 48 L48 8 A40 40 0 0 1 88 48 Z" fill="#3984ff" fillOpacity="0.16" />
          </g>
          {/* 盾标 */}
          <path d="M48 30 L60 35 V46 C60 54 55 60 48 63 C41 60 36 54 36 46 V35 Z" fill="rgba(57,132,255,0.18)" stroke="#7db0ff" strokeWidth="1.4" style={{ filter: "drop-shadow(0 0 5px rgba(57,132,255,0.7))" }} />
          <path d="M43 47 L47 51 L54 42" fill="none" stroke="#aee9ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, letterSpacing: 6, color: "#e8eefc", fontWeight: 600 }} className="hud-glow">
          SYSTEMWIRE
        </div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "var(--muted)", marginTop: 4 }}>
          INTERNAL DEFENSE COPILOT
        </div>
      </div>
      <div className="hud-boot-log">
        {steps.slice(0, idx).map((s, i) => (
          <div key={i}>
            <span className="ok">[ OK ]</span> {s}
          </div>
        ))}
        {idx < steps.length && (
          <div>
            <span className="run">[ .. ]</span> {steps[idx]}
            <span className="hud-caret" style={{ marginLeft: 4 }} />
          </div>
        )}
      </div>
    </div>
  );
}
