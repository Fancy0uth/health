import test from "node:test";
import assert from "node:assert/strict";
import { mountDomainApp } from "../../packages/client/domain-ui.js";
import { DomainClient, MemoryStorage } from "../../packages/client/domain-client.js";
import { candidateHtml, runLabel } from "../../packages/client/presentation.js";
test("peer canonical confirmation clears transient feedback but keeps unknown-write/error recovery", async (t) => {
  const client = new DomainClient({ storage: new MemoryStorage(), channel: null });
  client.state.user = { id: "a", username: "a" };
  client.state.profile.profile_revision = 1;
  client.initialize = async () => client.state;
  client.dispose = () => {};
  let close;
  const old = { document: globalThis.document, window: globalThis.window, location: globalThis.location };
  t.after(() => {
    close?.();
    Object.assign(globalThis, old);
  });
  globalThis.location = { hash: "#timeline" };
  globalThis.document = { activeElement: null, hidden: true };
  globalThis.window = {
    addEventListener: (name, fn) => {
      if (name === "pagehide") close = fn;
    },
  };
  const root = {
    innerHTML: "",
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
  };
  mountDomainApp({ root, client });
  await Promise.resolve();
  client.emit({ type: "storage", message: "旧候选等待核对" });
  assert.ok(root.innerHTML.includes("旧候选等待核对"));
  client.operations = [
    {
      id: "unknown",
      key: "stable-original-key",
      method: "POST",
      state: "unknown",
      body: { text: "保留输入" },
    },
  ];
  client.emit({ type: "error", error: { code: "OUTCOME_UNKNOWN", message: "结果尚未知" } });
  client.state.profile = {
    profile_revision: 2,
    facts: [{ value: "实际已核对事实。", review_status: "confirmed", revision: 1, evidence: [] }],
    pending_changes: [],
  };
  client.emit();
  assert.ok(!root.innerHTML.includes("旧候选等待核对"));
  assert.ok(root.innerHTML.includes("实际已核对事实。"));
  assert.ok(root.innerHTML.includes("结果尚未知"));
  assert.ok(root.innerHTML.includes("stable-original-key"));
});
test("terminal review controls and unsupported time wording remain truthful", () => {
  const markup = candidateHtml(
    { id: "x", value: "后来不适。", effective_time: { raw: null }, evidence: [] },
    { disabled: true },
  );
  assert.match(markup, /<input[^>]*disabled/);
  assert.ok(!markup.includes("未知 / 未记录"));
  assert.match(runLabel({ status: "cancelled", phase: "result_withdrawn" }), /产物.*撤回/);
});
