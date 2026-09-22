import { describe, expect, it, afterEach } from "vitest";
import { plan, setAutoApproveTypes, type OAIMessage } from "../lib/mock-engine";
import {
  evaluateDeploy,
  isHostSupported,
  recommendedType,
  getTraceData,
  MAX_DEPLOYMENTS_PER_NODE,
} from "../lib/mock-data";
import { MOCK_ASSETS } from "../lib/mock-data";

const user = (content: string): OAIMessage => ({ role: "user", content });
const sys = (content: string): OAIMessage => ({ role: "system", content });
const assistantTool = (id: string, name: string, args: unknown): OAIMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const toolResult = (id: string, payload: unknown): OAIMessage => ({
  role: "tool",
  tool_call_id: id,
  content: JSON.stringify(payload),
});

describe("脚本引擎意图路由", () => {
  it("体检意图 → scanAsset 工具调用", () => {
    const p = plan([user("对 192.168.1.0/24 做内网体检")]);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("scanAsset");
      expect(p.args).toEqual({ cidr: "192.168.1.0/24" });
    }
  });

  it("部署意图：105 + SSH 无端口冲突，默认逐次确认 → requestDeployApproval", () => {
    const p = plan([user("在 192.168.1.105 部署 SSH 蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("requestDeployApproval");
      expect(p.args).toMatchObject({ mode: "deploy", ip: "192.168.1.105", type: "SSH" });
    }
  });

  it("部署意图：105 + SSH 在 authMode:auto 下 → 直接 deployHoneypot", () => {
    const p = plan([sys("authMode:auto"), user("在 192.168.1.105 部署 SSH 蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("deployHoneypot");
      expect(p.args).toMatchObject({ ip: "192.168.1.105", type: "SSH" });
    }
  });

  it("只说类型自动选主机：WEB → 网关（有端口冲突，走审批）", () => {
    const p = plan([user("部署一个 Web 仿冒诱饵")]);
    expect(p.kind).toBe("tool");
    if (p.kind !== "tool") throw new Error("应触发工具调用");
    expect(p.name).toBe("requestDeployApproval");
    expect(p.args).toMatchObject({ mode: "deploy", ip: "192.168.1.1", type: "WEB" });
  });

  it("只说编号 107 且无类型 → 推荐 SQL（端口冲突，带 conflict）", () => {
    const p = plan([user("在 107 部署蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind !== "tool") throw new Error("应触发工具调用");
    expect(p.name).toBe("requestDeployApproval");
    expect(p.args).toMatchObject({ mode: "deploy", ip: "192.168.1.107", type: "SQL" });
    expect((p.args as { conflict?: { port: number } }).conflict?.port).toBe(3306);
  });

  it("Agent 自主部署：第一步 105 SSH，第二步链式补网关 WEB，第三步收尾（auto 模式）", () => {
    const msg = "根据体检结果自动部署蜜点";
    const step1 = plan([sys("authMode:auto"), user(msg)]);
    expect(step1.kind).toBe("tool");
    if (step1.kind !== "tool") throw new Error("fail");
    expect(step1.args).toMatchObject({ ip: "192.168.1.105", type: "SSH" });

    const step2 = plan([
      sys("authMode:auto"),
      user(msg),
      assistantTool("c1", "deployHoneypot", { ip: "192.168.1.105", type: "SSH" }),
      toolResult("c1", { ip: "192.168.1.105", type: "SSH", port: 22 }),
    ]);
    expect(step2.kind).toBe("tool");
    if (step2.kind !== "tool") throw new Error("fail");
    expect(step2.args).toMatchObject({ ip: "192.168.1.1", type: "WEB" });

    const step3 = plan([
      sys("authMode:auto"),
      user(msg),
      assistantTool("c1", "deployHoneypot", { ip: "192.168.1.105", type: "SSH" }),
      toolResult("c1", { ip: "192.168.1.105", type: "SSH", port: 22 }),
      assistantTool("c2", "deployHoneypot", { ip: "192.168.1.1", type: "WEB" }),
      toolResult("c2", { ip: "192.168.1.1", type: "WEB", port: 8080 }),
    ]);
    expect(step3.kind).toBe("text");
  });

  it("归因意图 → traceAttack", () => {
    const p = plan([user("分析最近一条蜜点告警")]);
    if (p.kind !== "tool") throw new Error("应触发工具调用");
    expect(p.name).toBe("traceAttack");
  });

  it("工具结果后返回短中文总结而非重复明细", () => {
    const scan = plan([
      user("对 192.168.1.0/24 做内网体检"),
      assistantTool("c1", "scanAsset", { cidr: "192.168.1.0/24" }),
      toolResult("c1", { total: 12, risky: 2 }),
    ]);
    expect(scan.kind).toBe("text");
    if (scan.kind === "text") {
      expect(scan.text.length).toBeLessThan(140);
      expect(scan.text).toContain("12");
    }

    const trace = plan([
      user("分析最近一条蜜点告警"),
      assistantTool("c2", "traceAttack", { alertId: "ALERT-1" }),
      toolResult("c2", {}),
    ]);
    expect(trace.kind).toBe("text");
    if (trace.kind === "text") expect(trace.text).toContain("87%");
  });

  it("资产问答：105 风险文本回答，不调工具", () => {
    const p = plan([user("192.168.1.105 是什么系统，有什么风险？")]);
    expect(p.kind).toBe("text");
    if (p.kind === "text") expect(p.text).toContain("MS17-010");
  });

  it("多轮回归：历史含工具往返时，新用户追问必须重新路由，不得回放旧总结", () => {
    const p = plan([
      user("对 192.168.1.0/24 做内网体检"),
      assistantTool("c1", "scanAsset", { cidr: "192.168.1.0/24" }),
      toolResult("c1", { total: 12, risky: 2 }),
      { role: "assistant", content: "内网体检完成：旧总结" },
      user("192.168.1.105 有什么风险？"),
    ]);
    expect(p.kind).toBe("text");
    if (p.kind === "text") {
      expect(p.text).toContain("MS17-010");
      expect(p.text).not.toContain("内网体检完成");
    }
  });

  it("处置工单与问候兜底均为文本", () => {
    expect(plan([user("生成处置工单")]).kind).toBe("text");
    expect(plan([user("你能做什么")]).kind).toBe("text");
  });
});

describe("画图意图路由", () => {
  const cases = [
    { input: "画个拓扑图", expected: "scanAsset" },
    { input: "把攻击链绘制成图谱", expected: "traceAttack" },
    { input: "重新生成溯源图", expected: "traceAttack" },
    { input: "展示一下资产网络图", expected: "scanAsset" },
    { input: "看看蜜点分布部署图", expected: "scanAsset" },
    { input: "再显示一次拓扑", expected: "scanAsset" },
  ];

  for (const c of cases) {
    it(`「${c.input}」→ ${c.expected}`, () => {
      const p = plan([user(c.input)]);
      expect(p.kind).toBe("tool");
      if (p.kind === "tool") {
        expect(p.name).toBe(c.expected);
        if (c.expected === "scanAsset") {
          expect(p.args).toMatchObject({ replay: true });
        }
      }
    });
  }
});

describe("卸载意图路由", () => {
  it("卸载 108 的 SSH → requestDeployApproval mode=remove", () => {
    const p = plan([user("卸载 192.168.1.108 的 SSH 蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("requestDeployApproval");
      expect(p.args).toMatchObject({ mode: "remove", ip: "192.168.1.108", type: "SSH" });
    }
  });

  it("审批两阶段：approve 后 → removeHoneypot", () => {
    const messages: OAIMessage[] = [
      user("卸载 192.168.1.108 的 SSH 蜜点"),
      assistantTool("c1", "requestDeployApproval", { mode: "remove", ip: "192.168.1.108", type: "SSH" }),
      toolResult("c1", { decision: "approve", ip: "192.168.1.108", type: "SSH" }),
    ];
    const p = plan(messages);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("removeHoneypot");
      expect(p.args).toMatchObject({ ip: "192.168.1.108", type: "SSH" });
    }
  });

  it("审批两阶段：reject 后 → 取消卸载文本", () => {
    const messages: OAIMessage[] = [
      user("卸载 192.168.1.108 的 SSH 蜜点"),
      assistantTool("c1", "requestDeployApproval", { mode: "remove", ip: "192.168.1.108", type: "SSH" }),
      toolResult("c1", { decision: "reject" }),
    ];
    const p = plan(messages);
    expect(p.kind).toBe("text");
    if (p.kind === "text") expect(p.text).toContain("已取消卸载");
  });
});

describe("审批两阶段（部署）", () => {
  it("107 SQL 端口冲突 → requestDeployApproval 带 conflict", () => {
    const p = plan([user("在 192.168.1.107 部署 SQL 蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("requestDeployApproval");
      expect(p.args.conflict).toBeDefined();
      expect((p.args.conflict as { port: number }).port).toBe(3306);
    }
  });

  it("approve 后 → deployHoneypot 带 strategy/chosenPort", () => {
    const messages: OAIMessage[] = [
      user("在 192.168.1.107 部署 SQL 蜜点"),
      assistantTool("c1", "requestDeployApproval", {
        mode: "deploy",
        ip: "192.168.1.107",
        type: "SQL",
        conflict: { port: 3306, process: "mysqld", pid: 3421 },
      }),
      toolResult("c1", {
        decision: "approve",
        strategy: "alt-port",
        chosenPort: 13306,
        ip: "192.168.1.107",
        type: "SQL",
      }),
    ];
    const p = plan(messages);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("deployHoneypot");
      expect(p.args).toMatchObject({
        ip: "192.168.1.107",
        type: "SQL",
        strategy: "alt-port",
        chosenPort: 13306,
      });
    }
  });

  it("auto 模式无冲突 → 直接 deployHoneypot（不弹审批）", () => {
    const p = plan([sys("authMode:auto"), user("在 192.168.1.105 部署 SSH 蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind === "tool") {
      expect(p.name).toBe("deployHoneypot");
      expect(p.args).toMatchObject({ ip: "192.168.1.105", type: "SSH" });
    }
  });
});

describe("多类型部署规则", () => {
  it("105 可同时评估 SSH 和 SMB（异类型共存）", () => {
    const a = MOCK_ASSETS.find((x) => x.ip === "192.168.1.105")!;
    expect(evaluateDeploy(a, "SSH").support).not.toBe("unsupported");
    expect(evaluateDeploy(a, "SMB").support).not.toBe("unsupported");
  });

  it("MAX_DEPLOYMENTS_PER_NODE === 3", () => {
    expect(MAX_DEPLOYMENTS_PER_NODE).toBe(3);
  });
});

describe("多告警溯源数据", () => {
  it("0919-001 → 4层 87%", () => {
    const d = getTraceData("ALERT-2026-0919-001");
    expect(d.layers.length).toBe(4);
    expect(d.verdict.confidence).toBe(87);
  });

  it("0917-001 → 3层 62%，风险因子分值总和=confidence", () => {
    const d = getTraceData("ALERT-2026-0917-001");
    expect(d.layers.length).toBe(3);
    expect(d.verdict.confidence).toBe(62);
    const sum = d.riskFactors.reduce((s, f) => s + f.score, 0);
    expect(sum).toBe(62);
  });

  it("0915-001 → 2层 71%", () => {
    const d = getTraceData("ALERT-2026-0915-001");
    expect(d.layers.length).toBe(2);
    expect(d.verdict.confidence).toBe(71);
  });

  it("未知 alertId → 默认第一条数据（4层）", () => {
    const d = getTraceData("UNKNOWN");
    expect(d.layers.length).toBe(4);
  });
});

describe("蜜点部署可行性规则", () => {
  const byTail = (tail: string) => MOCK_ASSETS.find((a) => a.ip.endsWith("." + tail))!;

  it("PLC/打印机/摄像头/交换机不支持部署", () => {
    for (const tail of ["109", "110", "111", "112"]) {
      expect(isHostSupported(byTail(tail))).toBe(false);
      expect(evaluateDeploy(byTail(tail), "SSH").support).toBe("unsupported");
    }
  });

  it("网关仅支持 WEB，且 80 被占自动改 8080", () => {
    const gw = byTail("1");
    expect(evaluateDeploy(gw, "WEB").support).toBe("recommended");
    expect(evaluateDeploy(gw, "WEB").port).toBe(8080);
    expect(evaluateDeploy(gw, "SSH").support).toBe("unsupported");
  });

  it("108 真实 SSH 占 22 → SSH 诱饵推荐但改 2222", () => {
    const opt = evaluateDeploy(byTail("108"), "SSH");
    expect(opt.support).toBe("recommended");
    expect(opt.port).toBe(2222);
  });

  it("107 MySQL 占 3306 → SQL 诱饵改 13306", () => {
    expect(evaluateDeploy(byTail("107"), "SQL").port).toBe(13306);
  });

  it("剧本推荐：105→SSH、网关→WEB、103→SMB", () => {
    expect(recommendedType(byTail("105"))).toBe("SSH");
    expect(recommendedType(byTail("1"))).toBe("WEB");
    expect(recommendedType(byTail("103"))).toBe("SMB");
  });
});

describe("多告警溯源路由（二期）", () => {
  it("显式告警 ID 0917-001 → traceAttack 携带该 ID，收尾结论为 62%", () => {
    const p1 = plan([user("分析告警 ALERT-2026-0917-001")]);
    expect(p1.kind).toBe("tool");
    if (p1.kind !== "tool") throw new Error("fail");
    expect(p1.name).toBe("traceAttack");
    expect(p1.args).toEqual({ alertId: "ALERT-2026-0917-001" });

    const p2 = plan([
      user("分析告警 ALERT-2026-0917-001"),
      assistantTool("c1", "traceAttack", { alertId: "ALERT-2026-0917-001" }),
      toolResult("c1", {}),
    ]);
    expect(p2.kind).toBe("text");
    if (p2.kind === "text") expect(p2.text).toContain("62%");
  });

  it("显式告警 ID 0915-001（2 层样本）→ 收尾结论为 71%，不再误报 87%", () => {
    const p = plan([
      user("分析告警 ALERT-2026-0915-001"),
      assistantTool("c1", "traceAttack", { alertId: "ALERT-2026-0915-001" }),
      toolResult("c1", {}),
    ]);
    if (p.kind !== "text") throw new Error("应返回收尾文本");
    expect(p.text).toContain("71%");
    expect(p.text).not.toContain("87%");
  });

  it("「下一条待研判」相对当前告警循环：0919-001 → 0919-002 → 0918-001", () => {
    const start = plan([user("分析告警 ALERT-2026-0919-001")]);
    expect(start.kind).toBe("tool");

    const next1 = plan([user("分析下一条待研判告警")]);
    expect(next1.kind).toBe("tool");
    if (next1.kind !== "tool") throw new Error("fail");
    expect(next1.name).toBe("traceAttack");
    expect(next1.args).toEqual({ alertId: "ALERT-2026-0919-002" });

    const next2 = plan([user("下一条")]);
    expect(next2.kind).toBe("tool");
    if (next2.kind !== "tool") throw new Error("fail");
    expect(next2.args).toEqual({ alertId: "ALERT-2026-0918-001" });
  });

  it("campaign 编号 C-0917 → 打开该活动下最值得关注的开放告警 0918-001", () => {
    const p = plan([user("分析攻击活动 C-0917")]);
    expect(p.kind).toBe("tool");
    if (p.kind !== "tool") throw new Error("fail");
    expect(p.name).toBe("traceAttack");
    expect(["ALERT-2026-0918-001", "ALERT-2026-0917-001"]).toContain(p.args.alertId);
    expect(p.args.alertId).toBe("ALERT-2026-0918-001");
  });

  it("实体关联事件：账号 wangwei → 路由到其关联的 0919 campaign 告警", () => {
    const p = plan([user("分析关联事件 wangwei")]);
    expect(p.kind).toBe("tool");
    if (p.kind !== "tool") throw new Error("fail");
    expect(p.name).toBe("traceAttack");
    expect(["ALERT-2026-0919-001", "ALERT-2026-0919-002"]).toContain(p.args.alertId);
  });

  it("未知实体 → 文本提示而非空转工具", () => {
    const p = plan([user("分析关联事件 nobody_unknown")]);
    expect(p.kind).toBe("text");
  });
});

describe("按类型自动批准（x-auto-approve）", () => {
  afterEach(() => setAutoApproveTypes([]));

  it("confirm 模式下 SQL 已被勾选自动批准：107 端口冲突也直接 alt-port 部署，不弹审批", () => {
    setAutoApproveTypes(["SQL"]);
    const p = plan([user("在 192.168.1.107 部署 SQL 蜜点")]);
    expect(p.kind).toBe("tool");
    if (p.kind !== "tool") throw new Error("fail");
    expect(p.name).toBe("deployHoneypot");
    expect(p.args).toMatchObject({
      ip: "192.168.1.107",
      type: "SQL",
      strategy: "alt-port",
      chosenPort: 13306,
    });
  });

  it("仅自动批准 SQL 时，WEB 冲突仍需走审批", () => {
    setAutoApproveTypes(["SQL"]);
    const p = plan([user("部署一个 Web 仿冒诱饵")]);
    expect(p.kind).toBe("tool");
    if (p.kind !== "tool") throw new Error("fail");
    expect(p.name).toBe("requestDeployApproval");
    expect(p.args).toMatchObject({ mode: "deploy", type: "WEB" });
  });
});
