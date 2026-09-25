// 模拟数据：内网安全智能体平台（全部为演示用假数据）

export type AssetType = "server" | "monitor" | "industrial" | "printer" | "camera" | "chip";

export interface Asset {
  ip: string;
  name: string;
  os: string;
  services: string[];
  risk: "none" | "low" | "high";
  riskNote?: string;
  type: AssetType;
  x: number; // 画布坐标
  y: number;
  evidence?: string; // 原始证据（点连线查看）
  honeypot?: string; // 已部署蜜点类型
}

export const MOCK_CIDR = "192.168.1.0/24";

export const MOCK_ASSETS: Asset[] = [
  { ip: "192.168.1.1",   name: "GW-01",    os: "RouterOS", services: ["web(80/443)"], risk: "none", type: "monitor",  x: 490, y: 70,  evidence: "LLDP 邻居：SW-01 (port 0/24)" },
  { ip: "192.168.1.112", name: "SW-01",    os: "ProCurve", services: ["snmp(161)"],   risk: "low", riskNote: "SNMP 默认团体字 public", type: "chip", x: 280, y: 200, evidence: "LLDP 邻居：GW-01 + 全部终端" },
  { ip: "192.168.1.101", name: "LINUX-101",os: "Ubuntu 22", services: ["ssh(22)"],    risk: "none", type: "server",   x: 90, y: 180, evidence: "SSH banner: OpenSSH 8.9" },
  { ip: "192.168.1.103", name: "WIN-103",  os: "Win10",    services: ["smb(445)"],   risk: "low",  riskNote: "SMBv1 启用；本地用户 wangwei 有活跃会话", type: "server", x: 170, y: 290, evidence: "SMBv1 enabled；本地用户 wangwei 活跃会话" },
  { ip: "192.168.1.104", name: "WIN-104",  os: "Win10",    services: ["rdp(3389)"],  risk: "none", type: "server",   x: 280, y: 300, evidence: "RDP NLA 开启" },
  { ip: "192.168.1.105", name: "WIN-105",  os: "Win Server 2012", services: ["smb(445)", "ms17-010"], risk: "high", riskNote: "MS17-010 (EternalBlue) 可被利用", type: "server", x: 290, y: 390, evidence: "445 开放；MS17-010 漏洞指纹命中；SMBv1 未禁用" },
  { ip: "192.168.1.106", name: "WEB-106",  os: "Debian 12", services: ["http(80)", "https(443)"], risk: "none", type: "server", x: 150, y: 400, evidence: "Nginx 1.24" },
  { ip: "192.168.1.107", name: "DB-107",   os: "Debian 12", services: ["mysql(3306)"], risk: "low", riskNote: "MySQL 弱口令 admin/admin123", type: "server", x: 90, y: 480, evidence: "MySQL 5.7；默认账户可登录" },
  { ip: "192.168.1.108", name: "LINUX-108",os: "CentOS 7",  services: ["ssh(22)"],   risk: "high", riskNote: "SSH 弱口令 root/123456", type: "server", x: 490, y: 400, evidence: "SSH 爆破日志：root 被尝试 47 次；弱口令命中" },
  { ip: "192.168.1.109", name: "PLC-109",  os: "SCADA",    services: ["modbus(502)"], risk: "none", type: "industrial", x: 80, y: 300, evidence: "Modbus 协议单元 ID 1" },
  { ip: "192.168.1.110", name: "PRT-110",  os: "PrinterOS", services: ["ipp(631)"],  risk: "none", type: "printer", x: 70, y: 90, evidence: "IPP 响应正常" },
  { ip: "192.168.1.111", name: "CAM-111",  os: "Firmware", services: ["rtsp(554)"],  risk: "none", type: "camera",   x: 430, y: 230, evidence: "RTSP 未加密；默认凭据 admin/admin" },
];

// 连线：type 实线=物理邻居(LLDP)，dashed=推测可达，flow=通信关系(流动线)
export interface Link {
  from: string;
  to: string;
  type: "lldp" | "probable" | "flow";
  evidence: string;
}

export const MOCK_LINKS: Link[] = [
  // 物理邻居（接在交换机 112 下）
  ...["101", "103", "104", "105", "106", "107", "108", "109", "110", "111"].map((n) => ({
    from: "192.168.1.112", to: `192.168.1.${n}`, type: "lldp" as const,
    evidence: `LLDP 邻居：SW-01 port 0/${parseInt(n) - 100}`,
  })),
  { from: "192.168.1.1", to: "192.168.1.112", type: "lldp", evidence: "LLDP 邻居：GW-01 port 0/24" },
  // 推测可达
  { from: "192.168.1.103", to: "192.168.1.105", type: "probable", evidence: "历史会话记录推测 103→105 可达（SMB）" },
  { from: "192.168.1.105", to: "192.168.1.108", type: "probable", evidence: "漏洞利用后推测 105→108 可达（SSH）" },
  // 通信关系（攻击流量）
  { from: "192.168.1.103", to: "192.168.1.105", type: "flow", evidence: "攻击流量：SMB 爆破 47 次（源 103 → 目标 105:445，02:12:48）" },
  { from: "192.168.1.105", to: "192.168.1.108", type: "flow", evidence: "横向移动：SSH 登录尝试 12 次（源 105 → 目标 108:22，02:14:20）" },
  { from: "192.168.1.108", to: "192.168.1.1", type: "flow", evidence: "蜜点回连：SSH 诱饵记录回连目标 1.1（外联探测，02:14:58）" },
];

// ================= 蜜点模板与部署可行性 =================

export type HoneypotType = "SSH" | "SQL" | "WEB" | "SMB";

export const HONEYPOT_TEMPLATES: Record<HoneypotType, {
  color: string; badge: string; port: number; altPort: number; display: string; description: string;
  conflictServicePrefix: string; // 与诱饵端口冲突的真实服务前缀
}> = {
  SSH: { color: "#22d3ee", badge: "SSH", port: 22, altPort: 2222, display: "SSH 诱饵", description: "模拟 SSH 服务，记录爆破行为与回连地址", conflictServicePrefix: "ssh" },
  SQL: { color: "#f59e0b", badge: "SQL", port: 3306, altPort: 13306, display: "SQL 诱饵", description: "模拟 MySQL 服务，捕获注入与拖库尝试", conflictServicePrefix: "mysql" },
  WEB: { color: "#a78bfa", badge: "WEB", port: 80, altPort: 8080, display: "Web 仿冒", description: "仿冒业务站点，记录访问与凭据输入", conflictServicePrefix: "http" },
  SMB: { color: "#34d399", badge: "SMB", port: 445, altPort: 1445, display: "SMB 诱饵", description: "模拟 SMB 共享，捕获口令爆破与扫描", conflictServicePrefix: "smb" },
};

// 封闭/资源受限设备：无法运行诱饵 Agent
const UNSUPPORTED_TYPES: AssetType[] = ["industrial", "printer", "camera", "chip"];
const UNSUPPORTED_REASON: Record<string, string> = {
  industrial: "工控设备（PLC/Modbus）为封闭实时系统，不支持部署诱饵 Agent",
  printer: "打印机为资源受限嵌入式设备，不支持部署诱饵 Agent",
  camera: "摄像头为资源受限固件设备，不支持部署诱饵 Agent",
  chip: "交换机为网络基础设施，仅转发流量，不支持部署诱饵 Agent",
};

export type DeploySupport = "recommended" | "compatible" | "unsupported";

export interface DeployOption {
  type: HoneypotType;
  support: DeploySupport;
  reason: string;
  port: number;        // 预检后实际使用端口
  conflict: boolean;   // 是否发生端口冲突并改了备用端口
}

/** 该主机是否允许部署任何蜜点 */
export function isHostSupported(asset: Asset): boolean {
  return !UNSUPPORTED_TYPES.includes(asset.type);
}

export function unsupportedReason(asset: Asset): string {
  return UNSUPPORTED_REASON[asset.type] ?? "该设备不支持部署蜜点";
}

/** 主机是否运行与诱饵同类型的真实服务（端口冲突 / 匹配依据） */
function hasService(asset: Asset, type: HoneypotType): boolean {
  return asset.services.some((s) => {
    if (type === "WEB") return s.startsWith("http") || s.startsWith("web");
    return s.startsWith(HONEYPOT_TEMPLATES[type].conflictServicePrefix);
  });
}

/** 模板与主机暴露面是否匹配（推荐依据） */
function templateMatches(asset: Asset, type: HoneypotType): boolean {
  if (hasService(asset, type)) return true;
  // 剧本设定：105（MS17-010 高危）优先投放 SSH 诱饵，捕获横向移动与回连
  if (type === "SSH" && asset.ip === "192.168.1.105") return true;
  return false;
}

/** 评估在某主机上部署某类蜜点的可行性与预检结果 */
export function evaluateDeploy(asset: Asset, type: HoneypotType): DeployOption {
  const tpl = HONEYPOT_TEMPLATES[type];

  // 网关（路由设备）：仅支持 Web 仿冒
  if (asset.type === "monitor") {
    if (type === "WEB") {
      const conflict = hasService(asset, "WEB");
      return {
        type, support: "recommended",
        port: conflict ? tpl.altPort : tpl.port, conflict,
        reason: conflict
          ? `网关管理面占用 80/443，Web 仿冒自动改用备用端口 ${tpl.altPort}`
          : "网关入口位置适合投放 Web 仿冒，捕获凭据输入",
      };
    }
    return { type, support: "unsupported", port: tpl.port, conflict: false, reason: "路由设备仅支持 Web 仿冒诱饵" };
  }

  // 资源受限设备
  if (!isHostSupported(asset)) {
    return { type, support: "unsupported", port: tpl.port, conflict: false, reason: unsupportedReason(asset) };
  }

  // 通用服务器
  const conflict = hasService(asset, type);
  const matched = templateMatches(asset, type);
  let reason: string;
  if (matched && conflict) {
    reason = `主机已有真实 ${tpl.badge} 服务占用 ${tpl.port}，诱饵改用备用端口 ${tpl.altPort}，仿真度高`;
  } else if (matched) {
    reason = "与主机暴露面高度匹配，诱捕成功率高";
  } else {
    reason = "可部署，但与该主机现有业务关联较弱，诱捕效果一般";
  }
  return { type, support: matched ? "recommended" : "compatible", port: conflict ? tpl.altPort : tpl.port, conflict, reason };
}

/** 主机默认推荐的蜜点类型（无则 null，表示只能自选兼容类型） */
export function recommendedType(asset: Asset): HoneypotType | null {
  if (asset.type === "monitor") return "WEB";
  if (!isHostSupported(asset)) return null;
  const order: HoneypotType[] = ["SSH", "SMB", "WEB", "SQL"];
  for (const t of order) if (templateMatches(asset, t)) return t;
  return null;
}

/** Agent 自主决策的推荐部署清单（体检后） */
export const DEPLOY_RECOMMENDATIONS: { ip: string; type: HoneypotType; reason: string }[] = [
  { ip: "192.168.1.105", type: "SSH", reason: "MS17-010 高危节点，SSH 诱饵可捕获横向移动与回连" },
  { ip: "192.168.1.1", type: "WEB", reason: "网关开放 Web 管理面，Web 仿冒捕获凭据输入" },
];

// ================= 体检阶段 =================

export const SCAN_PHASES = ["主机发现", "端口扫描", "服务识别", "漏洞检测", "拓扑生成"];

// ================= 归因分析 =================

export interface TraceLayer {
  layer: number;
  title: string;
  entity: string;
  ip?: string;          // 关联资产 IP（可点击跳拓扑）
  detail: string;
  evidenceType: "observed" | "inferred";
  attck: string[];      // ATT&CK 编号
}

export const MOCK_ALERT = {
  id: "ALERT-2026-0919-001",
  time: "2026-09-19 02:14:33",
  shortTime: "02:14:33",
  decoyIp: "192.168.1.108",
  decoyName: "LINUX-108",
  decoyType: "SSH" as HoneypotType,
  title: "SSH 诱饵被触发：弱口令爆破 + 回连探测",
  severity: "高危" as const,
  behavior: [
    "root / admin / operator 连续登录尝试 12 次",
    "命中弱口令 root/123456，进入诱饵会话",
    "会话内执行 whoami / ifconfig / history 侦察命令",
    "回连探测 192.168.1.1 网关（外联试探）",
  ],
  status: "已确认 · 待处置",
};

export const TRACE_LAYERS: TraceLayer[] = [
  { layer: 1, title: "蜜点事件", entity: "LINUX-108 · SSH 诱饵", ip: "192.168.1.108", detail: "02:14:33 触发：连续 SSH 登录尝试 12 次，命中弱口令 root/123456，随后回连探测 1.1 网关。", evidenceType: "observed", attck: ["T1110"] },
  { layer: 2, title: "攻击源", entity: "192.168.1.103 · WIN-103", ip: "192.168.1.103", detail: "源 IP 归属内网终端 WIN-103，判定为横向移动跳板（非外网入口）；本机检测到离职账号 wangwei 的活跃会话。", evidenceType: "observed", attck: ["T1110", "T1078"] },
  { layer: 3, title: "跳板终端", entity: "192.168.1.105 · WIN-105", ip: "192.168.1.105", detail: "02:13:51 被 MS17-010（EternalBlue）攻陷，作为中间跳板对 108 发起 SSH 爆破。", evidenceType: "inferred", attck: ["T1210"] },
  { layer: 4, title: "失陷账号 + 手法", entity: "wangwei（离职账号）", detail: "账号 wangwei 已于 30 天前离职但未禁用，凭证在 103 上被复用，完整攻击链：103 → 105 → 108。", evidenceType: "inferred", attck: ["T1078"] },
];

export interface TimelineEvent {
  time: string;
  text: string;
  kind: "observed" | "inferred";
  layer: number; // 归属溯源层（控制解锁）
}

export const TRACE_TIMELINE: TimelineEvent[] = [
  { time: "02:12:48", text: "103 → 105 SMB 爆破 47 次", kind: "observed", layer: 2 },
  { time: "02:13:51", text: "MS17-010 利用成功，105 被控", kind: "inferred", layer: 3 },
  { time: "02:14:20", text: "105 → 108 SSH 登录尝试 12 次", kind: "observed", layer: 3 },
  { time: "02:14:33", text: "108 SSH 诱饵触发，命中弱口令", kind: "observed", layer: 1 },
  { time: "02:14:58", text: "诱饵会话回连探测 1.1 网关", kind: "observed", layer: 1 },
  { time: "02:15:40", text: "账号 wangwei 复用痕迹（离职未禁用）", kind: "inferred", layer: 4 },
];

export const ATTACK_CHAIN = ["103 爆破 105 · T1110", "MS17-010 横向 108 · T1210", "108 诱饵告警 · T1078"];

export const MITRE_TECHNIQUES = [
  { id: "T1110", name: "暴力破解", tactic: "凭证访问", desc: "对 SMB / SSH 服务进行口令爆破", layer: 2 },
  { id: "T1210", name: "远程服务漏洞利用", tactic: "横向移动", desc: "利用 MS17-010（EternalBlue）攻陷 105", layer: 3 },
  { id: "T1078", name: "有效账号", tactic: "防御绕过", desc: "复用离职未禁用账号 wangwei 横向移动", layer: 4 },
];

// 风险因子（分值合计 = 置信度）
export const RISK_FACTORS = [
  { label: "失陷账号（wangwei 离职未禁用）", score: 26, color: "#ef4444" },
  { label: "MS17-010 漏洞利用成功", score: 24, color: "#f59e0b" },
  { label: "内网横向移动（105 → 108）", score: 22, color: "#a78bfa" },
  { label: "多源观测证据互相吻合", score: 15, color: "#34d399" },
];

export const AFFECTED_SCOPE = { hosts: 3, accounts: 1, decoys: 1 };

export const RESPONSE_ACTIONS = [
  { level: "P0", color: "#ef4444", text: "立即禁用离职账号 wangwei，排查其近 30 天登录记录" },
  { level: "P0", color: "#ef4444", text: "隔离 WIN-103 / WIN-105，保留内存与磁盘镜像" },
  { level: "P1", color: "#f59e0b", text: "修补 MS17-010 补丁，全网禁用 SMBv1" },
  { level: "P1", color: "#f59e0b", text: "全网核查 SSH 弱口令，强制密钥认证" },
  { level: "P2", color: "#34d399", text: "排查到网关 1.1 的回连探测，收敛外联策略" },
];

export const VERDICT = {
  confidence: 87,
  summary: "内部攻击者复用离职账号 wangwei，经 103 暴力破解 105（MS17-010 漏洞利用）后横向移动至 108，触发 SSH 蜜点告警并回连探测网关。定性为内部失陷账号滥用 + 漏洞利用的横向移动攻击链。",
};

// ================= 二期：告警队列 / Campaign / 实体库 =================

export type AlertSeverity = "critical" | "high" | "medium" | "low";
export type AlertStatus = "待研判" | "研判中" | "已闭环" | "误报";

export interface Alert {
  id: string;
  time: string;
  shortTime: string;
  decoyIp: string;
  decoyName: string;
  decoyType: HoneypotType;
  decoyPort: number;
  title: string;
  severity: AlertSeverity;
  behavior: string[];
  status: AlertStatus;
  campaignId: string; // "" 表示不归属任何 campaign
  confidence?: number;
  sourceIp: string;
  sourceLabel: string; // 内网段 / 外网模拟
}

export interface Campaign {
  id: string;
  name: string;
  severity: "critical" | "high" | "medium";
  status: "待研判" | "研判中" | "已闭环";
  description: string;
  alertIds: string[];
}

export interface Entity {
  type: "ip" | "account" | "ioc" | "ttp";
  value: string;
  label: string;
  isJumpHost?: boolean;
  historyCount: number;
  relatedAlertIds: string[];
}

/** 9 条告警，跨 14 天（2026-09-06 ~ 09-19）；首条与既有 MOCK_ALERT 同 ID，保持向后兼容 */
export const MOCK_ALERTS: Alert[] = [
  {
    id: "ALERT-2026-0919-001",
    time: "2026-09-19 02:14:33",
    shortTime: "02:14:33",
    decoyIp: "192.168.1.108",
    decoyName: "LINUX-108",
    decoyType: "SSH",
    decoyPort: 2222,
    title: "SSH 诱饵被触发：弱口令爆破 + 登录成功 + 回连探测",
    severity: "critical",
    behavior: [
      "root / admin / operator 连续登录尝试 12 次",
      "命中弱口令 root/123456，进入诱饵会话",
      "会话内执行 whoami / ifconfig / history 侦察命令",
      "回连探测 192.168.1.1 网关（外联试探）",
    ],
    status: "待研判",
    campaignId: "C-0919",
    confidence: 87,
    sourceIp: "192.168.1.105",
    sourceLabel: "内网段",
  },
  {
    id: "ALERT-2026-0919-002",
    time: "2026-09-19 02:13:02",
    shortTime: "02:13:02",
    decoyIp: "192.168.1.105",
    decoyName: "WIN-105",
    decoyType: "SMB",
    decoyPort: 445,
    title: "SMB 诱饵被触发：口令爆破 47 次",
    severity: "high",
    behavior: ["103 → 105:445 SMB 口令爆破 47 次", "命中多组常见弱口令但未落地"],
    status: "研判中",
    campaignId: "C-0919",
    sourceIp: "192.168.1.103",
    sourceLabel: "内网段",
  },
  {
    id: "ALERT-2026-0918-001",
    time: "2026-09-18 14:22:10",
    shortTime: "14:22:10",
    decoyIp: "192.168.1.107",
    decoyName: "DB-107",
    decoyType: "SQL",
    decoyPort: 13306,
    title: "SQL 诱饵被触发：服务账号非维护时段登录并触碰",
    severity: "high",
    behavior: ["svc_scan 在 14:22（非维护窗口）登录 107", "尝试查询 user / order 敏感表"],
    status: "研判中",
    campaignId: "C-0917",
    confidence: 62,
    sourceIp: "192.168.1.107",
    sourceLabel: "内网段",
  },
  {
    id: "ALERT-2026-0917-001",
    time: "2026-09-17 03:05:31",
    shortTime: "03:05:31",
    decoyIp: "192.168.1.107",
    decoyName: "DB-107",
    decoyType: "SQL",
    decoyPort: 13306,
    title: "SQL 诱饵被触发：弱口令尝试 + 查询敏感表",
    severity: "high",
    behavior: ["svc_scan 登录后尝试弱口令", "查询敏感表 user / order 后退出"],
    status: "待研判",
    campaignId: "C-0917",
    confidence: 62,
    sourceIp: "192.168.1.107",
    sourceLabel: "内网段",
  },
  {
    id: "ALERT-2026-0915-001",
    time: "2026-09-15 09:30:42",
    shortTime: "09:30:42",
    decoyIp: "192.168.1.1",
    decoyName: "GW-01",
    decoyType: "WEB",
    decoyPort: 8080,
    title: "Web 仿冒被触发：外网目录扫描 + 弱口令尝试",
    severity: "medium",
    behavior: ["外网 IP 扫描 /admin /login /phpMyAdmin", "弱口令尝试 6 组，未获成功登录"],
    status: "已闭环",
    campaignId: "C-0912",
    confidence: 71,
    sourceIp: "203.0.113.45",
    sourceLabel: "外网模拟",
  },
  {
    id: "ALERT-2026-0914-001",
    time: "2026-09-14 11:20:05",
    shortTime: "11:20:05",
    decoyIp: "192.168.1.1",
    decoyName: "GW-01",
    decoyType: "WEB",
    decoyPort: 8080,
    title: "Web 仿冒被触发：路径遍历探测",
    severity: "medium",
    behavior: ["外网 IP 尝试 ../../../etc/passwd 路径遍历", "未成功，连接断开"],
    status: "已闭环",
    campaignId: "C-0912",
    sourceIp: "203.0.113.45",
    sourceLabel: "外网模拟",
  },
  {
    id: "ALERT-2026-0912-001",
    time: "2026-09-12 21:04:55",
    shortTime: "21:04:55",
    decoyIp: "192.168.1.108",
    decoyName: "LINUX-108",
    decoyType: "SSH",
    decoyPort: 2222,
    title: "SSH 诱饵前期部署触发测试",
    severity: "low",
    behavior: ["部署完成后连通性自测登录 1 次"],
    status: "已闭环",
    campaignId: "",
    sourceIp: "192.168.1.103",
    sourceLabel: "内网段",
  },
  {
    id: "ALERT-2026-0910-001",
    time: "2026-09-10 16:45:18",
    shortTime: "16:45:18",
    decoyIp: "192.168.1.1",
    decoyName: "GW-01",
    decoyType: "WEB",
    decoyPort: 8080,
    title: "Web 仿冒被触发：外网扫描探测",
    severity: "medium",
    behavior: ["外网 IP 对网关 8080 端口进行端口与目录扫描"],
    status: "已闭环",
    campaignId: "C-0912",
    sourceIp: "203.0.113.45",
    sourceLabel: "外网模拟",
  },
  {
    id: "ALERT-2026-0906-001",
    time: "2026-09-06 08:12:40",
    shortTime: "08:12:40",
    decoyIp: "192.168.1.103",
    decoyName: "WIN-103",
    decoyType: "SMB",
    decoyPort: 445,
    title: "SMB 扫描探测（已判定误报）",
    severity: "low",
    behavior: ["运维巡检工具对 103:445 做端口探测"],
    status: "误报",
    campaignId: "",
    sourceIp: "192.168.1.103",
    sourceLabel: "内网段",
  },
];

export const MOCK_CAMPAIGNS: Campaign[] = [
  {
    id: "C-0919",
    name: "内部横向移动",
    severity: "critical",
    status: "待研判",
    description: "103 复用离职账号 wangwei → 爆破 105（T1110）→ MS17-010 横向 108（T1210）→ 触发 SSH 诱饵 → 回连探测网关",
    alertIds: ["ALERT-2026-0919-001", "ALERT-2026-0919-002"],
  },
  {
    id: "C-0912",
    name: "外网扫描试探",
    severity: "medium",
    status: "已闭环",
    description: "外网模拟 IP（203.0.113.45）对网关 Web 仿冒进行目录扫描与弱口令尝试，未突破内网边界",
    alertIds: ["ALERT-2026-0915-001", "ALERT-2026-0914-001", "ALERT-2026-0910-001"],
  },
  {
    id: "C-0917",
    name: "服务账号可疑行为",
    severity: "high",
    status: "研判中",
    description: "svc_scan 服务账号在非维护时段登录 107 并触碰 SQL 诱饵，证据稀疏，行为推断占比高",
    alertIds: ["ALERT-2026-0918-001", "ALERT-2026-0917-001"],
  },
];

export const MOCK_ENTITIES: Entity[] = [
  { type: "ip", value: "192.168.1.103", label: "WIN-103（横向移动跳板）", isJumpHost: true, historyCount: 2, relatedAlertIds: ["ALERT-2026-0919-001", "ALERT-2026-0919-002"] },
  { type: "ip", value: "203.0.113.45", label: "外网模拟扫描源", historyCount: 3, relatedAlertIds: ["ALERT-2026-0915-001", "ALERT-2026-0914-001", "ALERT-2026-0910-001"] },
  { type: "ip", value: "192.168.1.107", label: "DB-107（服务账号登录源）", historyCount: 2, relatedAlertIds: ["ALERT-2026-0918-001", "ALERT-2026-0917-001"] },
  { type: "account", value: "wangwei", label: "离职账号（最后合法登录 08-20）", historyCount: 2, relatedAlertIds: ["ALERT-2026-0919-001", "ALERT-2026-0919-002"] },
  { type: "account", value: "svc_scan", label: "服务账号（维护窗口 02:00-04:00）", historyCount: 2, relatedAlertIds: ["ALERT-2026-0918-001", "ALERT-2026-0917-001"] },
  { type: "account", value: "root", label: "108 弱口令命中账号", historyCount: 1, relatedAlertIds: ["ALERT-2026-0919-001"] },
  { type: "ioc", value: "a1b2c3d4e5f6", label: "可疑文件哈希（回连脚本）", historyCount: 1, relatedAlertIds: ["ALERT-2026-0919-001"] },
  { type: "ioc", value: "Nmap Scripting Engine", label: "User-Agent：Nmap 扫描指纹", historyCount: 3, relatedAlertIds: ["ALERT-2026-0915-001", "ALERT-2026-0914-001", "ALERT-2026-0910-001"] },
  { type: "ioc", value: "evil-c2.example.com", label: "回连域名（外联探测目标）", historyCount: 1, relatedAlertIds: ["ALERT-2026-0919-001"] },
  { type: "ttp", value: "T1110", label: "暴力破解", historyCount: 3, relatedAlertIds: ["ALERT-2026-0919-001", "ALERT-2026-0919-002", "ALERT-2026-0915-001"] },
  { type: "ttp", value: "T1210", label: "远程服务漏洞利用（MS17-010）", historyCount: 1, relatedAlertIds: ["ALERT-2026-0919-001"] },
  { type: "ttp", value: "T1078", label: "有效账号（离职/服务账号滥用）", historyCount: 3, relatedAlertIds: ["ALERT-2026-0919-001", "ALERT-2026-0918-001", "ALERT-2026-0917-001"] },
  { type: "ttp", value: "T1046", label: "网络服务扫描", historyCount: 3, relatedAlertIds: ["ALERT-2026-0915-001", "ALERT-2026-0914-001", "ALERT-2026-0910-001"] },
  { type: "ttp", value: "T1190", label: "面向公开应用的利用尝试", historyCount: 1, relatedAlertIds: ["ALERT-2026-0915-001"] },
];

// ================= 二期：审批状态类型（前端 HITL 用） =================

// "direct" = 无端口冲突时使用标准端口直挂（见 ApprovalCard.buildOptions 与 route.ts 的 strategy 枚举）
export type ApprovalStrategy = "direct" | "alt-port" | "stop-service" | "reverse-proxy" | "other-node";

export interface ApprovalOption {
  id: ApprovalStrategy;
  label: string;
  pros: string;
  cons: string;
  impact: "低" | "中" | "高";
  recommended?: boolean;
  port?: number;
  targetIp?: string;
}

export interface ApprovalState {
  id: string;
  mode: "deploy" | "remove";
  ip: string;
  type: HoneypotType;
  conflict?: { port: number; process: string; pid: number };
  options: ApprovalOption[];
  selectedIndex: number;
  status: "waiting" | "approved" | "rejected";
  toolCallId?: string;
}

// ================= 二期：traceAttack 按 alertId 返回不同数据 =================

export interface MitreTechnique { id: string; name: string; tactic: string; desc: string; layer: number; }
export interface RiskFactor { label: string; score: number; color: string; }
export interface ResponseAction { level: string; color: string; text: string; }

export interface TraceData {
  alert: Alert;
  layers: TraceLayer[];
  timeline: TimelineEvent[];
  chain: string[];
  mitre: MitreTechnique[];
  riskFactors: RiskFactor[];
  affected: { hosts: number; accounts: number; decoys: number };
  responses: ResponseAction[];
  verdict: { confidence: number; summary: string };
}

/** C-0917 服务账号可疑行为：3 层，置信度 62%，行为推断占比高 */
const TRACE_0917: TraceData = {
  alert: MOCK_ALERTS[3],
  layers: [
    { layer: 1, title: "蜜点事件", entity: "DB-107 · SQL 诱饵", ip: "192.168.1.107", detail: "03:05 svc_scan 登录后尝试弱口令，并查询 user / order 敏感表，被 SQL 诱饵捕获。", evidenceType: "observed", attck: ["T1110", "T1078"] },
    { layer: 2, title: "失陷账号", entity: "svc_scan（服务账号）", detail: "该账号维护窗口为 02:00-04:00，本次登录伴随异常敏感表读取；凭据疑似被复用。", evidenceType: "inferred", attck: ["T1078"] },
    { layer: 3, title: "行为推断", entity: "凭据泄露 / 横向移动（推断）", detail: "缺少落地文件与外联证据，仅凭登录与查询行为推断为服务账号凭据泄露，置信度偏低。", evidenceType: "inferred", attck: ["T1078", "T1046"] },
  ],
  timeline: [
    { time: "03:05:12", text: "svc_scan 登录 107 MySQL", kind: "observed", layer: 2 },
    { time: "03:05:31", text: "查询敏感表 user / order", kind: "observed", layer: 1 },
    { time: "03:06:10", text: "退出会话，无落地文件（推断）", kind: "inferred", layer: 3 },
  ],
  chain: ["svc_scan 异常登录 107 · T1078", "触碰 SQL 诱饵 · T1110", "凭据泄露推断 · T1078"],
  mitre: [
    { id: "T1078", name: "有效账号", tactic: "防御绕过", desc: "服务账号 svc_scan 凭据疑似被复用", layer: 2 },
    { id: "T1110", name: "暴力破解", tactic: "凭证访问", desc: "登录后尝试弱口令查询敏感表", layer: 1 },
  ],
  riskFactors: [
    { label: "服务账号异常表读取行为", score: 22, color: "#ef4444" },
    { label: "登录时间偏离正常维护基线", score: 18, color: "#f59e0b" },
    { label: "凭据复用痕迹（推断）", score: 14, color: "#a78bfa" },
    { label: "交叉印证证据有限", score: 8, color: "#34d399" },
  ],
  affected: { hosts: 1, accounts: 1, decoys: 1 },
  responses: [
    { level: "P0", color: "#ef4444", text: "核查 svc_scan 近 30 天登录与查询记录" },
    { level: "P1", color: "#f59e0b", text: "轮换服务账号凭据并锁定维护窗口外访问" },
    { level: "P2", color: "#34d399", text: "收敛 SQL 诱饵敏感表查询并持续监测" },
  ],
  verdict: {
    confidence: 62,
    summary: "svc_scan 服务账号在非维护时段登录 107 并触碰 SQL 诱饵，证据稀疏、以行为推断为主，疑似服务账号凭据泄露，暂定性为可疑服务账号滥用，置信度 62%。",
  },
};

/** C-0912 外网扫描试探（已闭环）：2 层，置信度 71%，简单扫描告警 */
const TRACE_0915: TraceData = {
  alert: MOCK_ALERTS[4],
  layers: [
    { layer: 1, title: "蜜点事件", entity: "GW-01 · Web 仿冒", ip: "192.168.1.1", detail: "09:30 外网 IP 对网关 Web 仿冒发起目录扫描与弱口令尝试，未获成功登录。", evidenceType: "observed", attck: ["T1046", "T1110"] },
    { layer: 2, title: "攻击源", entity: "203.0.113.45（外网模拟）", detail: "User-Agent 命中 Nmap 脚本引擎指纹，历史 3 次同类扫描，未突破内网边界。", evidenceType: "observed", attck: ["T1046", "T1190"] },
  ],
  timeline: [
    { time: "09:30:08", text: "外网 IP 请求 /admin /login /phpMyAdmin", kind: "observed", layer: 1 },
    { time: "09:30:42", text: "弱口令尝试 6 组，未成功", kind: "observed", layer: 1 },
    { time: "09:31:15", text: "连接断开，未落地", kind: "observed", layer: 2 },
  ],
  chain: ["外网目录扫描 · T1046", "弱口令尝试 · T1110", "未突破边界"],
  mitre: [
    { id: "T1046", name: "网络服务扫描", tactic: "侦察", desc: "外网 IP 自动化目录与端口扫描", layer: 1 },
    { id: "T1110", name: "暴力破解", tactic: "凭证访问", desc: "对 Web 登录页尝试弱口令", layer: 1 },
  ],
  riskFactors: [
    { label: "外网 IP 直接触达 Web 诱饵", score: 26, color: "#ef4444" },
    { label: "自动化扫描 + 弱口令特征", score: 24, color: "#f59e0b" },
    { label: "历史同源重复出现", score: 13, color: "#a78bfa" },
    { label: "未获成功登录、未落地", score: 8, color: "#34d399" },
  ],
  affected: { hosts: 1, accounts: 0, decoys: 1 },
  responses: [
    { level: "P1", color: "#f59e0b", text: "收敛网关 Web 仿冒对外暴露面并限速" },
    { level: "P2", color: "#34d399", text: "将 203.0.113.45 加入黑名单并持续监测" },
  ],
  verdict: {
    confidence: 71,
    summary: "外网模拟 IP 对网关 Web 仿冒进行目录扫描与弱口令尝试，自动化特征明显，未突破内网边界，已闭环，置信度 71%。",
  },
};

/** 主告警 C-0919（4 层 / 87%）：由既有常量组装，保持向后兼容 */
const DEFAULT_TRACE: TraceData = {
  alert: MOCK_ALERTS[0],
  layers: TRACE_LAYERS,
  timeline: TRACE_TIMELINE,
  chain: ATTACK_CHAIN,
  mitre: MITRE_TECHNIQUES,
  riskFactors: RISK_FACTORS,
  affected: AFFECTED_SCOPE,
  responses: RESPONSE_ACTIONS,
  verdict: VERDICT,
};

/** 无 campaign 的噪声类告警（误报 / 部署自测）：2 层良性溯源样本 */
function noiseTrace(alert: Alert, kind: "false-positive" | "self-test"): TraceData {
  const falsePositive = kind === "false-positive";
  return {
    alert,
    layers: [
      {
        layer: 1,
        title: "蜜点事件",
        entity: `${alert.decoyName} · ${alert.decoyType} 诱饵`,
        ip: alert.decoyIp,
        detail: falsePositive
          ? `${alert.shortTime} 运维巡检工具对 ${alert.decoyIp}:${alert.decoyPort} 发起计划内端口探测，来源为运维终端本机，无口令尝试与会话建立。`
          : `${alert.shortTime} 诱饵部署完成后执行 1 次连通性自测登录，来源为内部运维网段白名单地址。`,
        evidenceType: "observed",
        attck: ["T1046"],
      },
      {
        layer: 2,
        title: "研判结论",
        entity: falsePositive ? "计划内运维巡检（白名单）" : "部署自测（白名单）",
        detail: falsePositive
          ? "探测时间与每周巡检计划任务完全吻合，来源账号为登记在案的运维账号，无横向移动、无回连、无凭据使用，判定为误报。"
          : "自测来源、时间窗口均在部署变更单内，无后续攻击行为，判定为良性自测事件并闭环。",
        evidenceType: "observed",
        attck: [],
      },
    ],
    timeline: [
      { time: alert.shortTime, text: alert.behavior[0] ?? "诱饵产生单次连接", kind: "observed", layer: 1 },
      { time: alert.shortTime, text: falsePositive ? "比对巡检计划任务，时间吻合" : "比对部署变更单，来源在白名单", kind: "inferred", layer: 2 },
      { time: alert.shortTime, text: falsePositive ? "判定误报，闭环" : "判定良性自测，闭环", kind: "observed", layer: 2 },
    ],
    chain: falsePositive ? ["巡检端口探测 · T1046", "白名单来源", "判定误报"] : ["部署连通性自测", "白名单来源", "判定良性事件"],
    mitre: [
      { id: "T1046", name: "网络服务扫描", tactic: "侦察（良性）", desc: falsePositive ? "计划内运维巡检探测，非攻击行为" : "部署自测连通性检查", layer: 1 },
    ],
    riskFactors: [
      { label: "与计划任务/变更单时间吻合", score: falsePositive ? 12 : 10, color: "#34d399" },
      { label: "来源为登记白名单账号/地址", score: 8, color: "#34d399" },
      { label: "无横向、回连等攻击后续行为", score: 5, color: "#22d3ee" },
    ],
    affected: { hosts: 1, accounts: 0, decoys: 1 },
    responses: [
      { level: "P2", color: "#34d399", text: falsePositive ? "将巡检来源加入告警白名单，减少重复噪声" : "保留诱饵，持续采集真实攻击行为" },
      { level: "P3", color: "#22d3ee", text: "纳入噪声基线，定期复核白名单有效性" },
    ],
    verdict: {
      confidence: falsePositive ? 25 : 18,
      summary: falsePositive
        ? "该事件为运维巡检计划任务触发的良性探测，来源、时间、行为均与白名单吻合，无攻击特征，判定为误报，置信度 25%。"
        : "该事件为诱饵部署后的连通性自测，来源在运维白名单内，无攻击特征，判定为良性事件，置信度 18%。",
    },
  };
}

/** campaign → 对应溯源样本（图为 campaign 级，告警头按实际 ID 覆盖） */
function baseTraceForCampaign(campaignId: string): TraceData {
  if (campaignId === "C-0917") return TRACE_0917;
  if (campaignId === "C-0912") return TRACE_0915;
  return DEFAULT_TRACE;
}

/**
 * 按 alertId 返回溯源数据：
 * - 三个主样本（0919-001 / 0917-001 / 0915-001）返回各自完整数据；
 * - 同 campaign 的其他告警复用该 campaign 图谱，仅覆盖告警头；
 * - 无 campaign 的误报/自测告警返回 2 层良性样本；
 * - 未知 ID 默认返回 C-0919 主样本（4 层）。
 */
export function getTraceData(alertId: string): TraceData {
  if (alertId === "ALERT-2026-0917-001") return TRACE_0917;
  if (alertId === "ALERT-2026-0915-001") return TRACE_0915;
  if (alertId === "ALERT-2026-0919-001") return DEFAULT_TRACE;
  const alert = MOCK_ALERTS.find((a) => a.id === alertId);
  if (!alert) return DEFAULT_TRACE;
  if (alert.campaignId === "") {
    return noiseTrace(alert, alert.status === "误报" ? "false-positive" : "self-test");
  }
  return { ...baseTraceForCampaign(alert.campaignId), alert };
}

/** 按 ID 取告警 */
export function alertById(id: string | null | undefined): Alert | undefined {
  if (!id) return undefined;
  return MOCK_ALERTS.find((a) => a.id === id);
}

/**
 * 待研判/研判中队列（时间倒序）的「下一条」：
 * 从 afterId 之后循环取下一条，用于「分析下一条待研判告警」。
 */
export function nextPendingAlert(afterId?: string | null): Alert | null {
  const open = MOCK_ALERTS.filter((a) => a.status === "待研判" || a.status === "研判中")
    .slice()
    .sort((x, y) => (x.time < y.time ? 1 : -1));
  if (open.length === 0) return null;
  if (!afterId) return open[0];
  const idx = open.findIndex((a) => a.id === afterId);
  if (idx < 0) return open[0];
  return open[(idx + 1) % open.length];
}

/** 溯源完成后的一句话中文结论（供脚本引擎收尾，保证多告警口径一致） */
export function traceBrief(alertId: string): string {
  const d = getTraceData(alertId);
  const short = d.alert.id.split("-").slice(-2).join("-");
  return `溯源完成（${short} · 置信度 ${d.verdict.confidence}%）：${d.verdict.summary}`;
}

// ================= 二期：部署规则 / 迷你列表 / 14 天趋势 =================

/** 每个节点最多运行的诱饵数量（异类型可共存，同类型幂等） */
export const MAX_DEPLOYMENTS_PER_NODE = 3;

/** 最近 N 条待研判/研判中告警（按时间倒序），供右栏迷你列表与默认归因对象 */
export function getRecentAlerts(limit = 3): Alert[] {
  return MOCK_ALERTS.filter((a) => a.status === "待研判" || a.status === "研判中")
    .slice()
    .sort((x, y) => (x.time < y.time ? 1 : -1))
    .slice(0, limit);
}

/** 近 14 天告警趋势（右栏迷你趋势图） */
export const ALERT_TREND_14D: { date: string; count: number; critical: number }[] = [
  { date: "09-06", count: 1, critical: 0 },
  { date: "09-07", count: 0, critical: 0 },
  { date: "09-08", count: 0, critical: 0 },
  { date: "09-09", count: 0, critical: 0 },
  { date: "09-10", count: 1, critical: 0 },
  { date: "09-11", count: 0, critical: 0 },
  { date: "09-12", count: 1, critical: 0 },
  { date: "09-13", count: 0, critical: 0 },
  { date: "09-14", count: 1, critical: 0 },
  { date: "09-15", count: 1, critical: 0 },
  { date: "09-16", count: 0, critical: 0 },
  { date: "09-17", count: 1, critical: 0 },
  { date: "09-18", count: 1, critical: 0 },
  { date: "09-19", count: 2, critical: 1 },
];
