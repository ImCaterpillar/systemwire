import { CopilotRuntime, createCopilotEndpoint, InMemoryAgentRunner, BuiltInAgent, defineTool } from "@copilotkit/runtime/v2";
import type { BuiltInAgentClassicConfig, ToolDefinition } from "@copilotkit/runtime/v2";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { handle } from "hono/vercel";
import { z } from "zod";
import {
  MOCK_ASSETS,
  MOCK_LINKS,
  HONEYPOT_TEMPLATES,
  evaluateDeploy,
  getTraceData,
  MAX_DEPLOYMENTS_PER_NODE,
} from "../../../../lib/mock-data";
import type { HoneypotType } from "../../../../lib/mock-data";
import { createScriptedFetch, setEngine, setAuthMode, setAutoApproveTypes } from "../../../../lib/mock-engine";

process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

// ---- 模型：DeepSeek（OpenAI 兼容）；fetch 被脚本引擎接管，离线也能演示 ----
const deepSeekApiKey = process.env.DEEPSEEK_API_KEY?.trim();
const DEEPSEEK_BASE_URL = process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";

const model = createOpenAICompatible({
  name: "deepseek",
  apiKey: deepSeekApiKey || "demo-mock-key",
  baseURL: DEEPSEEK_BASE_URL,
  fetch: createScriptedFetch(fetch.bind(globalThis)) as typeof fetch,
})(DEFAULT_DEEPSEEK_MODEL) as BuiltInAgentClassicConfig["model"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 服务端部署登记（演示用内存态）：每节点可共存异类型诱饵，最多 MAX_DEPLOYMENTS_PER_NODE 个；
// 108 的 SSH 诱饵为剧本预置（当前告警来源）
const deploymentRegistry = new Map<string, Set<HoneypotType>>([
  ["192.168.1.108", new Set<HoneypotType>(["SSH"])],
]);

/** IP 归一化：AI 传错 IP 时兜底纠正到资产列表（精确 → 尾段 → 名称） */
function resolveIp(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  if (MOCK_ASSETS.some((a) => a.ip === s)) return s;
  const last = s.split(".").pop();
  if (last) {
    const byTail = MOCK_ASSETS.find((a) => a.ip.endsWith("." + last));
    if (byTail) return byTail.ip;
  }
  const byName = MOCK_ASSETS.find(
    (a) => a.name.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(a.name.toLowerCase()),
  );
  return byName ? byName.ip : "";
}

// ---- 三个安全工具（模拟实现，返回结构化数据供前端 Artifact 渲染） ----
const securityTools: ToolDefinition[] = [
  defineTool({
    name: "scanAsset",
    description:
      "对指定内网网段执行资产测绘与风险评估，返回资产列表（含风险标记）、拓扑连线与汇总。该工具会在聊天中渲染交互式拓扑图组件。用户要求内网体检/资产测绘/扫描网段，或要求看图、画图、拓扑图、资产图、网络拓扑、蜜点分布、部署图、重新展示图形时，必须调用本工具，严禁用文字描述、ASCII 或 Mermaid 代替绘图。若已有扫描结果且 args 带 replay:true，前端将重放视图，不重复累加资产。",
    parameters: z.object({
      cidr: z.string().describe("要扫描的网段，如 192.168.1.0/24"),
      replay: z.boolean().optional().describe("重放已有拓扑视图，不重复扫描"),
    }),
    execute: async ({ cidr }) => {
      await sleep(900); // 模拟扫描耗时
      const high = MOCK_ASSETS.filter((a) => a.risk === "high").length;
      const low = MOCK_ASSETS.filter((a) => a.risk === "low").length;
      return {
        cidr,
        scannedAt: new Date().toISOString(),
        total: MOCK_ASSETS.length,
        risky: high,
        low,
        assets: MOCK_ASSETS,
        links: MOCK_LINKS,
        summary: `扫描完成：${MOCK_ASSETS.length} 个资产，${high} 个高危、${low} 个低风险（105 MS17-010、108 SSH 弱口令）`,
      };
    },
  }),

  defineTool({
    name: "deployHoneypot",
    description:
      "在指定 IP 上部署蜜点诱饵。支持 SSH/SQL/WEB/SMB 四种模板，自动做端口冲突预检（如 3306 被占用则改用备用端口）。同一节点可共存异类型诱饵，最多 3 个；同类型重复请求幂等返回“已在运行”。封闭设备（PLC/打印机/摄像头/交换机）与网关非 Web 模板会被拒绝。部署前如遇端口冲突或用户设置逐次确认模式，必须先调用 requestDeployApproval 获取用户授权，再执行本工具。用户要求部署蜜点/诱饵/蜜罐时调用。",
    parameters: z.object({
      ip: z.string().describe("目标资产 IP（必须来自 scanAsset 返回的资产列表）"),
      type: z.enum(["SSH", "SQL", "WEB", "SMB"]).describe("蜜点模板类型"),
      strategy: z
        .enum(["direct", "alt-port", "stop-service", "reverse-proxy", "other-node"])
        .optional()
        .describe("审批通过后用户选择的部署方案"),
      chosenPort: z.number().optional().describe("审批通过后用户选定的实际监听端口"),
    }),
    execute: async ({ ip, type, strategy, chosenPort }) => {
      await sleep(520);
      const tpl = HONEYPOT_TEMPLATES[type as HoneypotType];
      const realIp = resolveIp(ip);
      if (!realIp) {
        return {
          error: `未找到资产 ${ip}。可用资产：${MOCK_ASSETS.map((a) => a.ip).join(", ")}，请用精确 IP 重新调用。`,
        };
      }
      const target = MOCK_ASSETS.find((a) => a.ip === realIp)!;
      const opt = evaluateDeploy(target, type as HoneypotType);
      if (opt.support === "unsupported") {
        return { ip: realIp, type, status: "failed", error: `${realIp}（${target.name}）无法部署：${opt.reason}` };
      }
      const set = deploymentRegistry.get(realIp);
      // 同节点同类型：幂等返回“已在运行”
      if (set?.has(type as HoneypotType)) {
        return {
          ip: realIp, name: target.name, type, port: chosenPort ?? opt.port, status: "active",
          support: opt.support, already: true, strategy: strategy ?? null,
          checks: [
            { label: "已部署", status: "ok", msg: `${tpl.display}诱饵已在该节点运行（同类型幂等）` },
            { label: "Agent 下发", status: "ok", msg: "轻量诱饵 Agent 已注入" },
            { label: "告警通道", status: "ok", msg: "告警回传链路正常" },
          ],
          preflight: "该诱饵已在运行，无需重复部署",
          advice: `${realIp} 上的 ${tpl.display}诱饵持续监测中，攻击行为将实时记录并推送告警`,
        };
      }
      // 每节点上限：异类型共存，但不超过 MAX_DEPLOYMENTS_PER_NODE
      if ((set?.size ?? 0) >= MAX_DEPLOYMENTS_PER_NODE) {
        return {
          ip: realIp, type, status: "failed",
          error: `${realIp}（${target.name}）已运行 ${set!.size} 个诱饵，每节点最多部署 ${MAX_DEPLOYMENTS_PER_NODE} 个，请先卸载部分诱饵或选择其他节点。`,
        };
      }
      const usedPort = chosenPort ?? opt.port;
      if (set) set.add(type as HoneypotType);
      else deploymentRegistry.set(realIp, new Set<HoneypotType>([type as HoneypotType]));
      const checks = [
        {
          label: `端口 ${opt.conflict && usedPort === opt.port ? `${tpl.port} → ${usedPort}` : `${usedPort}`}`,
          status: opt.conflict ? "warn" : "ok",
          msg: opt.conflict
            ? `${tpl.port} 被真实 ${tpl.badge} 服务占用，已按方案切换到端口 ${usedPort}`
            : `端口 ${usedPort} 空闲`,
        },
        { label: "Agent 下发", status: "ok", msg: "轻量诱饵 Agent 注入成功" },
        { label: "告警通道", status: "ok", msg: "告警回传链路正常" },
      ];
      return {
        ip: realIp,
        name: target.name,
        type,
        port: usedPort,
        conflict: opt.conflict,
        strategy: strategy ?? null,
        preflight: opt.conflict ? checks[0].msg : `端口 ${usedPort} 空闲，预检通过`,
        checks,
        status: "active",
        support: opt.support,
        advice:
          type === "SSH"
            ? `${realIp} 风险暴露面集中在远程访问，SSH 诱饵可捕获爆破行为、弱口令与回连地址`
            : `${realIp} 已部署 ${tpl.display}，攻击行为将实时记录并推送告警`,
      };
    },
  }),

  defineTool({
    name: "removeHoneypot",
    description:
      "卸载指定节点上的蜜点诱饵。type 省略则移除该节点全部诱饵，返回被移除列表、释放端口、日志归档条数。卸载属于有后果动作，必须先调用 requestDeployApproval 获取用户授权，再执行本工具。用户要求卸载/移除/关掉诱饵时调用。",
    parameters: z.object({
      ip: z.string().describe("目标节点 IP"),
      type: z.enum(["SSH", "SQL", "WEB", "SMB"]).optional().describe("省略则移除该节点全部诱饵"),
    }),
    execute: async ({ ip, type }) => {
      await sleep(480);
      const realIp = resolveIp(ip);
      if (!realIp) {
        return {
          error: `未找到资产 ${ip}。可用资产：${MOCK_ASSETS.map((a) => a.ip).join(", ")}，请用精确 IP 重新调用。`,
        };
      }
      const target = MOCK_ASSETS.find((a) => a.ip === realIp)!;
      const set = deploymentRegistry.get(realIp);
      if (!set || set.size === 0) {
        return { ip: realIp, name: target.name, status: "failed", error: `${realIp}（${target.name}）当前未运行任何诱饵。` };
      }
      const toRemove = type ? [type as HoneypotType] : Array.from(set);
      const notRunning = toRemove.filter((t) => !set.has(t));
      if (notRunning.length > 0) {
        return { ip: realIp, name: target.name, status: "failed", error: `${realIp}（${target.name}）未运行 ${notRunning.join("/")} 诱饵。` };
      }
      const removed = toRemove.map((t) => ({ type: t, port: HONEYPOT_TEMPLATES[t].port }));
      const releasedPorts = removed.map((r) => r.port);
      for (const t of toRemove) set.delete(t);
      if (set.size === 0) deploymentRegistry.delete(realIp);
      let warning: string | undefined;
      if (realIp === "192.168.1.108" && toRemove.includes("SSH")) {
        warning = "该诱饵为当前告警来源，卸载后告警事件保留但不再采集。";
      }
      return {
        ip: realIp,
        name: target.name,
        removed,
        releasedPorts,
        archivedLogs: toRemove.length * 128,
        status: "success",
        warning,
      };
    },
  }),

  defineTool({
    name: "traceAttack",
    description:
      "对蜜点告警做攻击溯源归因，返回告警详情、交互式溯源图谱（蜜点事件→攻击源→跳板终端→失陷账号与ATT&CK手法，不同告警层数 2-4 层）、证据时间线、风险因子、影响范围、处置建议与研判结论。该工具渲染交互式四层溯源图谱。用户要求归因分析/溯源，或要求攻击链图/溯源图/图谱/重新展示图形时，必须调用本工具，严禁用文字描述或 Mermaid 代替绘图。",
    parameters: z.object({
      alertId: z.string().describe("蜜点告警 ID，如 ALERT-2026-0919-001"),
    }),
    execute: async ({ alertId }) => {
      await sleep(820);
      return { alertId, ...getTraceData(alertId) };
    },
  }),
];

const builtInAgent = new BuiltInAgent({
  model,
  tools: securityTools,
  maxSteps: 5,
  prompt:
    "你是一名内网安全智能体 SYSTEMWIRE，负责内网体检（资产测绘与风险评估）、蜜点部署、告警归因分析。\n" +
    "规则：\n" +
    "1. 用户要求内网体检/扫描网段时，调用 scanAsset 工具（默认网段 192.168.1.0/24）。\n" +
    "2. 用户要求部署蜜点/诱饵时，调用 deployHoneypot 工具；若体检结果显示某主机有对应漏洞（如 105 有 MS17-010 建议 SSH 诱饵、网关有 Web 服务建议 Web 仿冒），可主动建议部署位置与类型；封闭设备（PLC/打印机/摄像头/交换机）不支持部署。\n" +
    "3. 用户要求归因/溯源时，调用 traceAttack 工具。\n" +
    "4. 【最高优先级】必须且只能使用简体中文回复，禁止输出英文句子（IP/SSH/MS17-010 等技术术语保留原文）。语气简洁专业，像安全分析师。\n" +
    "5. 【篇幅与格式铁律】工具结果由前端渲染成可视化卡片，你绝不能重复罗列资产清单、连线、时间线、ATT&CK 等明细；禁止使用 Markdown 表格、标题、加粗、代码块、分隔线或卡片式排版。每次只允许输出 1-2 句简短中文：调用工具前说一句正在做什么，工具返回后用一句话点出关键结论与建议即可。\n" +
    "6. 调用工具时，IP 必须使用资产列表中的精确 IP（192.168.1.x 格式）；用户口语提到的主机编号（如 105、网关）须换算为精确 IP，禁止臆造不存在的 IP。\n" +
    "7. 【绘图铁律】凡是用户要求看图、画图、拓扑图、资产图、网络图、攻击链图、溯源图、图谱、蜜点分布、部署图、重新展示图形的请求，必须调用对应工具（scanAsset / traceAttack）渲染交互式可视化组件，严禁用文字描述、ASCII、Mermaid、Markdown 表格代替绘图；数据已存在时调用工具并重放渲染即可，不要重复制造业务副作用。\n" +
    "8. 【审批铁律】部署/卸载前如遇端口冲突，或用户设置了逐次确认模式，必须先调用 requestDeployApproval 工具获取用户授权（前端会弹出授权确认卡），再执行 deployHoneypot / removeHoneypot；用户拒绝后不得执行任何变更，只用一句话说明并给出替代建议。\n",
});

const honoRuntime = new CopilotRuntime({
  agents: { default: builtInAgent },
  runner: new InMemoryAgentRunner(),
  a2ui: {},
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime: honoRuntime,
  basePath: "/api/copilotkit",
});

// 每次请求先按客户端 header 切换引擎（mock / deepseek），再交给 Hono
function syncEngine(req: Request) {
  const hdr = req.headers.get("x-agent-engine");
  setEngine(hdr === "deepseek" ? "deepseek" : "mock");
  const authHdr = req.headers.get("x-auth-mode");
  setAuthMode(authHdr === "auto" ? "auto" : "confirm");
  // 本次会话已勾选自动批准的诱饵类型（逗号分隔，如 "WEB,SQL"）
  const autoHdr = req.headers.get("x-auto-approve") ?? "";
  const types = autoHdr
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s): s is HoneypotType => ["SSH", "SQL", "WEB", "SMB"].includes(s));
  setAutoApproveTypes(types);
}

const honoHandler = handle(app);
export const GET = (req: Request) => {
  syncEngine(req);
  return honoHandler(req);
};
export const POST = (req: Request) => {
  syncEngine(req);
  return honoHandler(req);
};
