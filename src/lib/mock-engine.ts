// 确定性脚本引擎（Mock LLM）
// 通过自定义 fetch 拦截 OpenAI 兼容的 /chat/completions 请求，
// 按用户意图返回脚本化的 SSE（短中文 + 工具调用），保证演示在离线环境下
// 也能 100% 复现；选择 DeepSeek 引擎时请求原样转发到真实接口。

import {
  MOCK_ASSETS,
  MOCK_ALERT,
  MOCK_ALERTS,
  MOCK_CAMPAIGNS,
  MOCK_ENTITIES,
  HONEYPOT_TEMPLATES,
  DEPLOY_RECOMMENDATIONS,
  evaluateDeploy,
  recommendedType,
  getRecentAlerts,
  nextPendingAlert,
  traceBrief,
} from "./mock-data";
import type { HoneypotType } from "./mock-data";

export type Engine = "mock" | "deepseek";
let engine: Engine = "mock";
export function setEngine(e: Engine) {
  engine = e;
}

/** 最近一次溯源/画图所针对的告警（脚本内状态，用于「下一条」轮询） */
let lastTracedAlertId: string | null = null;

/** 本次会话已勾选自动批准的诱饵类型（由 route.ts 从 x-auto-approve header 同步） */
let autoApproveTypes: HoneypotType[] = [];
export function setAutoApproveTypes(types: HoneypotType[]) {
  autoApproveTypes = Array.from(new Set(types));
}

// ---------------- OpenAI 消息类型（按需最小化） ----------------
interface OAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null | Array<{ type: string; text?: string }>;
  tool_calls?: OAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

type Plan =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; args: Record<string, unknown>; pre: string };

// ---------------- 意图解析工具 ----------------
function textContent(c: OAIMessage["content"]): string {
  if (!c) return "";
  if (typeof c === "string") return c;
  return c.map((p) => p.text ?? "").join("");
}

function parseIp(text: string): string | null {
  const full = text.match(/192\.168\.1\.(\d{1,3})/);
  if (full) {
    const ip = `192.168.1.${full[1]}`;
    if (MOCK_ASSETS.some((a) => a.ip === ip)) return ip;
  }
  if (/网关|gateway|GW-?01|路由/i.test(text)) return "192.168.1.1";
  const tail = text.match(/(?<!\d)(10[1-9]|11[0-2])(?!\d)/);
  if (tail) {
    const ip = `192.168.1.${tail[1]}`;
    if (MOCK_ASSETS.some((a) => a.ip === ip)) return ip;
  }
  return null;
}

function parseType(text: string): HoneypotType | null {
  if (/ssh|shell/i.test(text)) return "SSH";
  if (/sql|mysql|数据库/i.test(text)) return "SQL";
  if (/web|网站|网页|仿冒|网关|http/i.test(text)) return "WEB";
  if (/smb|共享|ms17|永恒之蓝/i.test(text)) return "SMB";
  return null;
}

function assetByIp(ip: string) {
  return MOCK_ASSETS.find((a) => a.ip === ip);
}

/** 从文本中提取告警 ID（ALERT-YYYY-MMDD-NNN，日期段为 4 位 MMDD） */
function parseAlertId(text: string): string | null {
  const m = text.match(/ALERT-\d{4}-\d{4}-\d{3}/i);
  if (!m) return null;
  const id = m[0].toUpperCase();
  return MOCK_ALERTS.some((a) => a.id === id) ? id : null;
}

/** 从文本中提取 campaign ID（C-MMDD，4 位日期） */
function parseCampaignId(text: string): string | null {
  const m = text.match(/\bC-\d{4}\b/);
  if (!m) return null;
  return MOCK_CAMPAIGNS.some((c) => c.id === m[0]) ? m[0] : null;
}

/**
 * 解析本轮要溯源的告警 ID：
 * - 显式告警 ID 优先；
 * - 「下一条待研判」→ 相对 lastTraced 轮询；
 * - 「最近/最新」→ 待研判队列首条；
 * - 否则沿用上一条溯源告警，再缺省回退到最近待研判 / 主告警。
 */
function resolveTraceAlert(text: string): string {
  const explicit = parseAlertId(text);
  if (explicit) return explicit;
  if (/下一条|下一个|下条|继续分析/.test(text)) {
    const next = nextPendingAlert(lastTracedAlertId);
    if (next) return next.id;
  }
  if (/最近|最新|当前|这条|该|归因|溯源|攻击链/.test(text)) {
    return lastTracedAlertId ?? getRecentAlerts(1)[0]?.id ?? MOCK_ALERT.id;
  }
  return lastTracedAlertId ?? getRecentAlerts(1)[0]?.id ?? MOCK_ALERT.id;
}

/** 「分析关联事件 <value>」：实体 / campaign / 告警 → 目标告警 ID 或文字回复 */
function resolveRelatedEvent(value: string): { kind: "tool"; alertId: string } | { kind: "text"; text: string } {
  const alertId = parseAlertId(value);
  if (alertId) return { kind: "tool", alertId };

  const campaignId = parseCampaignId(value);
  if (campaignId) {
    const c = MOCK_CAMPAIGNS.find((x) => x.id === campaignId)!;
    const target = c.alertIds.find((id) => {
      const a = MOCK_ALERTS.find((x) => x.id === id);
      return a && (a.status === "待研判" || a.status === "研判中");
    }) ?? c.alertIds[0];
    return { kind: "tool", alertId: target };
  }

  // 实体值（IP / 账号 / IOC / TTP）
  const entity = MOCK_ENTITIES.find((e) => e.value === value.trim());
  if (entity && entity.relatedAlertIds.length > 0) {
    const target =
      entity.relatedAlertIds.find((id) => {
        const a = MOCK_ALERTS.find((x) => x.id === id);
        return a && (a.status === "待研判" || a.status === "研判中");
      }) ?? entity.relatedAlertIds[0];
    return { kind: "tool", alertId: target };
  }

  return {
    kind: "text",
    text: `未在实体库中检索到「${value}」关联的历史事件。可以换一个 IP、账号、IOC 或 ATT&CK 技术编号，或直接说「分析最近一条蜜点告警」。`,
  };
}

/** campaign 维度的文字小结 */
function campaignSummary(campaignId: string): string {
  const c = MOCK_CAMPAIGNS.find((x) => x.id === campaignId);
  if (!c) return "";
  const lines = c.alertIds.map((id) => {
    const a = MOCK_ALERTS.find((x) => x.id === id);
    return a ? `· ${a.shortTime} ${a.id}（${a.severity === "critical" ? "严重" : a.severity === "high" ? "高危" : "中低危"}/${a.status}）${a.title}` : "";
  });
  return `攻击活动 ${c.id}「${c.name}」（${c.status}）共关联 ${c.alertIds.length} 条告警：\n${lines.join("\n")}\n${c.description}`;
}

/** 从消息流中推断授权模式：page.tsx 会注入 "authMode:auto" 标记；缺省走逐次确认 */
/** 授权模式全局覆盖（由 route.ts syncEngine 从 x-auth-mode header 设置） */
let authModeOverride: "confirm" | "auto" | null = null;
export function setAuthMode(m: "confirm" | "auto") {
  authModeOverride = m;
}
function detectAuthMode(messages: OAIMessage[]): "confirm" | "auto" {
  if (authModeOverride) return authModeOverride;
  const blob = messages
    .map((m) => {
      let s = textContent(m.content);
      if (m.tool_calls) s += " " + m.tool_calls.map((c) => c.function.arguments).join(" ");
      return s;
    })
    .join("\n");
  if (/authMode[:\s=]*auto/i.test(blob)) return "auto";
  return "confirm";
}

/** 端口冲突时占用进程名（演示用） */
function conflictProcess(type: HoneypotType): string {
  const prefix = HONEYPOT_TEMPLATES[type].conflictServicePrefix;
  return prefix === "mysql" ? "mysqld" : `${prefix}d`;
}

// ---------------- 剧本话术 ----------------
const PRE_SCAN = "收到，开始对 192.168.1.0/24 执行内网体检，主机发现、端口扫描与漏洞检测同步进行，稍等。";
const PRE_DEPLOY = "好的，先做端口冲突预检，通过后立即投放诱饵。";
const PRE_TRACE = "收到，我从诱饵事件出发逐层回溯这条告警，直到定位失陷账号与攻击手法。";

const FINAL_SCAN =
  "内网体检完成：12 个资产全部在线，识别出 2 个高危节点——105 存在 MS17-010（永恒之蓝）漏洞、108 存在 SSH 弱口令。拓扑与报告已在下方生成，建议先对 105 投放诱饵，再对蜜点告警做归因分析。";

function assetQna(ip: string): string {
  const a = assetByIp(ip);
  if (!a) return `未在 192.168.1.0/24 的资产清单中找到 ${ip}，建议先执行一次内网体检。`;
  let s = `${a.name}（${a.ip}，${a.os}）开放服务：${a.services.join("、")}。`;
  if (a.risk === "high") s += `判定为高危：${a.riskNote}。建议优先处置并在该节点投放诱饵监测横向移动。`;
  else if (a.risk === "low") s += `存在低风险项：${a.riskNote}，建议纳入整改清单。`;
  else s += "暂未发现明显风险。";
  return s;
}

const RISK_LIST_REPLY =
  "当前网段共 2 个高危节点：105（MS17-010 永恒之蓝漏洞）、108（SSH 弱口令 root/123456）；另有 103（SMBv1 启用）、107（MySQL 弱口令）、112（SNMP 默认团体字）3 个低风险项。可以让我跑一次完整体检，生成实时拓扑与报告。";

const ATTACK_SOURCE_REPLY =
  "攻击源是内网终端 192.168.1.103（WIN-103），并非外网入口：攻击者在 103 上复用了离职账号 wangwei，02:12 起爆破 105，借 MS17-010 失陷后横向移动到 108 触发诱饵。对我说“分析最近一条蜜点告警”可查看完整四层溯源。";

const TICKET_REPLY =
  "已生成处置工单（演示）：① P0 立即禁用离职账号 wangwei，排查其近 30 天登录；② P0 隔离 WIN-103 / WIN-105 并保留内存镜像；③ P1 修补 MS17-010、全网禁用 SMBv1；④ P1 全网核查 SSH 弱口令并强制密钥认证；⑤ P2 排查到网关的回连探测并收敛外联。右侧面板可查看完整风险分析。";

const GUIDE_REPLY =
  "我是内网安全智能体 SYSTEMWIRE，能做三件事：① 内网体检——测绘资产、标记风险并生成拓扑；② 蜜点部署——按主机暴露面推荐并投放 SSH/SQL/WEB/SMB 诱饵；③ 归因分析——对蜜点告警做四层溯源、ATT&CK 映射与研判。点击输入框上方的推荐提示词即可开始。";

const GREETING_REPLY =
  "你好，我是内网安全智能体 SYSTEMWIRE。当前演示网段为 192.168.1.0/24，共 12 个资产，其中 108 已预置一枚 SSH 诱饵。可以对我说“对 192.168.1.0/24 做内网体检”，或点击输入框上方的推荐提示词开始。";

// ---------------- 规划（状态机） ----------------
export function plan(messages: OAIMessage[]): Plan {
  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUser = textContent(userMsgs[userMsgs.length - 1]?.content).trim();

  // 只看「最后一条用户消息之后」的工具往返——多轮对话中历史工具调用
  // 不能影响新一轮用户问题的路由（曾导致追问资产风险时错误回放扫描总结）
  let lastUserIdx = -1;
  messages.forEach((m, i) => { if (m.role === "user") lastUserIdx = i; });
  const turnTail = messages.slice(lastUserIdx + 1);

  const assistantToolCalls: OAIToolCall[] = turnTail
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.tool_calls ?? []);
  const toolResults = turnTail.filter((m) => m.role === "tool");

  // ---------- 工具执行后的第二轮：收尾文本 / 继续链式工具 ----------
  if (messages[messages.length - 1]?.role === "tool" && assistantToolCalls.length > 0) {
    const lastCall = assistantToolCalls[assistantToolCalls.length - 1];
    const lastName = lastCall.function.name;

    // ---------- 审批两阶段：识别 requestDeployApproval 的用户决定 ----------
    if (lastName === "requestDeployApproval") {
      const approvalResult = toolResults.find((m) => m.tool_call_id === lastCall.id);
      let payload: {
        decision?: "approve" | "reject";
        strategy?: string;
        chosenPort?: number;
        ip?: string;
        type?: HoneypotType;
      } = {};
      try {
        payload = JSON.parse(textContent(approvalResult?.content ?? ""));
      } catch {
        /* 忽略解析失败，按拒绝处理 */
      }

      let callArgs: { mode?: "deploy" | "remove"; ip?: string; type?: HoneypotType } = {};
      try {
        callArgs = JSON.parse(lastCall.function.arguments);
      } catch {
        /* 忽略 */
      }

      if (payload.decision !== "approve") {
        if (callArgs.mode === "remove") {
          return { kind: "text", text: "已取消卸载，诱饵继续保持运行，配置与历史告警均未变更。" };
        }
        return { kind: "text", text: "用户拒绝了部署方案，未做任何变更。可以换一个节点或调整方案后重试。" };
      }

      const ip = payload.ip ?? callArgs.ip ?? "";
      const type = payload.type ?? callArgs.type ?? ("SSH" as HoneypotType);

      if (callArgs.mode === "remove") {
        return {
          kind: "tool",
          name: "removeHoneypot",
          args: { ip, type },
          pre: "已获授权，开始卸载该节点的诱饵。",
        };
      }

      const args: Record<string, unknown> = { ip, type };
      if (payload.strategy) args.strategy = payload.strategy;
      if (payload.chosenPort != null) args.chosenPort = payload.chosenPort;
      return {
        kind: "tool",
        name: "deployHoneypot",
        args,
        pre: "已获授权，开始执行部署。",
      };
    }

    if (lastName === "scanAsset") {
      return { kind: "text", text: FINAL_SCAN };
    }

    if (lastName === "traceAttack") {
      let traceArg: { alertId?: string } = {};
      try {
        traceArg = JSON.parse(lastCall.function.arguments);
      } catch {
        /* 忽略 */
      }
      const alertId = traceArg.alertId ?? lastTracedAlertId ?? MOCK_ALERT.id;
      lastTracedAlertId = alertId;
      return { kind: "text", text: traceBrief(alertId) };
    }

    if (lastName === "deployHoneypot") {
      const results = toolResults
        .map((m) => {
          try {
            return JSON.parse(textContent(m.content)) as {
              ip?: string; type?: HoneypotType; port?: number; preflight?: string; error?: string;
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ ip: string; type: HoneypotType; port: number; preflight?: string; error?: string }>;

      // 上一步部署失败：直接收尾说明
      const lastResult = results[results.length - 1];
      if (lastResult?.error) {
        return { kind: "text", text: `部署未成功：${lastResult.error} 请换一个服务器或网关节点，也可以让我按体检结果自主决策部署。` };
      }

      // Agent 自主决策：105 SSH 完成后，继续在网关部署 Web 仿冒
      const isAuto = /自动|批量|自主|根据体检|按体检|建议的都|推荐的都/.test(lastUser);
      const deployedIps = new Set(results.map((r) => r.ip));
      if (isAuto && results.length === 1 && !deployedIps.has("192.168.1.1")) {
        return {
          kind: "tool",
          name: "deployHoneypot",
          args: { ip: "192.168.1.1", type: "WEB" },
          pre: "105 的 SSH 诱饵已就位；网关开放 Web 管理面，继续投放 Web 仿冒诱饵。",
        };
      }

      // 自主模式两枚全部完成
      if (isAuto && results.length >= 2) {
        return {
          kind: "text",
          text: "已按体检结果完成两处诱饵部署：105·SSH（22）捕获横向移动与回连，网关·Web 仿冒（8080）捕获凭据输入；加上 108 既有的 SSH 诱饵，攻击面监测已张开。可进入归因分析查看一条完整告警的溯源示例。",
        };
      }

      // 单次部署收尾
      if (lastResult) {
        const tpl = HONEYPOT_TEMPLATES[lastResult.type];
        const tail = lastResult.ip.replace("192.168.1.", "");
        return {
          kind: "text",
          text: `${tpl.display}已在 ${tail}（${lastResult.ip}）上线，监听端口 ${lastResult.port}。${lastResult.preflight ?? "预检通过"}。后续针对该主机的攻击行为会被实时记录并推送告警。`,
        };
      }
    }
  }

  // ---------- 首轮：意图分类 ----------
  // 0) 画图 / 可视化复现（必须在 归因/部署 之前，避免“部署图/蜜点分布”被部署意图截胡）
  const drawVerb = /画|绘制|生成|重新生成|再显示|重新显示|展示|重新展示|再展示|看看|重新看/.test(lastUser);
  if (drawVerb) {
    if (/攻击链|溯源|图谱/.test(lastUser)) {
      const alertId = resolveTraceAlert(lastUser);
      lastTracedAlertId = alertId;
      return { kind: "tool", name: "traceAttack", args: { alertId }, pre: "好的，重新渲染这条告警的交互式溯源图谱。" };
    }
    if (/拓扑|网络图|网络|资产图|蜜点分布|诱饵分布|部署图/.test(lastUser)) {
      return { kind: "tool", name: "scanAsset", args: { cidr: "192.168.1.0/24", replay: true }, pre: "好的，重新渲染当前网段的交互式拓扑图（重放视图）。" };
    }
  }

  // 0.2) 关联事件 / 攻击活动分析（实体值、campaign、告警 ID 均可；不带值则汇总当前 campaign）
  const relatedMatch = lastUser.match(/(?:分析|查看|看看|梳理)?\s*(?:关联事件|关联告警|历史事件|相关事件|关联历史|攻击活动|历史告警)\s*[:：]?\s*(.*)/);
  if (relatedMatch) {
    let value = relatedMatch[1].trim().replace(/[。！!？?\s]+$/g, "");
    // 未给具体值：默认当前溯源告警所属 campaign
    if (!value && lastTracedAlertId) {
      const cur = MOCK_ALERTS.find((a) => a.id === lastTracedAlertId);
      if (cur?.campaignId) value = cur.campaignId;
    }
    if (value) {
      const resolved = resolveRelatedEvent(value);
      if (resolved.kind === "text") return { kind: "text", text: resolved.text };
      lastTracedAlertId = resolved.alertId;
      const campaignId = parseCampaignId(value);
      const pre = campaignId ? campaignSummary(campaignId) + "\n下面打开其中最值得关注的一条告警做溯源：" : PRE_TRACE;
      return { kind: "tool", name: "traceAttack", args: { alertId: resolved.alertId }, pre };
    }
  }

  // 0.1) 卸载 / 移除蜜点（有后果操作，先走审批）
  if (
    /(卸载|移除|撤掉|关掉|删除).*(蜜点|诱饵|仿冒|蜜罐|honeypot)/i.test(lastUser) ||
    /(蜜点|诱饵|仿冒|蜜罐|honeypot).*(卸载|移除|撤掉|关掉|删除)/i.test(lastUser)
  ) {
    const ip = parseIp(lastUser);
    if (!ip) {
      return { kind: "text", text: "请告诉我要卸载哪个节点的诱饵，例如“卸载 105 的 SSH 诱饵”；不指定类型则会移除该节点全部诱饵。" };
    }
    const type = parseType(lastUser);
    return {
      kind: "tool",
      name: "requestDeployApproval",
      args: type ? { mode: "remove", ip, type } : { mode: "remove", ip },
      pre: "卸载属于有后果操作，需要您确认将停止的诱饵与释放端口后再执行。",
    };
  }

  // 1) 归因（明确要求分析/溯源；支持显式告警 ID、「下一条待研判」、campaign）
  if (/分析.*(告警|蜜点|攻击|活动)|归因|溯源|分析攻击链|分析最近|下一条/.test(lastUser)) {
    // 直接给出 campaign 编号时，先小结活动，再打开其中最值得关注的一条告警
    const cid = parseCampaignId(lastUser);
    if (cid) {
      const resolved = resolveRelatedEvent(cid);
      if (resolved.kind === "tool") {
        lastTracedAlertId = resolved.alertId;
        return { kind: "tool", name: "traceAttack", args: { alertId: resolved.alertId }, pre: campaignSummary(cid) + "\n下面打开其中最值得关注的一条告警做溯源：" };
      }
    }
    const alertId = resolveTraceAlert(lastUser);
    lastTracedAlertId = alertId;
    const alert = MOCK_ALERTS.find((a) => a.id === alertId);
    const pre = alert && alert.id !== MOCK_ALERT.id
      ? `收到，开始对 ${alert.id}（${alert.title}）做逐层溯源。`
      : PRE_TRACE;
    return { kind: "tool", name: "traceAttack", args: { alertId }, pre };
  }

  // 2) 部署
  if (/部署|投放|蜜点|诱饵|蜜罐|honeypot|仿冒/i.test(lastUser)) {
    const isAuto = /自动|批量|自主|根据体检|按体检|建议的都|推荐的都/.test(lastUser);
    let ip = parseIp(lastUser);
    let type = parseType(lastUser);

    if (isAuto && !ip) {
      // Agent 自主决策：先部署 105 SSH，链式第二步在收尾逻辑里
      const first = DEPLOY_RECOMMENDATIONS[0];
      return { kind: "tool", name: "deployHoneypot", args: { ip: first.ip, type: first.type }, pre: `根据体检结果自主决策：${first.reason}，先在此投放 ${first.type} 诱饵。` };
    }
    if (!ip) {
      // 只给了类型：推荐最合适的主机
      if (type) {
        const map: Record<HoneypotType, string> = { SSH: "192.168.1.105", SQL: "192.168.1.107", WEB: "192.168.1.1", SMB: "192.168.1.103" };
        ip = map[type];
      } else {
        return { kind: "text", text: "可以部署，请告诉我目标节点和诱饵类型，例如“在 105 部署 SSH 蜜点”；也可以直接说“根据体检结果自动部署”，我会自主选择位置和类型。" };
      }
    }
    const asset = assetByIp(ip);
    if (!asset) {
      return { kind: "text", text: `未在资产清单中找到 ${ip}，请先执行内网体检，或改用清单内的节点。` };
    }
    if (!type) type = recommendedType(asset) ?? "SSH";
    const opt = evaluateDeploy(asset, type);
    if (opt.support === "unsupported") {
      // 仍调用工具，由工具返回结构化错误卡（前端渲染 FAILED）
      return { kind: "tool", name: "deployHoneypot", args: { ip, type }, pre: PRE_DEPLOY };
    }
    // 审批两阶段：端口冲突必弹审批；无冲突时按授权模式 / 类型自动批准决定
    const authMode = detectAuthMode(messages);
    const typeAutoApproved = autoApproveTypes.includes(type);
    if (opt.conflict && !typeAutoApproved) {
      const tpl = HONEYPOT_TEMPLATES[type];
      return {
        kind: "tool",
        name: "requestDeployApproval",
        args: { mode: "deploy", ip, type, conflict: { port: tpl.port, process: conflictProcess(type), pid: 3421 } },
        pre: `检测到 ${tpl.port} 端口被真实服务占用，需要您选择部署方案后再执行。`,
      };
    }
    if (authMode === "auto" || typeAutoApproved) {
      if (opt.conflict) {
        // 自动批准 + 端口冲突：采用推荐的备用端口方案直接部署
        return {
          kind: "tool",
          name: "deployHoneypot",
          args: { ip, type, strategy: "alt-port", chosenPort: opt.port },
          pre: `${type} 诱饵已在本会话授权自动批准；${opt.port} 端口策略自动生效，直接部署。`,
        };
      }
      return { kind: "tool", name: "deployHoneypot", args: { ip, type }, pre: PRE_DEPLOY };
    }
    return {
      kind: "tool",
      name: "requestDeployApproval",
      args: { mode: "deploy", ip, type },
      pre: `即将在 ${ip} 投放 ${HONEYPOT_TEMPLATES[type].display}，请确认后执行。`,
    };
  }

  // 3) 体检
  if (/体检|扫描|测绘|资产盘点|扫一下|盘点/.test(lastUser)) {
    const cidr = lastUser.match(/\d+\.\d+\.\d+\.\d+\/\d+/)?.[0] ?? "192.168.1.0/24";
    return { kind: "tool", name: "scanAsset", args: { cidr }, pre: PRE_SCAN };
  }

  // 4) 处置工单
  if (/工单|处置|怎么处理|应对措施|响应措施/.test(lastUser)) {
    return { kind: "text", text: TICKET_REPLY };
  }

  // 5) 攻击来源问答
  if (/攻击源|从哪(里|儿)进来|怎么进来的|入口/.test(lastUser)) {
    return { kind: "text", text: ATTACK_SOURCE_REPLY };
  }

  // 6) 资产问答（指定节点）
  const qIp = parseIp(lastUser);
  if (qIp && /是什么|什么系统|情况|风险|漏洞|端口|服务|介绍|查一下|看看|分析节点|信息/.test(lastUser)) {
    return { kind: "text", text: assetQna(qIp) };
  }
  if (qIp) return { kind: "text", text: assetQna(qIp) };

  // 7) 风险清单问答
  if (/高危|风险资产|有哪些风险|风险有哪些|风险情况/.test(lastUser)) {
    return { kind: "text", text: RISK_LIST_REPLY };
  }

  // 8) 问候 / 兜底
  if (/你好|您好|hi|hello|在吗|帮助|能做什么|会什么|功能/i.test(lastUser)) {
    return { kind: "text", text: GREETING_REPLY };
  }
  return { kind: "text", text: GUIDE_REPLY };
}

// ---------------- SSE 响应 ----------------
const MODEL = "deepseek-chat";

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return (
    "data: " +
    JSON.stringify({
      id: "chatcmpl-demo",
      object: "chat.completion.chunk",
      created: 1726700000,
      model: MODEL,
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    }) +
    "\n\n"
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function splitText(text: string, size = 12): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

async function sseStream(messages: OAIMessage[]): Promise<Response> {
  const p = plan(messages);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (s: string) => controller.enqueue(encoder.encode(s));
      await sleep(280); // 思考停顿，配合前端 thinking 指示
      enqueue(chunk({ role: "assistant", content: "" }));

      if (p.kind === "text") {
        for (const piece of splitText(p.text)) {
          enqueue(chunk({ content: piece }));
          await sleep(26);
        }
        enqueue(chunk({}, "stop"));
      } else {
        // 先输出一句过渡语，再发起工具调用
        if (p.pre) {
          for (const piece of splitText(p.pre, 14)) {
            enqueue(chunk({ content: piece }));
            await sleep(26);
          }
        }
        await sleep(220);
        enqueue(
          chunk({
            tool_calls: [
              {
                index: 0,
                id: `call_${Date.now()}`,
                type: "function",
                function: { name: p.name, arguments: JSON.stringify(p.args) },
              },
            ],
          }),
        );
        enqueue(chunk({}, "tool_calls"));
      }
      enqueue("data: [DONE]\n\n");
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function jsonResponse(messages: OAIMessage[]): Response {
  const p = plan(messages);
  const message =
    p.kind === "text"
      ? { role: "assistant", content: p.text }
      : {
          role: "assistant",
          content: p.pre,
          tool_calls: [
            {
              id: `call_${Date.now()}`,
              type: "function",
              function: { name: p.name, arguments: JSON.stringify(p.args) },
            },
          ],
        };
  return Response.json({
    id: "chatcmpl-demo",
    object: "chat.completion",
    created: 1726700000,
    model: MODEL,
    choices: [{ index: 0, message, finish_reason: p.kind === "tool" ? "tool_calls" : "stop" }],
  });
}

/** 注入到 createOpenAICompatible({ fetch }) 的自定义 fetch */
export function createScriptedFetch(realFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const parseBody = (): { messages: OAIMessage[]; stream: boolean } => {
      try {
        const body = JSON.parse((init?.body as string) ?? "{}");
        return { messages: body.messages ?? [], stream: body.stream !== false };
      } catch {
        return { messages: [], stream: true };
      }
    };

    if (!url.includes("/chat/completions")) {
      return realFetch(input as RequestInfo, init);
    }

    if (engine === "deepseek") {
      // 真实 DeepSeek：失败（断网/Key 失效/超时）时自动退回演示脚本，保证演示不中断
      try {
        const resp = await realFetch(input as RequestInfo, init);
        if (resp.ok) return resp;
        // 401/429/5xx 等：读掉错误体后回退脚本，保证演示不中断
        const detail = await resp.text().catch(() => "");
        console.warn(`[engine] DeepSeek 返回 ${resp.status}，回退演示脚本：`, detail.slice(0, 200));
        const { messages, stream } = parseBody();
        return stream ? sseStream(messages) : jsonResponse(messages);
      } catch (err) {
        console.warn("[engine] DeepSeek 请求失败，回退演示脚本：", (err as Error)?.message ?? err);
        const { messages, stream } = parseBody();
        return stream ? sseStream(messages) : jsonResponse(messages);
      }
    }

    const { messages, stream } = parseBody();
    return stream ? sseStream(messages) : jsonResponse(messages);
  };
}
