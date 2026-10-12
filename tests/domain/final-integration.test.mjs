import test from "node:test";
import assert from "node:assert/strict";
import { DomainStore } from "../../services/api/domain-store.mjs";
let serial = 0;
const key = () => `final-integration-${++serial}`;
function fixture(t, limits = {}) {
  const s = new DomainStore({
    limits,
    demoAccounts: [
      { username: "a", password: "1234567890" },
      { username: "b", password: "1234567890" },
    ],
  });
  t.after(() => s.close());
  const [a, b] = ["a", "b"].map((n) => s.login(n, "1234567890").user.id);
  for (const u of [a, b]) s.setConsent(u, { purpose: "analysis", granted: true, expected_version: 1 });
  return { s, a, b };
}
function prepare(f, text, workflow = "entry", owner = f.a) {
  const a = f.s.accept(
    owner,
    workflow,
    workflow === "visit" ? { current_concern: text, selected_source_ids: [] } : { text },
    key(),
  );
  f.s.claimRun(a.run_id);
  const tools = f.s.toolsFor(a.run_id),
    read = tools.healththread_read_source({ source_id: a.source_id });
  tools.healththread_retrieve_context({});
  return { ...a, tools, read, owner };
}
function candidate(p, raw = null, extra = {}) {
  const e = p.read.sentence_spans[0];
  return {
    field: "reported_text",
    value: e.quote,
    assertion: "affirmed",
    temporal_scope: "unknown",
    effective_time: {
      raw,
      precision: raw ? "relative" : "unknown",
      start: null,
      end: null,
      timezone: null,
      anchor_source_id: p.source_id,
    },
    evidence: [e],
    proposal_kind: "new",
    ...extra,
  };
}
function stage(f, p, c = candidate(p)) {
  return f.s.get(
    p.owner,
    "fact_change",
    p.tools.healththread_stage_candidates({
      candidates: Array.isArray(c) ? c : [c],
      base_profile_revision: f.s.user(p.owner).revision,
      operation_key: key(),
    }).fact_change_id,
  );
}
function confirm(f, c, k = key()) {
  return f.s.confirm(
    c.owner,
    c.id,
    {
      accepted_change_ids: c.proposals.map((p) => p.id),
      expected_profile_revision: f.s.user(c.owner).revision,
    },
    k,
  );
}
function care(f, text = "Record symptoms daily.", raw = "daily") {
  const p = prepare(f, text, "document"),
    c = stage(f, p, candidate(p, raw, { field: "instruction" }));
  const next = confirm(f, c);
  f.s.claimRun(next.continuation_run_id);
  const tools = f.s.toolsFor(next.continuation_run_id),
    instructions = tools.healththread_get_confirmed_instructions({ document_id: p.document_id }).instructions;
  const dependencies = instructions.map((i) => ({ fact_id: i.fact_id, revision: i.revision }));
  const args = {
    kind: "care_plan",
    payload: {
      tasks: instructions.map((i, n) => ({
        text: i.value,
        instruction_refs: [dependencies[n]],
        schedule: raw,
      })),
    },
    dependencies,
    operation_key: key(),
  };
  return { p, c, tools, instructions, args, next };
}
test("literal time omission rejects staging; source annotations give bounded repair guidance", (t) => {
  const f = fixture(t);
  for (const [text, raw] of [
    ["医嘱：每日记录症状。", "每日"],
    ["医嘱：大约三天后复诊。", "大约三天后"],
    ["Record symptoms daily.", "daily"],
    ["Return after about three days.", "after about three days"],
  ]) {
    const p = prepare(f, text, "document");
    assert.throws(() => stage(f, p, candidate(p)), { code: "INVALID_AGENT_OUTPUT" });
    assert.equal(p.read.sentence_annotations[0].effective_time.raw, raw);
    assert.equal(stage(f, p, candidate(p, raw)).proposals[0].effective_time.raw, raw);
  }
});
test("old omitted-time checkpoint confirmation rolls back, explicit source reanalysis preserves original", (t) => {
  const f = fixture(t),
    p = prepare(f, "医嘱：三天后复诊。", "document"),
    c = stage(f, p, candidate(p, "三天后", { field: "instruction" }));
  c.proposals[0].effective_time = { ...c.proposals[0].effective_time, raw: null, precision: "unknown" };
  f.s.save("fact_change", c);
  const before = f.s.exportData(f.a);
  assert.throws(() => confirm(f, c), { code: "INVALID_AGENT_OUTPUT" });
  assert.deepEqual(f.s.exportData(f.a).fact_revisions, before.fact_revisions);
  assert.equal(f.s.user(f.a).revision, 1);
  const a = f.s.reanalyse(f.a, p.run_id, { expected_profile_revision: 1 }, key());
  assert.equal(a.source_id, p.source_id);
  assert.equal(f.s.all("source", f.a).length, 1);
});
test("manual corrections share marker and literal time classifier while mixed scopes reject", (t) => {
  const f = fixture(t),
    p = prepare(f, "头痛。");
  confirm(f, stage(f, p));
  const fact = f.s.profile(f.a).facts[0];
  for (const [text, assertion, scope, raw] of [
    ["无头痛。", "negated", "unknown", null],
    ["曾头痛。", "affirmed", "past", null],
    ["No headache.", "negated", "unknown", null],
    ["Previously headache.", "affirmed", "past", null],
    ["三天后记录症状。", "affirmed", "unknown", "三天后"],
  ]) {
    const a = f.s.changeRequest(f.a, fact.fact_id, { kind: "correction", text, expected_version: 1 }, key()),
      c = f.s.get(f.a, "fact_change", a.fact_change_id).proposals[0];
    assert.equal(c.field, "reported_text");
    assert.equal(c.assertion, assertion);
    assert.equal(c.temporal_scope, scope);
    assert.equal(c.effective_time.raw, raw);
  }
  assert.throws(
    () =>
      f.s.changeRequest(
        f.a,
        fact.fact_id,
        { kind: "correction", text: "Previously headache, currently coughing.", expected_version: 1 },
        key(),
      ),
    { code: "INVALID_AGENT_OUTPUT" },
  );
});
for (const action of ["cancel", "consent", "delete"])
  test(`${action} retires pending checkpoints with terminal reasons`, (t) => {
    const f = fixture(t),
      p = prepare(f, "候选。"),
      c = stage(f, p);
    if (action === "cancel") f.s.cancel(f.a, p.run_id);
    if (action === "consent") {
      f.s.setConsent(f.a, { purpose: "analysis", granted: false, expected_version: 2 });
      f.s.setConsent(f.a, { purpose: "analysis", granted: true, expected_version: 3 });
    }
    if (action === "delete") {
      const other = f.s.accept(f.a, "entry", { text: "别的来源。" }, key());
      f.s.deleteData(f.a, other.source_id, key());
    }
    assert.equal(f.s.profile(f.a).pending_changes.length, 0);
    const retired = f.s.get(f.a, "fact_change", c.id);
    assert.equal(retired.status, "expired");
    assert.ok(retired.terminal_reason);
    assert.throws(() => confirm(f, c));
    assert.equal(f.s.get(f.a, "source", p.source_id).text, "候选。");
  });
test("scope change retires manual pending changes too", (t) => {
  const f = fixture(t),
    p = prepare(f, "事实。");
  confirm(f, stage(f, p));
  const a = f.s.changeRequest(
    f.a,
    f.s.profile(f.a).facts[0].fact_id,
    { kind: "correction", text: "更正原文。", expected_version: 1 },
    key(),
  );
  f.s.setConsent(f.a, { purpose: "analysis", granted: false, expected_version: 2 });
  assert.equal(f.s.get(f.a, "fact_change", a.fact_change_id).status, "expired");
  assert.equal(f.s.profile(f.a).pending_changes.length, 0);
});
test("indirect fact-source deletion withdraws result references and preserves independent concern", (t) => {
  const f = fixture(t),
    p = prepare(f, "旧事实。");
  confirm(f, stage(f, p));
  const fact = f.s.profile(f.a).facts[0],
    v = prepare(f, "当前困扰。", "visit"),
    ref = { fact_id: fact.fact_id, revision: 1 };
  const r = v.tools.healththread_stage_result({
    kind: "visit_preparation",
    payload: {
      speech: v.read.source.text + "\n" + fact.value,
      claims: [
        { text: v.read.source.text, evidence: v.read.sentence_spans, fact_refs: [] },
        { text: fact.value, evidence: [], fact_refs: [ref] },
      ],
      questions: [],
      unknowns: [],
    },
    dependencies: [{ source_id: v.source_id, source_text_version: 1 }, ref],
    operation_key: key(),
  });
  f.s.deleteData(f.a, p.source_id, key());
  const run = f.s.get(f.a, "run", v.run_id);
  assert.equal(run.result_id, null);
  assert.equal(run.result_ref, null);
  assert.equal(run.phase, "result_withdrawn");
  assert.ok(f.s.listOwned(f.a, "run").items.some((x) => x.id === run.id));
  assert.equal(f.s.get(f.a, "source", v.source_id).text, "当前困扰。");
  assert.throws(() => f.s.get(f.a, "result", r.result_id), { code: "NOT_FOUND" });
  assert.ok(!JSON.stringify(f.s.exportData(f.a).runs).includes(r.result_id));
  assert.throws(() => v.tools.healththread_stage_result({ operation_key: key() }));
});
test("English schedules require validated literal time and unchanged care stays usable", (t) => {
  const f = fixture(t),
    c = care(f);
  assert.throws(
    () =>
      c.tools.healththread_stage_result({
        ...c.args,
        payload: { tasks: c.args.payload.tasks.map((t) => ({ ...t, schedule: null })) },
      }),
    { code: "INVALID_AGENT_OUTPUT" },
  );
  c.tools.healththread_stage_result(c.args);
  const task = f.s.careTasks(f.a).tasks[0];
  f.s.updateTask(f.a, task.id, { status: "done", expected_version: 1 });
  const p = prepare(f, "无关事实。");
  confirm(f, stage(f, p, candidate(p, null, { assertion: "negated" })));
  assert.equal(f.s.careTasks(f.a).tasks[0].validity, "current");
  f.s.updateTask(f.a, task.id, { status: "paused", expected_version: 2 });
  const change = f.s.changeRequest(
    f.a,
    c.instructions[0].fact_id,
    { kind: "retraction", text: "撤回原医嘱。", expected_version: 1 },
    key(),
  );
  confirm(f, f.s.get(f.a, "fact_change", change.fact_change_id));
  assert.equal(f.s.careTasks(f.a).tasks[0].validity, "stale");
  assert.equal(f.s.careTasks(f.a).tasks[0].status, "paused");
  assert.throws(() => f.s.updateTask(f.a, task.id, { status: "open", expected_version: 3 }), {
    code: "STALE_DEPENDENCY",
  });
});
for (const crossOwner of [false, true])
  test(`confirmation admission is atomic and same-key retry recovers (${crossOwner ? "global" : "owner"})`, (t) => {
    const f = fixture(t, { queueDepth: crossOwner ? 1 : 10, userQueueDepth: 1 }),
      p = prepare(f, "请记录症状。", "document"),
      c = stage(f, p, candidate(p, null, { field: "instruction" }));
    const filler = f.s.accept(crossOwner ? f.b : f.a, "entry", { text: "排队。" }, key());
    const k = key(),
      before = {
        facts: f.s.all("fact_revision"),
        audit: f.s.all("audit"),
        operations: f.s.all("operation"),
        receipts: f.s.db.prepare("SELECT * FROM receipts").all(),
      };
    assert.throws(() => confirm(f, c, k), { code: "QUEUE_BUSY" });
    assert.equal(f.s.get(f.a, "fact_change", c.id).status, "pending");
    assert.equal(f.s.user(f.a).revision, 1);
    assert.deepEqual(
      {
        facts: f.s.all("fact_revision"),
        audit: f.s.all("audit"),
        operations: f.s.all("operation"),
        receipts: f.s.db.prepare("SELECT * FROM receipts").all(),
      },
      before,
    );
    f.s.cancel(crossOwner ? f.b : f.a, filler.run_id);
    assert.ok(confirm(f, c, k).continuation_run_id);
  });
test("same source span cannot yield competing duplicate classifications but repeated locations survive", (t) => {
  const f = fixture(t),
    p = prepare(f, "考虑肺炎。考虑肺炎。");
  const c = candidate(p, null, { assertion: "uncertain" });
  assert.throws(() => stage(f, p, [c, { ...c, field: "diagnosis" }]), { code: "INVALID_AGENT_OUTPUT" });
  assert.equal(stage(f, p, [c, { ...c, evidence: [p.read.sentence_spans[1]] }]).proposals.length, 2);
});
test("date and qualifier annotations preserve literal uncertainty without invented normalization", (t) => {
  const f = fixture(t);
  for (const [text, raw] of [
    ["约2026-2-31复诊。", "约2026-2-31"],
    ["2026/3/4记录。", "2026/3/4"],
    ["2026年3月4日记录。", "2026年3月4日"],
    ["Return last Friday.", "last Friday"],
  ]) {
    const p = prepare(f, text);
    assert.throws(() => stage(f, p, candidate(p)), { code: "INVALID_AGENT_OUTPUT" });
    assert.equal(p.read.sentence_annotations[0].effective_time.raw, raw);
    const time = {
      ...candidate(p).effective_time,
      raw,
      precision: raw === "last Friday" ? "relative" : "unknown",
    };
    assert.ok(stage(f, p, candidate(p, null, { effective_time: time })));
  }
  const p = prepare(f, "大约三天后复诊。");
  assert.throws(() => stage(f, p, candidate(p, "三天后")), { code: "INVALID_AGENT_OUTPUT" });
});
test("qualified or malformed dates cannot gain normalized certainty or relative classification", (t) => {
  const f = fixture(t);
  for (const [text, raw, date] of [
    ["约2026-03-04复诊。", "约2026-03-04", "2026-03-04"],
    ["2026/3/4复诊。", "2026/3/4", null],
  ]) {
    const p = prepare(f, text);
    for (const precision of ["relative", "exact"])
      assert.throws(
        () =>
          stage(
            f,
            p,
            candidate(p, null, {
              effective_time: {
                raw,
                precision,
                start: precision === "exact" ? date : null,
                end: null,
                timezone: null,
                anchor_source_id: p.source_id,
              },
            }),
          ),
        { code: "INVALID_AGENT_OUTPUT" },
      );
  }
});
test('time metadata cannot absorb non-time action text beyond its declared literal span',t=>{
 const f=fixture(t),p=prepare(f,'每日记录症状。');assert.throws(()=>stage(f,p,candidate(p,'每日记录症状')),{code:'INVALID_AGENT_OUTPUT'});
});
