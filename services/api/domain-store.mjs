import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { check, fail, LIMITS } from "./domain-errors.mjs";
import {
  keys,
  validateCandidate,
  validateEvidence,
  sentenceSpans,
  sentenceAnnotations,
  classifySourceMarkers,
  literalSourceTime,
  validateSourceTime,
} from "./source-validation.mjs";
const id = (kind) => `${kind}_${randomUUID()}`;
const hash = (v) => createHash("sha256").update(v).digest("hex");
const canonical = (v) =>
  JSON.stringify(
    v && typeof v === "object"
      ? Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, JSON.parse(canonical(v[k]))]),
          )
      : v,
  );
const active = ["queued", "running", "needs_review"];
const runError = (code, phase) => ({
  code,
  message: code,
  request_id: id("request"),
  phase,
  retryable: false,
});
export class DomainStore {
  constructor({ dbPath = ":memory:", demoAccounts = [], clock = () => Date.now(), limits = {} } = {}) {
    this.clock = clock;
    this.limits = { ...LIMITS, ...limits };
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,epoch INTEGER NOT NULL DEFAULT 1,all_clear_epoch INTEGER NOT NULL DEFAULT 0);
   CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
   CREATE INDEX IF NOT EXISTS objects_owner_type ON objects(owner,type);
   CREATE TABLE IF NOT EXISTS receipts(owner TEXT NOT NULL,operation TEXT NOT NULL,key TEXT NOT NULL,request_hash TEXT NOT NULL,outcome TEXT NOT NULL,PRIMARY KEY(owner,operation,key));
   CREATE TABLE IF NOT EXISTS originals(source_id TEXT PRIMARY KEY,owner TEXT NOT NULL,bytes BLOB NOT NULL);
   CREATE TRIGGER IF NOT EXISTS immutable_source BEFORE UPDATE ON objects WHEN OLD.type='source' BEGIN SELECT RAISE(ABORT,'immutable_source'); END;
   CREATE TRIGGER IF NOT EXISTS immutable_input_records BEFORE UPDATE ON objects WHEN OLD.type IN ('entry','document','episode') BEGIN SELECT RAISE(ABORT,'immutable_input_record'); END;
   CREATE TRIGGER IF NOT EXISTS immutable_fact_revision BEFORE UPDATE ON objects WHEN OLD.type='fact_revision' BEGIN SELECT RAISE(ABORT,'immutable_fact_revision'); END;`);
    if (
      !this.db
        .prepare("PRAGMA table_info(users)")
        .all()
        .some((column) => column.name === "all_clear_epoch")
    )
      this.db.exec("ALTER TABLE users ADD COLUMN all_clear_epoch INTEGER NOT NULL DEFAULT 0");
    for (const account of demoAccounts) {
      check(
        typeof account.username === "string" &&
          account.username.length >= 1 &&
          typeof account.password === "string" &&
          account.password.length >= 10,
      );
      if (!this.db.prepare("SELECT id FROM users WHERE username=?").get(account.username)) {
        const salt = randomBytes(16).toString("hex"),
          uid = id("usr");
        this.transaction(() => {
          this.db
            .prepare("INSERT INTO users(id,username,salt,password) VALUES(?,?,?,?)")
            .run(uid, account.username, salt, scryptSync(account.password, salt, 64).toString("hex"));
          this.insert(uid, "consent", {
            purpose: "analysis",
            version: 1,
            granted: false,
            recorded_at: this.now(),
          });
        });
      }
    }
    this.transaction(() => {
      for (const r of this.all("run"))
        if (r.status === "running") {
          r.status = "interrupted";
          r.phase = "recovery";
          r.error = runError("RUN_INTERRUPTED", "recovery");
          this.save("run", r);
          this.finishDispatch(r);
        }
    });
  }
  now() {
    return new Date(this.clock()).toISOString();
  }
  close() {
    this.db.close();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  user(uid) {
    const u = this.db
      .prepare("SELECT id,username,revision,epoch,all_clear_epoch FROM users WHERE id=?")
      .get(uid);
    if (!u) fail(401, "AUTH_REQUIRED");
    return u;
  }
  insert(owner, type, data) {
    const value = { ...data, id: data.id || id(type), owner };
    this.db
      .prepare("INSERT INTO objects(id,owner,type,data) VALUES(?,?,?,?)")
      .run(value.id, owner, type, JSON.stringify(value));
    return value;
  }
  save(type, value) {
    const info = this.db
      .prepare("UPDATE objects SET data=? WHERE id=? AND owner=? AND type=?")
      .run(JSON.stringify(value), value.id, value.owner, type);
    check(info.changes === 1, "NOT_FOUND", 404);
    return value;
  }
  all(type, owner) {
    return (
      owner
        ? this.db.prepare("SELECT data FROM objects WHERE type=? AND owner=?").all(type, owner)
        : this.db.prepare("SELECT data FROM objects WHERE type=?").all(type)
    ).map((r) => JSON.parse(r.data));
  }
  get(owner, type, objectId) {
    const row = this.db
      .prepare("SELECT data FROM objects WHERE id=? AND owner=? AND type=?")
      .get(objectId || "", owner, type);
    if (!row) fail(404, "NOT_FOUND");
    return JSON.parse(row.data);
  }
  listOwned(uid, type, { limit = 50, before, source_id, status } = {}) {
    this.user(uid);
    check(["run", "document"].includes(type));
    check(/^[1-9]\d{0,2}$/.test(String(limit)) && Number(limit) <= 100);
    limit = Number(limit);
    let cursor = Number.MAX_SAFE_INTEGER;
    if (before !== undefined) {
      check(typeof before === "string" && before.length <= 200);
      let decoded;
      try {
        decoded = JSON.parse(Buffer.from(before, "base64url").toString("utf8"));
      } catch {
        fail(400, "VALIDATION_ERROR");
      }
      check(decoded?.type === type && Number.isSafeInteger(decoded.row) && decoded.row > 0);
      cursor = decoded.row;
    }
    const clauses = ["owner=?", "type=?", "rowid<?", "COALESCE(json_extract(data,'$.deleted'),0)=0"],
      params = [uid, type, cursor];
    if (source_id !== undefined) {
      check(type === "run" && typeof source_id === "string" && source_id.length <= 200);
      this.get(uid, "source", source_id);
      clauses.push("EXISTS (SELECT 1 FROM json_each(objects.data,'$.source_ids') WHERE value=?)");
      params.push(source_id);
    }
    if (status !== undefined) {
      check(
        type === "run" &&
          [
            "queued",
            "running",
            "needs_review",
            "completed",
            "failed",
            "blocked",
            "interrupted",
            "cancelled",
          ].includes(status),
      );
      clauses.push("json_extract(data,'$.status')=?");
      params.push(status);
    }
    const rows = this.db
      .prepare("SELECT rowid,id FROM objects WHERE " + clauses.join(" AND ") + " ORDER BY rowid DESC LIMIT ?")
      .all(...params, limit + 1);
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.get(uid, type, row.id)),
      next_cursor:
        rows.length > limit
          ? Buffer.from(JSON.stringify({ type, row: page.at(-1).rowid })).toString("base64url")
          : null,
    };
  }
  internalRun(runId) {
    const r = this.db.prepare("SELECT data FROM objects WHERE id=? AND type='run'").get(runId);
    if (!r) fail(404, "NOT_FOUND");
    return JSON.parse(r.data);
  }
  login(username, password) {
    check(
      typeof username === "string" &&
        username.length <= 200 &&
        typeof password === "string" &&
        password.length <= 1024,
      "AUTH_FAILED",
      401,
    );
    const row = this.db.prepare("SELECT * FROM users WHERE username=?").get(username);
    const derived = scryptSync(password, row?.salt || "dummy-account-salt", 64);
    if (!row || !timingSafeEqual(derived, Buffer.from(row.password, "hex")))
      fail(401, "AUTH_FAILED", "账号或密码不正确。");
    const token = randomBytes(32).toString("base64url"),
      csrf = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?)")
      .run(hash(token), row.id, csrf, this.clock() + this.limits.sessionTtlMs);
    return {
      token,
      csrf_token: csrf,
      user: { id: row.id, username: row.username },
      profile_revision: row.revision,
      scope_epoch: row.epoch,
      all_clear_epoch: row.all_clear_epoch,
    };
  }
  session(token) {
    if (typeof token !== "string") return null;
    const row = this.db.prepare("SELECT * FROM sessions WHERE token_hash=?").get(hash(token));
    if (!row || row.expires <= this.clock()) return null;
    const u = this.user(row.user_id);
    return {
      user: { id: u.id, username: u.username },
      csrf_token: row.csrf,
      profile_revision: u.revision,
      scope_epoch: u.epoch,
      all_clear_epoch: u.all_clear_epoch,
    };
  }
  checkExpectedEpoch(uid, expected) {
    if (expected === undefined) return;
    check(Number.isSafeInteger(expected) && expected >= 1, "EPOCH_REQUIRED", 428);
    check(this.user(uid).epoch === expected, "SCOPE_EPOCH_CONFLICT", 409);
  }
  logout(token) {
    if (token) this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash(token));
  }
  consent(uid) {
    this.user(uid);
    return this.all("consent", uid).find((x) => x.purpose === "analysis");
  }
  requireConsent(uid) {
    const c = this.consent(uid);
    check(c.granted, "CONSENT_REQUIRED", 403);
    return c;
  }
  setConsent(uid, body, expectedEpoch) {
    check(body.purpose === "analysis" && typeof body.granted === "boolean");
    return this.transaction(() => {
      this.checkExpectedEpoch(uid, expectedEpoch);
      const c = this.consent(uid);
      check(c.version === body.expected_version, "REVISION_CONFLICT", 409);
      c.version++;
      c.granted = body.granted;
      c.recorded_at = this.now();
      this.save("consent", c);
      this.db.prepare("UPDATE users SET epoch=epoch+1 WHERE id=?").run(uid);
      for (const r of this.all("run", uid))
        if (active.includes(r.status)) {
          r.status = "cancelled";
          r.phase = "consent_changed";
          r.scope_epoch++;
          this.save("run", r);
          this.finishDispatch(r);
        }
      this.expireCheckpoints(uid, "consent_changed");
      return c;
    });
  }
  receipt(uid, operation, key, body, fn) {
    check(typeof key === "string" && key.length >= 16 && key.length <= 128, "IDEMPOTENCY_KEY_REQUIRED");
    const requestHash = hash(canonical(body)),
      prev = this.db
        .prepare("SELECT * FROM receipts WHERE owner=? AND operation=? AND key=?")
        .get(uid, operation, key);
    if (prev) {
      check(prev.request_hash === requestHash, "IDEMPOTENCY_CONFLICT", 409);
      const outcome = JSON.parse(prev.outcome);
      if (/^(accept|retry|reanalyse|change):/.test(operation) && outcome.source_id)
        check(
          this.db
            .prepare("SELECT id FROM objects WHERE id=? AND owner=? AND type='source'")
            .get(outcome.source_id, uid),
          "SOURCE_DELETED",
          410,
        );
      return outcome;
    }
    const result = fn();
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?,?,?)")
      .run(uid, operation, key, requestHash, JSON.stringify(result));
    return result;
  }
  text(text) {
    check(typeof text === "string" && text.trim().length > 0);
    check(Buffer.byteLength(text) <= this.limits.textBytes, "PAYLOAD_TOO_LARGE", 413);
    return text;
  }
  newRun(uid, workflow, sourceIds, extra = {}) {
    const u = this.user(uid),
      c = this.requireConsent(uid);
    return this.insert(uid, "run", {
      workflow,
      status: "queued",
      phase: "queued",
      source_ids: sourceIds,
      base_profile_revision: u.revision,
      consent_version: c.version,
      epoch: u.epoch,
      scope_epoch: 1,
      created_at: this.now(),
      expires_at: this.clock() + this.limits.scopeTtlMs,
      deadline: this.clock() + this.limits.deadlineMs,
      fact_change_id: null,
      result_id: null,
      result_ref: null,
      error: null,
      tool_receipts: [],
      ...extra,
    });
  }
  queueRun(run, operationId) {
    this.checkQueueAdmission(run.owner);
    run.operation_id = operationId;
    this.save("run", run);
    this.insert(run.owner, "dispatch", {
      run_id: run.id,
      operation_id: operationId,
      state: "queued",
      attempt: 0,
      deadline: run.deadline,
      version: 1,
    });
  }
  checkQueueAdmission(uid) {
    const queue = this.all("dispatch").filter((dispatch) => ["queued", "running"].includes(dispatch.state));
    check(
      queue.length < this.limits.queueDepth &&
        queue.filter((dispatch) => dispatch.owner === uid).length < this.limits.userQueueDepth,
      "QUEUE_BUSY",
      429,
    );
  }
  expireCheckpoints(uid, reason, runId = null) {
    for (const change of this.all("fact_change", uid)) {
      if (change.status !== "pending" || (runId !== null && change.run_id !== runId)) continue;
      change.status = "expired";
      change.terminal_reason = reason;
      change.expired_at = this.now();
      this.save("fact_change", change);
    }
  }
  accept(uid, workflow, input, key, document = null, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(
        uid,
        `accept:${workflow}`,
        key,
        { input, document: document ? { hash: hash(document.bytes), pages: document.pages } : null },
        () => {
          this.checkExpectedEpoch(uid, expectedEpoch);
          this.requireConsent(uid);
          check(["entry", "document", "visit"].includes(workflow));
          const text = this.text(workflow === "visit" ? input.current_concern : input.text);
          this.checkQueueAdmission(uid);
          const selected = input.selected_source_ids || [];
          check(Array.isArray(selected) && selected.length <= this.limits.retrievalCount);
          for (const s of selected) this.get(uid, "source", s);
          if (input.episode_id) this.get(uid, "episode", input.episode_id);
          const source = this.insert(uid, "source", {
            kind: workflow === "document" ? "medical_document" : "self_report",
            text,
            text_version: 1,
            content_hash: hash(text),
            recorded_at: this.now(),
            pages: document?.pages || [],
            input_kind: document ? "pdf" : workflow === "document" ? "pasted_document" : "self_report",
          });
          const episode = input.episode_id
            ? this.get(uid, "episode", input.episode_id)
            : this.insert(uid, "episode", {
                source_id: source.id,
                label: null,
                status: "pending",
                created_at: this.now(),
              });
          const entry = this.insert(uid, "entry", {
            source_id: source.id,
            input_kind: source.input_kind,
            received_at: this.now(),
            raw_time_text: null,
            episode_id: episode.id,
          });
          let doc = null;
          if (workflow === "document") {
            doc = this.insert(uid, "document", {
              source_id: source.id,
              name: typeof input.name === "string" ? input.name.slice(0, 200) : null,
              media_type: document ? "application/pdf" : "text/plain",
              byte_size: document?.bytes.length || Buffer.byteLength(text),
              content_hash: document ? hash(document.bytes) : source.content_hash,
              extraction_status: "extracted",
              pages: source.pages,
            });
            if (document)
              this.db.prepare("INSERT INTO originals VALUES(?,?,?)").run(source.id, uid, document.bytes);
          }
          const run = this.newRun(uid, workflow, [source.id, ...selected], { document_id: doc?.id || null });
          const operation = this.insert(uid, "operation", {
            kind: "accept",
            status: "committed",
            source_id: source.id,
            entry_id: entry.id,
            document_id: doc?.id || null,
            run_id: run.id,
            recorded_at: this.now(),
            saved: true,
          });
          this.queueRun(run, operation.id);
          return {
            entry_id: entry.id,
            source_id: source.id,
            ...(doc ? { document_id: doc.id } : {}),
            run_id: run.id,
            operation_id: operation.id,
            saved: true,
          };
        },
      ),
    );
  }
  profile(uid) {
    const u = this.user(uid),
      revs = this.all("fact_revision", uid),
      latest = new Map();
    for (const f of revs)
      if (!latest.has(f.fact_id) || latest.get(f.fact_id).revision < f.revision) latest.set(f.fact_id, f);
    return {
      profile_revision: u.revision,
      facts: [...latest.values()].filter((x) => x.review_status === "confirmed"),
      pending_changes: this.all("fact_change", uid).filter((x) => x.status === "pending"),
    };
  }
  timeline(uid) {
    this.user(uid);
    return {
      entries: this.all("entry", uid).map((e) => ({ ...e, source: this.get(uid, "source", e.source_id) })),
    };
  }
  claimRun(runId) {
    return this.transaction(() => {
      const r = this.internalRun(runId);
      if (r.status !== "queued") return null;
      if (r.deadline <= this.clock()) {
        r.status = "failed";
        r.phase = "dispatch";
        r.error = runError("DEADLINE_EXCEEDED", "dispatch");
        this.save("run", r);
        this.finishDispatch(r);
        return null;
      }
      try {
        this.checkScope(r);
      } catch (e) {
        r.status = "cancelled";
        r.error = runError(e.code, "scope");
        this.save("run", r);
        this.finishDispatch(r);
        return null;
      }
      r.status = "running";
      r.phase = "agent";
      this.save("run", r);
      const d = this.all("dispatch", r.owner).find((d) => d.run_id === r.id);
      d.state = "running";
      d.attempt++;
      d.version++;
      this.save("dispatch", d);
      return r;
    });
  }
  finishDispatch(run) {
    const d = this.all("dispatch", run.owner).find((x) => x.run_id === run.id);
    if (d) {
      d.state = run.status;
      d.version++;
      this.save("dispatch", d);
    }
  }
  checkScope(run, scope) {
    const current = this.internalRun(run.id),
      u = this.user(current.owner),
      c = this.consent(current.owner);
    check(
      active.includes(current.status),
      current.status === "cancelled" ? "RUN_CANCELLED" : "SCOPE_REVOKED",
      409,
    );
    check(
      c.granted &&
        c.version === current.consent_version &&
        u.epoch === current.epoch &&
        this.clock() < current.expires_at &&
        (!scope || scope.scope_epoch === current.scope_epoch),
      "SCOPE_REVOKED",
      403,
    );
    for (const sid of current.source_ids) this.get(current.owner, "source", sid);
    return current;
  }
  reserveRuntime(runId) {
    return this.transaction(() => {
      const r = this.checkScope(this.internalRun(runId));
      check(r.status === "running", "SCOPE_REVOKED", 403);
      check(!this.all("runtime_binding", r.owner).some((b) => b.run_id === runId), "SCOPE_REVOKED", 403);
      const sessionKey = "healththread:" + randomUUID();
      this.insert(r.owner, "runtime_binding", {
        run_id: runId,
        session_key: sessionKey,
        session_id: null,
        scope_epoch: r.scope_epoch,
        profile_revision: r.base_profile_revision,
        consent_version: r.consent_version,
        epoch: r.epoch,
        source_ids: r.source_ids,
        expires_at: Math.min(r.deadline, r.expires_at),
        revoked: false,
        repairs: [],
      });
      return sessionKey;
    });
  }
  runtimeBinding(runId, key) {
    const r = this.internalRun(runId),
      b = this.all("runtime_binding", r.owner).find((b) => b.run_id === runId && b.session_key === key);
    check(b && !b.revoked, "SCOPE_REVOKED", 403);
    return b;
  }
  checkRuntime(runId, key, { unbound = false } = {}) {
    const r = this.internalRun(runId),
      b = this.runtimeBinding(runId, key),
      u = this.user(r.owner),
      c = this.consent(r.owner);
    check(
      (unbound || b.session_id === key) &&
        ["running", "needs_review", "completed"].includes(r.status) &&
        !r.deleted &&
        r.scope_epoch === b.scope_epoch &&
        u.epoch === b.epoch &&
        u.revision === b.profile_revision &&
        c.granted &&
        c.version === b.consent_version &&
        this.clock() < b.expires_at,
      "SCOPE_REVOKED",
      403,
    );
    for (const sid of b.source_ids) this.get(r.owner, "source", sid);
    return b;
  }
  bindRuntimeSession(runId, key, sessionId) {
    return this.transaction(() => {
      const b = this.checkRuntime(runId, key, { unbound: true });
      check(sessionId === key && !b.session_id, "SCOPE_REVOKED", 403);
      b.session_id = sessionId;
      this.save("runtime_binding", b);
      return sessionId;
    });
  }
  revokeRuntime(runId, key) {
    return this.transaction(() => {
      const r = this.internalRun(runId),
        b = this.all("runtime_binding", r.owner).find((b) => b.run_id === runId && b.session_key === key);
      if (b) {
        b.revoked = true;
        this.save("runtime_binding", b);
      }
    });
  }
  recordRuntimeRepair(runId, key, rejection) {
    const exceeded = this.transaction(() => {
      const b = this.checkRuntime(runId, key);
      if (b.repairs.includes(rejection)) return false;
      check(typeof rejection === "string" && rejection.length < 100, "INVALID_AGENT_OUTPUT", 422);
      if (b.repairs.length >= 2) {
        b.revoked = true;
        this.save("runtime_binding", b);
        return true;
      }
      b.repairs.push(rejection);
      this.save("runtime_binding", b);
      const r = this.internalRun(runId);
      r.repair_attempts = b.repairs.length;
      this.save("run", r);
      return false;
    });
    if (exceeded) fail(422, "OUTPUT_REPAIR_EXHAUSTED");
  }
  runtimeStageOutcome(runId, key, name, args, receiptId) {
    const binding = this.checkRuntime(runId, key),
      run = this.internalRun(runId);
    check(
      ["healththread_stage_candidates", "healththread_stage_result"].includes(name),
      "AGH_RECEIPT_UNCORRELATED",
      422,
    );
    const operation = (name === "healththread_stage_candidates" ? "stage:" : "result:") + runId;
    const saved = this.db
      .prepare("SELECT request_hash,outcome FROM receipts WHERE owner=? AND operation=? AND key=?")
      .get(run.owner, operation, args.operation_key);
    const receipt = this.get(run.owner, "tool_receipt", receiptId);
    check(
      saved &&
        saved.request_hash === hash(canonical(args)) &&
        receipt.run_id === runId &&
        receipt.tool === name &&
        receipt.agh_session_id === binding.session_id &&
        receipt.args_hash === saved.request_hash,
      "AGH_RECEIPT_UNCORRELATED",
      422,
    );
    return JSON.parse(saved.outcome);
  }
  recordRuntimeDiagnostic(runId, key, diagnostic) {
    return this.transaction(() => {
      const r = this.internalRun(runId),
        b = this.all("runtime_binding", r.owner).find((b) => b.run_id === runId && b.session_key === key);
      if (b) {
        b.diagnostic = structuredClone(diagnostic);
        this.save("runtime_binding", b);
      }
    });
  }
  recordRuntimeEvidence(runId, key, evidence) {
    return this.transaction(() => {
      const b = this.checkRuntime(runId, key);
      b.evidence = structuredClone(evidence);
      this.save("runtime_binding", b);
    });
  }
  toolsFor(runId, invocation) {
    const scope = this.internalRun(runId);
    const call = (name, args, fn, write = false) => {
      args = structuredClone(args);
      const execute = () => {
        const current = this.internalRun(scope.id);
        if (invocation) {
          this.checkRuntime(scope.id, invocation.session_key);
          check(
            typeof invocation.tool_use_id === "string" && invocation.tool_use_id.length > 0,
            "SCOPE_REVOKED",
            403,
          );
        }
        if (write && args?.operation_key) {
          const operation = `${name === "healththread_stage_candidates" ? "stage" : "result"}:${scope.id}`;
          const previous = this.db
            .prepare("SELECT * FROM receipts WHERE owner=? AND operation=? AND key=?")
            .get(scope.owner, operation, args.operation_key);
          if (previous) {
            const u = this.user(scope.owner),
              c = this.consent(scope.owner);
            check(
              c.granted &&
                c.version === current.consent_version &&
                u.epoch === current.epoch &&
                scope.scope_epoch === current.scope_epoch &&
                !current.deleted &&
                this.clock() < current.expires_at &&
                ["needs_review", "completed", "running"].includes(current.status),
              "SCOPE_REVOKED",
              403,
            );
            check(previous.request_hash === hash(canonical(args)), "IDEMPOTENCY_CONFLICT", 409);
            const receipt = this.all("tool_receipt", scope.owner).find(
              (x) => x.run_id === scope.id && x.tool === name,
            );
            return { ...JSON.parse(previous.outcome), receipt };
          }
        }
        const run = this.checkScope(scope, scope);
        check(run.status === "running", "SCOPE_REVOKED", 409);
        check(
          args &&
            typeof args === "object" &&
            !Object.keys(args).some((k) => ["owner", "user_id", "token", "path"].includes(k)),
          "INVALID_AGENT_OUTPUT",
          422,
        );
        const out = fn(run, args);
        const latest = this.internalRun(run.id);
        if (out.source) latest.read_sources = [...new Set([...(latest.read_sources || []), out.source.id])];
        if (out.facts)
          latest.read_facts = [
            ...(latest.read_facts || []),
            ...out.facts.map((f) => ({ fact_id: f.fact_id, revision: f.revision })),
          ].filter(
            (f, i, a) => a.findIndex((x) => x.fact_id === f.fact_id && x.revision === f.revision) === i,
          );
        if (out.sources)
          latest.read_sources = [
            ...new Set([...(latest.read_sources || []), ...out.sources.map((s) => s.id)]),
          ];
        if (out.instructions)
          latest.read_facts = out.instructions.map((f) => ({ fact_id: f.fact_id, revision: f.revision }));
        const receipt = this.insert(run.owner, "tool_receipt", {
          tool: name,
          run_id: run.id,
          operation_id: out.operation_id || id("op"),
          snapshot_revision: this.user(run.owner).revision,
          recorded_at: this.now(),
          validation: "passed",
          ...(invocation
            ? {
                agh_session_id: invocation.session_key,
                agh_tool_use_id: invocation.tool_use_id,
                args_hash: hash(canonical(args)),
              }
            : {}),
        });
        latest.tool_receipts.push(receipt.id);
        this.save("run", latest);
        return { ...out, receipt };
      };
      return write ? this.transaction(execute) : this.transaction(execute);
    };
    const read = (run, sid) => {
      check(run.source_ids.includes(sid), "NOT_FOUND", 404);
      return this.get(run.owner, "source", sid);
    };
    return Object.freeze({
      healththread_read_source: (args) =>
        call("healththread_read_source", args, (r, a) => {
          keys(a, ["source_id"]);
          const source = read(r, a.source_id);
          return {
            source,
            sentence_spans: sentenceSpans(source),
            sentence_annotations: sentenceAnnotations(source),
          };
        }),
      healththread_retrieve_context: (args) =>
        call("healththread_retrieve_context", args, (r, a) => {
          keys(a, ["query", "episode_id", "source_ids"], []);
          check(!a.query || (typeof a.query === "string" && a.query.length <= 1000));
          const ids = a.source_ids || [];
          check(Array.isArray(ids) && ids.length <= this.limits.retrievalCount);
          if (a.episode_id) this.get(r.owner, "episode", a.episode_id);
          const p = this.profile(r.owner),
            sources = ids.map((s) => read(r, s));
          const query = (a.query || "").normalize("NFKC").toLowerCase().trim();
          const facts = p.facts.filter(
            (f) =>
              (!query || f.value.normalize("NFKC").toLowerCase().includes(query)) &&
              (!ids.length || f.evidence.some((e) => ids.includes(e.source_id))) &&
              (!a.episode_id || f.episode_id === a.episode_id),
          );
          return {
            facts: facts.slice(0, this.limits.retrievalCount),
            sources,
            conflicts: p.pending_changes.map((c) => ({ id: c.id, conflicts: c.conflicts })),
            snapshot_revision: p.profile_revision,
          };
        }),
      healththread_stage_candidates: (args) =>
        call("healththread_stage_candidates", args, (r, a) => this.stageCandidates(r, a, read), true),
      healththread_get_confirmed_instructions: (args) =>
        call("healththread_get_confirmed_instructions", args, (r, a) => {
          keys(a, ["document_id"]);
          check(r.workflow === "care_plan" && a.document_id === r.document_id, "NOT_FOUND", 404);
          const doc = this.get(r.owner, "document", a.document_id);
          read(r, doc.source_id);
          return {
            instructions: this.profile(r.owner).facts.filter(
              (f) => f.field === "instruction" && f.evidence.some((e) => e.source_id === doc.source_id),
            ),
          };
        }),
      healththread_stage_result: (args) =>
        call("healththread_stage_result", args, (r, a) => this.stageResult(r, a, read), true),
    });
  }
  stageCandidates(run, args, read) {
    keys(args, ["candidates", "base_profile_revision", "operation_key"]);
    check(["entry", "document"].includes(run.workflow), "INVALID_AGENT_OUTPUT", 422);
    return this.receipt(run.owner, `stage:${run.id}`, args.operation_key, args, () => {
      check(
        args.base_profile_revision === run.base_profile_revision &&
          args.base_profile_revision === this.user(run.owner).revision,
        "REVISION_CONFLICT",
        409,
      );
      check(Array.isArray(args.candidates) && args.candidates.length <= 100, "INVALID_AGENT_OUTPUT", 422);
      check(Buffer.byteLength(JSON.stringify(args)) <= this.limits.outputBytes, "INVALID_AGENT_OUTPUT", 422);
      const readTools = this.all("tool_receipt", run.owner)
        .filter((x) => x.run_id === run.id)
        .map((x) => x.tool);
      check(
        readTools.includes("healththread_read_source") && readTools.includes("healththread_retrieve_context"),
        "TOOL_SEQUENCE_REQUIRED",
        422,
      );
      const proposals = args.candidates.map((c, i) => {
        for (const field of ["fact_id", "episode_id", "expected_version"])
          if (Object.hasOwn(c, field))
            fail(422, "INVALID_AGENT_OUTPUT", "新增候选不得自行指定事实标识、版本或事件。", {
              path: `candidates[${i}].${field}`,
              rule: "Omit this field for new proposals; server assigns identities.",
            });
        check(c.proposal_kind === "new", "INVALID_AGENT_OUTPUT", 422);
        return {
          ...validateCandidate(c, (s) => {
            check(run.read_sources?.includes(s), "INVALID_AGENT_OUTPUT", 422);
            return read(run, s);
          }),
          id: id("candidate"),
        };
      });
      const spans = new Set();
      for (const proposal of proposals)
        for (const evidence of proposal.evidence) {
          const span = canonical({
            source_id: evidence.source_id,
            source_text_version: evidence.source_text_version,
            locator: evidence.locator,
            value: proposal.value,
          });
          check(!spans.has(span), "INVALID_AGENT_OUTPUT", 422);
          spans.add(span);
        }
      const change = this.insert(run.owner, "fact_change", {
        run_id: run.id,
        source_ids: run.source_ids,
        base_profile_revision: args.base_profile_revision,
        epoch: run.epoch,
        consent_version: run.consent_version,
        status: "pending",
        kind: "new",
        proposals,
        conflicts: [],
        created_at: this.now(),
        document_id: run.document_id,
      });
      run.fact_change_id = change.id;
      run.status = "needs_review";
      run.phase = "review";
      this.save("run", run);
      this.finishDispatch(run);
      return { fact_change_id: change.id, status: "needs_review" };
    });
  }
  confirm(uid, changeId, body, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `confirm:${changeId}`, key, body, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const change = this.get(uid, "fact_change", changeId),
          u = this.user(uid),
          c = this.requireConsent(uid);
        check(change.status === "pending", "REVISION_CONFLICT", 409);
        check(change.epoch === u.epoch && change.consent_version === c.version, "SCOPE_REVOKED", 403);
        check(
          body.expected_profile_revision === u.revision && change.base_profile_revision === u.revision,
          "REVISION_CONFLICT",
          409,
        );
        check(
          Array.isArray(body.accepted_change_ids) &&
            new Set(body.accepted_change_ids).size === body.accepted_change_ids.length &&
            body.accepted_change_ids.every((i) => change.proposals.some((p) => p.id === i)),
        );
        if (change.run_id) {
          const run = this.get(uid, "run", change.run_id);
          check(run.status === "needs_review", "SCOPE_REVOKED", 409);
        }
        const selected = change.proposals.filter((p) => body.accepted_change_ids.includes(p.id));
        for (const sid of change.source_ids) this.get(uid, "source", sid);
        for (const p of selected) {
          const clean = { ...p };
          delete clean.id;
          validateCandidate(clean, (sid) => this.get(uid, "source", sid));
          let previous = null;
          if (p.fact_id) {
            previous = this.profile(uid).facts.find((f) => f.fact_id === p.fact_id);
            check(previous && previous.revision === p.expected_version, "REVISION_CONFLICT", 409);
          }
          const factId = p.fact_id || id("fact");
          this.insert(uid, "fact_revision", {
            ...clean,
            episode_id:
              previous?.episode_id ||
              this.all("entry", uid).find((e) => e.source_id === clean.evidence[0].source_id)?.episode_id ||
              null,
            fact_id: factId,
            revision: (previous?.revision || 0) + 1,
            supersedes_revision: previous?.revision || null,
            review_status: p.proposal_kind === "retraction" ? "retracted" : "confirmed",
            confirmed_at: this.now(),
            change_id: change.id,
          });
        }
        if (selected.length) this.db.prepare("UPDATE users SET revision=revision+1 WHERE id=?").run(uid);
        const revision = this.user(uid).revision;
        change.status = selected.length ? "confirmed" : "rejected";
        change.accepted_change_ids = body.accepted_change_ids;
        change.confirmed_at = this.now();
        this.save("fact_change", change);
        if (selected.length) this.invalidateProfileDependents(uid);
        if (change.run_id) {
          const r = this.get(uid, "run", change.run_id);
          r.status = "completed";
          r.phase = "confirmed";
          this.save("run", r);
          this.finishDispatch(r);
        }
        const audit = this.insert(uid, "audit", {
          kind: "confirm",
          change_id: change.id,
          profile_revision: revision,
          accepted_change_ids: body.accepted_change_ids,
          recorded_at: this.now(),
        });
        const operation = this.insert(uid, "operation", {
          kind: "confirm",
          status: "committed",
          fact_change_id: change.id,
          profile_revision: revision,
          audit_id: audit.id,
          recorded_at: this.now(),
        });
        let continuation = null;
        if (change.document_id && selected.length) {
          const doc = this.get(uid, "document", change.document_id);
          const r = this.newRun(uid, "care_plan", [doc.source_id], {
            document_id: doc.id,
            parent_run_id: change.run_id,
          });
          this.queueRun(r, operation.id);
          continuation = r.id;
        }
        return {
          profile_revision: revision,
          commit_receipt: operation.id,
          operation_id: operation.id,
          ...(continuation ? { continuation_run_id: continuation } : {}),
        };
      }),
    );
  }
  reject(uid, changeId, body, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `reject:${changeId}`, key, body, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const change = this.get(uid, "fact_change", changeId),
          user = this.user(uid),
          consent = this.requireConsent(uid);
        check(change.status === "pending", "REVISION_CONFLICT", 409);
        check(
          change.epoch === user.epoch && change.consent_version === consent.version,
          "SCOPE_REVOKED",
          403,
        );
        // Rejection creates no fact: compare the user's current snapshot, not the proposal's old base.
        check(body.expected_profile_revision === user.revision, "REVISION_CONFLICT", 409);
        if (change.run_id)
          check(this.get(uid, "run", change.run_id).status === "needs_review", "SCOPE_REVOKED", 409);
        change.status = "rejected";
        change.accepted_change_ids = [];
        change.confirmed_at = this.now();
        this.save("fact_change", change);
        if (change.run_id) {
          const run = this.get(uid, "run", change.run_id);
          run.status = "completed";
          run.phase = "rejected";
          run.scope_epoch++;
          this.save("run", run);
          this.finishDispatch(run);
        }
        const audit = this.insert(uid, "audit", {
          kind: "reject",
          change_id: change.id,
          profile_revision: user.revision,
          recorded_at: this.now(),
        });
        const operation = this.insert(uid, "operation", {
          kind: "reject",
          status: "committed",
          fact_change_id: change.id,
          profile_revision: user.revision,
          audit_id: audit.id,
          recorded_at: this.now(),
        });
        return { profile_revision: user.revision, commit_receipt: operation.id, operation_id: operation.id };
      }),
    );
  }
  reanalyse(uid, runId, body, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `reanalyse:${runId}`, key, body, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const old = this.get(uid, "run", runId),
          user = this.user(uid),
          consent = this.requireConsent(uid);
        check(body.expected_profile_revision === user.revision, "REVISION_CONFLICT", 409);
        check(
          old.status === "needs_review" && !old.deleted && old.fact_change_id,
          "RUN_NOT_REANALYSABLE",
          409,
        );
        check(old.epoch === user.epoch && old.consent_version === consent.version, "SCOPE_REVOKED", 403);
        const change = this.get(uid, "fact_change", old.fact_change_id);
        check(change.status === "pending", "REVISION_CONFLICT", 409);
        for (const sid of old.source_ids) this.get(uid, "source", sid);
        this.checkQueueAdmission(uid);
        // Expire the old proposal and scope atomically; never rebase its values into current facts.
        old.status = "cancelled";
        old.phase = "reanalysed";
        old.scope_epoch++;
        this.save("run", old);
        this.finishDispatch(old);
        const run = this.newRun(uid, old.workflow, old.source_ids, {
          document_id: old.document_id,
          parent_run_id: old.id,
        });
        change.status = "expired";
        change.terminal_reason = "reanalysed";
        change.expired_at = this.now();
        change.superseded_by_run_id = run.id;
        this.save("fact_change", change);
        const operation = this.insert(uid, "operation", {
          kind: "reanalyse",
          status: "committed",
          run_id: run.id,
          previous_run_id: old.id,
          source_id: old.source_ids[0],
          expired_fact_change_id: change.id,
          saved: true,
          recorded_at: this.now(),
        });
        this.queueRun(run, operation.id);
        return {
          run_id: run.id,
          source_id: old.source_ids[0],
          operation_id: operation.id,
          expired_fact_change_id: change.id,
          saved: true,
        };
      }),
    );
  }
  invalidate(uid, predicate, status) {
    for (const type of ["result", "care_task"])
      for (const item of this.all(type, uid))
        if (predicate(item)) {
          item.status = type === "result" ? status : item.status;
          item.validity = status;
          this.save(type, item);
        }
  }
  invalidateProfileDependents(uid) {
    const facts = this.profile(uid).facts;
    const validDependencies = (item) =>
      (item.dependencies || []).every((dep) => {
        if (dep.fact_id)
          return facts.some(
            (f) => f.fact_id === dep.fact_id && f.revision === dep.revision && f.field === "instruction",
          );
        return this.all("source", uid).some(
          (source) => source.id === dep.source_id && source.text_version === dep.source_text_version,
        );
      });
    // Visits depend on the whole profile. Care remains usable only with unchanged
    // instruction/source dependencies; previously stale tasks are never revived.
    this.invalidate(uid, (item) => item.kind === "visit_preparation" || !validDependencies(item), "stale");
  }
  stageResult(run, args, read) {
    keys(args, ["kind", "payload", "dependencies", "operation_key"]);
    return this.receipt(run.owner, `result:${run.id}`, args.operation_key, args, () => {
      check(Buffer.byteLength(JSON.stringify(args)) <= this.limits.outputBytes, "INVALID_AGENT_OUTPUT", 422);
      check(
        (run.workflow === "visit" && args.kind === "visit_preparation") ||
          (run.workflow === "care_plan" && args.kind === "care_plan"),
        "INVALID_AGENT_OUTPUT",
        422,
      );
      check(this.user(run.owner).revision === run.base_profile_revision, "REVISION_CONFLICT", 409);
      check(Array.isArray(args.dependencies) && args.dependencies.length <= 100, "INVALID_AGENT_OUTPUT", 422);
      const facts = this.profile(run.owner).facts;
      const seenTools = this.all("tool_receipt", run.owner)
        .filter((x) => x.run_id === run.id)
        .map((x) => x.tool);
      check(
        run.workflow === "visit"
          ? seenTools.includes("healththread_read_source") &&
              seenTools.includes("healththread_retrieve_context")
          : seenTools.includes("healththread_get_confirmed_instructions"),
        "TOOL_SEQUENCE_REQUIRED",
        422,
      );
      const factRef = (ref) => {
        keys(ref, ["fact_id", "revision"]);
        const f = facts.find((f) => f.fact_id === ref.fact_id && f.revision === ref.revision);
        check(
          f && run.read_facts?.some((r) => r.fact_id === ref.fact_id && r.revision === ref.revision),
          "INVALID_AGENT_OUTPUT",
          422,
        );
        return f;
      };
      for (const dep of args.dependencies) {
        if (dep.fact_id) factRef(dep);
        else {
          keys(dep, ["source_id", "source_text_version"]);
          check(
            run.read_sources?.includes(dep.source_id) &&
              read(run, dep.source_id).text_version === dep.source_text_version,
            "INVALID_AGENT_OUTPUT",
            422,
          );
        }
      }
      const hasFact = (ref) =>
        args.dependencies.some((d) => d.fact_id === ref.fact_id && d.revision === ref.revision);
      const payload = structuredClone(args.payload);
      if (args.kind === "visit_preparation") {
        keys(
          payload,
          ["speech", "questions", "unknowns", "claims"],
          ["speech", "questions", "unknowns", "claims"],
        );
        check(
          typeof payload.speech === "string" &&
            payload.speech.length <= 20000 &&
            Array.isArray(payload.questions) &&
            payload.questions.every((x) => typeof x === "string" && x.length <= 1000) &&
            payload.questions.length <= 20 &&
            Array.isArray(payload.unknowns) &&
            payload.unknowns.every((x) => typeof x === "string" && x.length <= 1000) &&
            payload.unknowns.length <= 30 &&
            Array.isArray(payload.claims) &&
            payload.claims.length <= 100,
          "INVALID_AGENT_OUTPUT",
          422,
        );
        check(
          payload.questions.every(
            (q) =>
              /[？?]$/.test(q) &&
              !/(请服|请用|停药|加量|减量|[0-9一二三四五六七八九十]+\s*(?:mg|ml|毫克|毫升|片|粒|次|天|周))/i.test(
                q,
              ),
          ),
          "INVALID_AGENT_OUTPUT",
          422,
        );
        check(
          payload.claims.some(
            (c) =>
              Array.isArray(c.evidence) &&
              c.evidence.some((e) => e.source_id === run.source_ids[0] && e.quote === c.text),
          ),
          "INVALID_AGENT_OUTPUT",
          422,
        );
        const supported = [];
        for (const claim of payload.claims) {
          keys(claim, ["text", "fact_refs", "evidence"]);
          check(
            typeof claim.text === "string" && Array.isArray(claim.fact_refs) && Array.isArray(claim.evidence),
            "INVALID_AGENT_OUTPUT",
            422,
          );
          const quotes = claim.fact_refs.map((ref) => {
            check(hasFact(ref), "INVALID_AGENT_OUTPUT", 422);
            return factRef(ref).value;
          });
          if (claim.evidence.length) {
            for (const { evidence: e } of validateEvidence(claim.evidence, (sid) => read(run, sid))) {
              check(
                args.dependencies.some(
                  (d) => d.source_id === e.source_id && d.source_text_version === e.source_text_version,
                ),
                "INVALID_AGENT_OUTPUT",
                422,
              );
              quotes.push(e.quote);
            }
          }
          check(
            quotes.length > 0 && quotes.every((quote) => quote === claim.text),
            "INVALID_AGENT_OUTPUT",
            422,
          );
          supported.push(claim.text);
        }
        // Only source-supported sentences may be asserted in the speech. Questions/unknowns remain explicitly questions.
        check(payload.speech === supported.join("\n"), "INVALID_AGENT_OUTPUT", 422);
        payload.department = { status: "not_configured" };
        payload.triage = { status: "not_configured" };
      } else {
        keys(payload, ["tasks", "explanation"], ["tasks"]);
        check(Array.isArray(payload.tasks) && payload.tasks.length <= 100, "INVALID_AGENT_OUTPUT", 422);
        const seen = new Set();
        for (const task of payload.tasks) {
          keys(task, ["text", "instruction_refs", "schedule"]);
          check(
            typeof task.text === "string" &&
              Array.isArray(task.instruction_refs) &&
              task.instruction_refs.length > 0,
            "INVALID_AGENT_OUTPUT",
            422,
          );
          const instructions = task.instruction_refs.map((ref) => {
            check(hasFact(ref), "INVALID_AGENT_OUTPUT", 422);
            const f = factRef(ref);
            check(
              f.field === "instruction" && f.evidence.some((e) => run.source_ids.includes(e.source_id)),
              "INVALID_AGENT_OUTPUT",
              422,
            );
            return f;
          });
          check(
            instructions.every((i) => i.value === task.text) && !seen.has(task.text),
            "INVALID_AGENT_OUTPUT",
            422,
          );
          seen.add(task.text);
          for (const instruction of instructions) {
            validateSourceTime(
              instruction.effective_time,
              instruction.value,
              instruction.evidence.map((evidence) => evidence.source_id),
            );
          }
          check(
            instructions.every((instruction) => task.schedule === instruction.effective_time.raw),
            "INVALID_AGENT_OUTPUT",
            422,
          );
        }
        const confirmed = facts.filter(
          (f) => f.field === "instruction" && f.evidence.some((e) => run.source_ids.includes(e.source_id)),
        );
        check(
          confirmed.every((f) =>
            payload.tasks.some(
              (t) =>
                t.text === f.value &&
                t.instruction_refs.some((r) => r.fact_id === f.fact_id && r.revision === f.revision),
            ),
          ),
          "INVALID_AGENT_OUTPUT",
          422,
        );
        if (!payload.tasks.length)
          check(
            typeof payload.explanation === "string" && payload.explanation.trim().length > 0,
            "INVALID_AGENT_OUTPUT",
            422,
          );
      }
      const result = this.insert(run.owner, "result", {
        kind: args.kind,
        schema_version: 1,
        payload,
        dependencies: args.dependencies,
        status: "current",
        validity: "current",
        run_id: run.id,
        source_ids: run.source_ids,
        created_at: this.now(),
      });
      if (args.kind === "care_plan")
        for (const task of payload.tasks)
          this.insert(run.owner, "care_task", {
            ...task,
            document_id: run.document_id,
            result_id: result.id,
            dependencies: args.dependencies,
            source_ids: run.source_ids,
            status: "open",
            validity: "current",
            version: 1,
          });
      run.result_id = result.id;
      run.result_ref = result.id;
      run.status = "completed";
      run.phase = "completed";
      this.save("run", run);
      this.finishDispatch(run);
      return { result_id: result.id, status: "completed" };
    });
  }
  retry(uid, runId, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `retry:${runId}`, key, {}, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const previous = this.get(uid, "run", runId);
        this.requireConsent(uid);
        check(["failed", "blocked", "interrupted"].includes(previous.status), "RUN_NOT_RETRYABLE", 409);
        check(!previous.deleted && !previous.fact_change_id && !previous.result_id, "RUN_NOT_RETRYABLE", 409);
        for (const sid of previous.source_ids) this.get(uid, "source", sid);
        check(previous.source_ids.length > 0, "RUN_NOT_RETRYABLE", 409);
        this.checkQueueAdmission(uid);
        const run = this.newRun(uid, previous.workflow, previous.source_ids, {
          document_id: previous.document_id,
          parent_run_id: previous.id,
        });
        const op = this.insert(uid, "operation", {
          kind: "retry",
          status: "committed",
          run_id: run.id,
          previous_run_id: previous.id,
          source_id: previous.source_ids[0],
          saved: true,
          recorded_at: this.now(),
        });
        this.queueRun(run, op.id);
        return { run_id: run.id, source_id: previous.source_ids[0], operation_id: op.id, saved: true };
      }),
    );
  }
  cancel(uid, runId, expectedEpoch) {
    return this.transaction(() => {
      this.checkExpectedEpoch(uid, expectedEpoch);
      const r = this.get(uid, "run", runId);
      if (active.includes(r.status)) {
        r.status = "cancelled";
        r.phase = "cancelled";
        r.scope_epoch++;
        this.save("run", r);
        this.finishDispatch(r);
        this.expireCheckpoints(uid, "run_cancelled", r.id);
      }
      return r;
    });
  }
  failRun(runId, code, status = "failed") {
    return this.transaction(() => {
      const r = this.internalRun(runId);
      if (["queued", "running"].includes(r.status)) {
        r.status = status;
        r.phase = "agent";
        r.error = runError(code, "agent");
        r.scope_epoch++;
        this.save("run", r);
        this.finishDispatch(r);
      }
      return r;
    });
  }
  setRuntime(runId, metadata) {
    return this.transaction(() => {
      const r = this.internalRun(runId);
      check(["running", "needs_review", "completed"].includes(r.status), "SCOPE_REVOKED", 409);
      const u = this.user(r.owner);
      check(u.epoch === r.epoch && this.consent(r.owner).version === r.consent_version, "SCOPE_REVOKED", 403);
      r.runtime = metadata;
      this.save("run", r);
      return r;
    });
  }
  careTasks(uid) {
    this.user(uid);
    return { tasks: this.all("care_task", uid) };
  }
  updateTask(uid, taskId, body, expectedEpoch) {
    return this.transaction(() => {
      this.checkExpectedEpoch(uid, expectedEpoch);
      const t = this.get(uid, "care_task", taskId);
      check(["open", "done", "paused"].includes(body.status));
      check(t.version === body.expected_version, "REVISION_CONFLICT", 409);
      check(t.validity === "current", "STALE_DEPENDENCY", 409);
      t.status = body.status;
      t.version++;
      return this.save("care_task", t);
    });
  }
  changeRequest(uid, factId, body, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `change:${factId}`, key, body, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const u = this.user(uid),
          consent = this.requireConsent(uid),
          fact = this.profile(uid).facts.find((f) => f.fact_id === factId);
        check(fact, "NOT_FOUND", 404);
        check(fact.revision === body.expected_version, "REVISION_CONFLICT", 409);
        check(["correction", "retraction"].includes(body.kind));
        const text = this.text(body.text);
        const s = this.insert(uid, "source", {
          kind: "self_report",
          text,
          text_version: 1,
          content_hash: hash(text),
          pages: [],
          recorded_at: this.now(),
          input_kind: "self_report",
        });
        this.insert(uid, "entry", {
          source_id: s.id,
          input_kind: "self_report",
          received_at: this.now(),
          raw_time_text: null,
        });
        // A user-authored change is also reviewed; it can only replace with literal reported text, never infer a clinical field.
        const markers = classifySourceMarkers(text);
        const p = {
          field: "reported_text",
          value: text,
          assertion: markers.assertion,
          temporal_scope: markers.temporal_scope,
          effective_time: literalSourceTime(text, s.id),
          evidence: [
            {
              source_id: s.id,
              source_text_version: 1,
              locator: { page: null, start: 0, end: text.length },
              quote: text,
            },
          ],
          proposal_kind: body.kind,
          fact_id: factId,
          expected_version: fact.revision,
        };
        validateCandidate(p, (sid) => this.get(uid, "source", sid));
        const change = this.insert(uid, "fact_change", {
          run_id: null,
          source_ids: [s.id, ...fact.evidence.map((e) => e.source_id)],
          base_profile_revision: u.revision,
          epoch: u.epoch,
          consent_version: consent.version,
          status: "pending",
          kind: body.kind,
          proposals: [{ ...p, id: id("candidate") }],
          conflicts: [],
          before: fact,
          created_at: this.now(),
        });
        const operation = this.insert(uid, "operation", {
          kind: "change_request",
          status: "committed",
          source_id: s.id,
          fact_change_id: change.id,
          saved: true,
        });
        return { source_id: s.id, fact_change_id: change.id, operation_id: operation.id, saved: true };
      }),
    );
  }
  exportData(uid) {
    this.user(uid);
    const out = { schema_version: 1, exported_at: this.now(), profile: this.profile(uid) };
    for (const [name, type] of Object.entries({
      sources: "source",
      entries: "entry",
      documents: "document",
      episodes: "episode",
      fact_revisions: "fact_revision",
      fact_changes: "fact_change",
      results: "result",
      care_tasks: "care_task",
      runs: "run",
      consents: "consent",
      audit: "audit",
      operations: "operation",
    }))
      out[name] = this.all(type, uid);
    out.originals = this.db
      .prepare("SELECT source_id,bytes FROM originals WHERE owner=?")
      .all(uid)
      .map((x) => ({
        source_id: x.source_id,
        media_type: "application/pdf",
        base64: Buffer.from(x.bytes).toString("base64"),
      }));
    return out;
  }
  deleteData(uid, sourceId, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `delete:${sourceId}`, key, { source_id: sourceId }, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        this.user(uid);
        if (sourceId !== "all") this.get(uid, "source", sourceId);
        const sourceIds = sourceId === "all" ? this.all("source", uid).map((s) => s.id) : [sourceId];
        this.db
          .prepare(
            "UPDATE users SET epoch=epoch+1,revision=revision+1,all_clear_epoch=all_clear_epoch+? WHERE id=?",
          )
          .run(sourceId === "all" ? 1 : 0, uid);
        for (const r of this.all("run", uid))
          if (active.includes(r.status)) {
            r.status = "cancelled";
            r.phase = "deleted";
            r.scope_epoch++;
            this.save("run", r);
            this.finishDispatch(r);
          }
        const related = (obj) =>
          sourceId === "all" ||
          sourceIds.includes(obj.id) ||
          sourceIds.includes(obj.source_id) ||
          obj.source_ids?.some((s) => sourceIds.includes(s)) ||
          obj.evidence?.some((e) => sourceIds.includes(e.source_id));
        this.expireCheckpoints(uid, "source_scope_changed");
        const removedFacts = new Set(
          this.all("fact_revision", uid)
            .filter(related)
            .map((f) => f.fact_id),
        );
        const types = [
          "runtime_binding",
          "fact_revision",
          "fact_change",
          "result",
          "care_task",
          "entry",
          "document",
          "episode",
          "source",
        ];
        const objects = types.flatMap((type) => this.all(type, uid));
        const removed = new Set();
        let expanded = true;
        while (expanded) {
          expanded = false;
          for (const obj of objects) {
            if (removed.has(obj.id)) continue;
            const dependent =
              related(obj) ||
              removedFacts.has(obj.fact_id) ||
              obj.dependencies?.some((d) => removedFacts.has(d.fact_id) || sourceIds.includes(d.source_id)) ||
              obj.proposals?.some(
                (p) =>
                  removedFacts.has(p.fact_id) || p.evidence?.some((e) => sourceIds.includes(e.source_id)),
              ) ||
              removed.has(obj.result_id) ||
              removed.has(obj.fact_change_id);
            if (dependent) {
              removed.add(obj.id);
              expanded = true;
            }
          }
        }
        for (const objectId of removed)
          this.db.prepare("DELETE FROM objects WHERE id=? AND owner=?").run(objectId, uid);
        for (const sid of sourceIds)
          this.db.prepare("DELETE FROM originals WHERE source_id=? AND owner=?").run(sid, uid);
        for (const run of this.all("run", uid)) {
          const direct = related(run),
            indirect =
              removed.has(run.result_id) || removed.has(run.result_ref) || removed.has(run.fact_change_id);
          if (!direct && !indirect) continue;
          run.fact_change_id = null;
          run.result_id = null;
          run.result_ref = null;
          run.scope_epoch++;
          run.status = "cancelled";
          run.phase = direct ? "deleted" : "result_withdrawn";
          run.runtime = run.runtime ? { mode: run.runtime.mode, trace_erasure: "unverified" } : undefined;
          if (direct) {
            run.source_ids = [];
            run.document_id = null;
            run.deleted = true;
          }
          // The independent concern survives, while deleted generated text and refs do not.
          this.save("run", run);
          this.finishDispatch(run);
        }
        this.db.prepare("DELETE FROM objects WHERE owner=? AND type='tool_receipt'").run(uid);
        for (const op of this.all("operation", uid))
          if (
            related(op) ||
            removed.has(op.fact_change_id) ||
            removed.has(op.expired_fact_change_id) ||
            removed.has(op.result_id)
          ) {
            op.deleted = true;
            op.saved = false;
            for (const field of ["fact_change_id", "expired_fact_change_id", "result_id"])
              if (removed.has(op[field])) op[field] = null;
            this.save("operation", op);
          }
        const job = this.insert(uid, "deletion_job", {
          scope: sourceId,
          status: "partial",
          layers: {
            sqlite: { status: "deleted", sources: sourceIds.length },
            originals: { status: "deleted" },
            agh: { status: "unverified", reason: "Remote session traces cannot be certified erased." },
            backups: {
              status: "unverified",
              reason: "External snapshots and SQLite storage remnants require host retention policy.",
            },
          },
          recorded_at: this.now(),
        });
        return { deletion_job_id: job.id, status: "partial", layers: job.layers };
      }),
    );
  }
}
