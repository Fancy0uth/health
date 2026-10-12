import test from "node:test";
import assert from "node:assert/strict";
import { DomainStore } from "../../services/api/domain-store.mjs";
let sequence = 0;
const key = () => `missingness-operation-${++sequence}`;
function setup(t) {
  const s = new DomainStore({ demoAccounts: [{ username: "missingness", password: "synthetic-password" }] });
  t.after(() => s.close());
  const uid = s.login("missingness", "synthetic-password").user.id;
  s.setConsent(uid, { purpose: "analysis", granted: true, expected_version: 1 });
  return { s, uid };
}
function prepare(f, text) {
  const a = f.s.accept(f.uid, "entry", { text }, key());
  f.s.claimRun(a.run_id);
  const tools = f.s.toolsFor(a.run_id),
    read = tools.healththread_read_source({ source_id: a.source_id });
  tools.healththread_retrieve_context({});
  return { ...a, tools, read };
}
function candidate(p, field = "reported_text", assertion = "affirmed") {
  return {
    field,
    value: p.read.source.text,
    assertion,
    temporal_scope: "unknown",
    effective_time: {
      raw: null,
      precision: "unknown",
      start: null,
      end: null,
      timezone: null,
      anchor_source_id: p.source_id,
    },
    evidence: p.read.sentence_spans,
    proposal_kind: "new",
  };
}
function stage(f, p, candidates) {
  const receipt = p.tools.healththread_stage_candidates({
    candidates,
    base_profile_revision: f.s.user(f.uid).revision,
    operation_key: key(),
  });
  return f.s.get(f.uid, "fact_change", receipt.fact_change_id);
}
function confirm(f, c, k = key()) {
  return f.s.confirm(
    f.uid,
    c.id,
    {
      accepted_change_ids: c.proposals.map((p) => p.id),
      expected_profile_revision: f.s.user(f.uid).revision,
    },
    k,
  );
}
function snapshot(f) {
  return {
    revision: f.s.user(f.uid).revision,
    facts: f.s.all("fact_revision"),
    sources: f.s.all("source"),
    changes: f.s.all("fact_change"),
    audits: f.s.all("audit"),
    operations: f.s.all("operation"),
    receipts: f.s.db.prepare("SELECT * FROM receipts").all(),
  };
}
for (const [text, field, assertion] of [
  ["药物过敏情况不知道。", "allergy", "affirmed"],
  ["药名没有记录。", "reported_text", "negated"],
])
  test(`missing information cannot stage as a clinical assertion: ${text}`, (t) => {
    const f = setup(t),
      p = prepare(f, text);
    assert.throws(() => stage(f, p, [candidate(p, field, assertion)]), { code: "INVALID_AGENT_OUTPUT" });
    assert.equal(f.s.profile(f.uid).facts.length, 0);
    assert.equal(f.s.profile(f.uid).pending_changes.length, 0);
    assert.equal(f.s.get(f.uid, "source", p.source_id).text, text);
  });
test("finite missingness variants reject all new assertion labels while preserving literal sources", (t) => {
  const f = setup(t);
  for (const text of [
    "过敏情况不清楚。",
    "过敏情况未知。",
    "药名未记录。",
    "药名无记录。",
    "药名未记载。",
    "药名没有提供。",
    "Allergy status unknown.",
    "Medication name not recorded.",
    "Allergy history not documented.",
    "Medication name not provided.",
    "I do not know the allergy history.",
    "I don't know the medication name.",
    "No information about allergies.",
    "No record of medication.",
    "未提及过敏。",
    "Allergy status not assessed.",
  ]) {
    const p = prepare(f, text);
    for (const assertion of ["affirmed", "negated", "uncertain"])
      assert.throws(() => stage(f, p, [candidate(p, "reported_text", assertion)]), {
        code: "INVALID_AGENT_OUTPUT",
      });
    assert.equal(p.read.source.text, text);
    f.s.cancel(f.uid, p.run_id);
  }
});
test("old bad checkpoint confirmation is atomic; saved source reanalysis can remain source-only", (t) => {
  const f = setup(t);
  for (const [text, field, assertion] of [
    ["药物过敏情况不知道。", "allergy", "affirmed"],
    ["药名没有记录。", "reported_text", "negated"],
  ]) {
    const p = prepare(f, text),
      change = stage(f, p, []);
    change.proposals = [{ ...candidate(p, field, assertion), id: "legacy-" + key() }];
    f.s.save("fact_change", change);
    const before = snapshot(f),
      k = key();
    assert.throws(() => confirm(f, change, k), { code: "INVALID_AGENT_OUTPUT" });
    assert.deepEqual(snapshot(f), before);
    const retry = f.s.reanalyse(f.uid, p.run_id, { expected_profile_revision: 1 }, key());
    assert.equal(retry.source_id, p.source_id);
    f.s.claimRun(retry.run_id);
    const tools = f.s.toolsFor(retry.run_id);
    assert.equal(tools.healththread_read_source({ source_id: retry.source_id }).source.text, text);
    tools.healththread_retrieve_context({});
    const next = tools.healththread_stage_candidates({
      candidates: [],
      base_profile_revision: 1,
      operation_key: key(),
    });
    assert.equal(f.s.get(f.uid, "fact_change", next.fact_change_id).proposals.length, 0);
    assert.equal(f.s.profile(f.uid).facts.length, 0);
    assert.equal(f.s.get(f.uid, "fact_change", change.id).status, "expired");
  }
  assert.equal(f.s.all("source").length, 2);
});
test("manual unknown correction rejects without a new assertion, but unknown retraction reason stays uncertain and withdraws", (t) => {
  const f = setup(t),
    p = prepare(f, "过敏于花粉。");
  confirm(f, stage(f, p, [candidate(p, "allergy")]));
  const fact = f.s.profile(f.uid).facts[0];
  for (const text of ["药物过敏情况不知道。", "药名没有记录。"]) {
    const before = snapshot(f);
    assert.throws(
      () => f.s.changeRequest(f.uid, fact.fact_id, { kind: "correction", text, expected_version: 1 }, key()),
      { code: "INVALID_AGENT_OUTPUT" },
    );
    assert.deepEqual(snapshot(f), before);
  }
  const receipt = f.s.changeRequest(
      f.uid,
      fact.fact_id,
      { kind: "retraction", text: "药物过敏情况不知道，撤回该记录。", expected_version: 1 },
      key(),
    ),
    change = f.s.get(f.uid, "fact_change", receipt.fact_change_id);
  assert.equal(change.proposals[0].field, "reported_text");
  assert.equal(change.proposals[0].assertion, "uncertain");
  assert.equal(f.s.get(f.uid, "source", receipt.source_id).text, "药物过敏情况不知道，撤回该记录。");
  confirm(f, change);
  assert.equal(f.s.profile(f.uid).facts.length, 0);
  assert.equal(f.s.get(f.uid, "fact_revision", fact.id).value, "过敏于花粉。");
  assert.equal(f.s.all("fact_revision").at(-1).review_status, "retracted");
});
test("explicit denials and diagnostic uncertainty still stage without becoming missingness", (t) => {
  const f = setup(t);
  for (const [text, field, assertion] of [
    ["无头痛。", "reported_text", "negated"],
    ["没有发热。", "reported_text", "negated"],
    ["No headache.", "reported_text", "negated"],
    ["No known allergies.", "allergy", "negated"],
    ["考虑肺炎。", "diagnosis", "uncertain"],
    ["过敏待排。", "allergy", "uncertain"],
    ["不确定是否过敏。", "allergy", "uncertain"],
  ]) {
    const p = prepare(f, text);
    assert.equal(stage(f, p, [candidate(p, field, assertion)]).proposals[0].assertion, assertion);
  }
});
test("missing-record retraction reasons are uncertain and cannot masquerade as clinical-field proposals", (t) => {
  const f = setup(t),
    p = prepare(f, "药物过敏。");
  confirm(f, stage(f, p, [candidate(p, "allergy")]));
  const fact = f.s.profile(f.uid).facts[0];
  const receipt = f.s.changeRequest(
      f.uid,
      fact.fact_id,
      { kind: "retraction", text: "药物过敏没有记录。", expected_version: 1 },
      key(),
    ),
    change = f.s.get(f.uid, "fact_change", receipt.fact_change_id);
  assert.equal(change.proposals[0].assertion, "uncertain");
  const before = snapshot(f);
  change.proposals[0].field = "allergy";
  f.s.save("fact_change", change);
  assert.throws(() => confirm(f, change), { code: "INVALID_AGENT_OUTPUT" });
  assert.equal(f.s.user(f.uid).revision, before.revision);
  assert.equal(f.s.profile(f.uid).facts.length, 1);
  change.proposals[0].field = "reported_text";
  f.s.save("fact_change", change);
  confirm(f, change);
  assert.equal(f.s.profile(f.uid).facts.length, 0);
  assert.equal(f.s.all("fact_revision").at(-1).assertion, "uncertain");
});
