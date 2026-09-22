import { describe, expect, it } from "vitest";
import {
  deriveFollowUps,
  deriveComposerDrafts,
  type SuggestionState,
} from "../lib/suggestions-engine";

/** 构造 mock state（最小结构，兼容完整 AppState） */
function mockState(overrides: Partial<SuggestionState> = {}): SuggestionState {
  const base: SuggestionState = {
    page: "asset",
    assets: null,
    scanProgress: 0,
    scanning: false,
    deployments: [{ ip: "192.168.1.108", type: "SSH", status: "active" }],
    traceLayersRevealed: 0,
    traceData: null,
    alertStatusMap: {},
    approval: null,
  };
  return { ...base, ...overrides };
}

describe("deriveComposerDrafts", () => {
  it("体检前返回体检相关草稿", () => {
    const d = deriveComposerDrafts(mockState());
    expect(d.length).toBeGreaterThanOrEqual(2);
    expect(d.some((x) => x.includes("内网体检"))).toBe(true);
  });

  it("体检完成返回部署/归因草稿", () => {
    const d = deriveComposerDrafts(mockState({ assets: [{}], scanProgress: 100 }));
    expect(d.some((x) => x.includes("部署") || x.includes("蜜点"))).toBe(true);
  });

  it("有待审批时返回空数组", () => {
    const d = deriveComposerDrafts(
      mockState({
        approval: {
          id: "1",
          mode: "deploy",
          ip: "1.2.3.4",
          type: "SSH",
          options: [],
          selectedIndex: 0,
          status: "waiting",
        },
      }),
    );
    expect(d.length).toBe(0);
  });
});

describe("deriveFollowUps", () => {
  it("体检完成后返回自主部署+归因动作", () => {
    const a = deriveFollowUps(
      mockState({ assets: [{}], scanProgress: 100 }),
      "内网体检完成",
      "scanAsset",
    );
    expect(a.some((x) => x.id === "auto-deploy")).toBe(true);
    expect(a.some((x) => x.id === "trace")).toBe(true);
  });

  it("有待审批时返回空数组", () => {
    const a = deriveFollowUps(
      mockState({
        approval: {
          id: "1",
          mode: "deploy",
          ip: "1.2.3.4",
          type: "SSH",
          options: [],
          selectedIndex: 0,
          status: "waiting",
        },
      }),
      "",
      "",
    );
    expect(a.length).toBe(0);
  });

  it("归因完成后返回工单+历史+重画图", () => {
    const a = deriveFollowUps(
      mockState({
        page: "attribution",
        traceLayersRevealed: 4,
        traceData: { layers: [{}, {}, {}, {}] },
      }),
      "溯源完成",
      "traceAttack",
    );
    expect(a.some((x) => x.id === "ticket")).toBe(true);
  });

  it("部署失败后返回换节点动作", () => {
    const a = deriveFollowUps(
      mockState({ page: "deception" }),
      "部署未成功：不支持",
      "deployHoneypot",
    );
    expect(a.some((x) => x.id === "retry")).toBe(true);
  });
});
