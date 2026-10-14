import {validateRunHealthState,supersededHealthSources,currentDocumentEvidence} from './health-state.mjs';
import {validateAutomaticRecord,validateOverview,normalizeOptionalObservations,finalizeAutomaticRecords,currentOverview,queueOverviewRefresh} from './automatic-records.mjs';
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, randomBytes, createHash, scryptSync, timingSafeEqual } from "node:crypto";
import { check, fail, LIMITS } from "./domain-errors.mjs";
import {attachComparisons,buildHealthProfile,correctionObservations,candidateContent,resolveProposals,refreshPendingComparisons,reviewable,feedbackContext} from './health-profile.mjs';
import {acceptRecordTurn,stageRecordSummary,checkRecordConfirmation,finishRecordConfirmation,recordThreads,checkRecordRetry,updateRecordRetry} from './record-dialogue.mjs';
import {
  keys,
  validateCandidate,
  validateEvidence,
  sentenceSpans,
  sentenceAnnotations,
  materializeSentenceCandidate,
  classifySourceMarkers,
  literalSourceTime,
  validateSourceTime,
  validateCareExplanation,
} from "./source-validation.mjs";
const indexedSentences = (source) => {
  const annotations=sentenceAnnotations(source);
  return sentenceSpans(source).map((span,sentence_index)=>({source_id:source.id,sentence_index,quote:span.quote,assertion:annotations[sentence_index].assertion,temporal_scope:annotations[sentence_index].temporal_scope,unsupported:annotations[sentence_index].unsupported,ambiguous:annotations[sentence_index].ambiguous}));
};
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
   CREATE TRIGGER IF NOT EXISTS immutable_transcript BEFORE UPDATE ON objects WHEN OLD.type='document_transcript' BEGIN SELECT RAISE(ABORT,'immutable_transcript'); END;
   CREATE TRIGGER IF NOT EXISTS immutable_source BEFORE UPDATE ON objects WHEN OLD.type='source' BEGIN SELECT RAISE(ABORT,'immutable_source'); END;
   CREATE TRIGGER IF NOT EXISTS immutable_input_records BEFORE UPDATE ON objects WHEN OLD.type IN ('entry','document','episode') BEGIN SELECT RAISE(ABORT,'immutable_input_record'); END;
   CREATE TRIGGER IF NOT EXISTS immutable_fact_revision BEFORE UPDATE ON objects WHEN OLD.type='fact_revision' BEGIN SELECT RAISE(ABORT,'immutable_fact_revision'); END;`);
    this.db.exec("CREATE TRIGGER IF NOT EXISTS immutable_record_summary BEFORE UPDATE ON objects WHEN OLD.type='record_summary' BEGIN SELECT RAISE(ABORT,'immutable_record_summary'); END;");
    this.db.exec("CREATE TRIGGER IF NOT EXISTS immutable_care_feedback BEFORE UPDATE ON objects WHEN OLD.type='care_feedback' BEGIN SELECT RAISE(ABORT,'immutable_care_feedback'); END;");
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
      // Add durable conversation metadata to the initial chat implementation's results.
      // Content and inference receipts remain untouched.
      for (const result of this.all("result")) if (result.kind === "assistant_reply" && !result.conversation_id) {
        const prior = this.db.prepare("SELECT data FROM objects WHERE id=? AND owner=? AND type='run'").get(result.run_id, result.owner);
        const conversationId = prior && JSON.parse(prior.data).conversation_id;
        if (conversationId) {result.conversation_id=conversationId;this.save("result",result);}
      }
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
  acceptRecordTurn(uid,input,key,epoch){return acceptRecordTurn(this,uid,input,key,epoch);}
  recordThreads(uid){return recordThreads(this,uid);}
  editRecord(uid,threadId,body,key,epoch){
    keys(body,['text','expected_version']);this.get(uid,'record_thread',threadId);
    return this.acceptRecordTurn(uid,{text:body.text,record_thread_id:threadId,expected_version:body.expected_version,record_edit:true},key,epoch);
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
  register(input) {
    check(input && typeof input === "object" && !Array.isArray(input) &&
      Object.keys(input).every(key => ["username", "password"].includes(key)), "INVALID_REGISTRATION");
    const username = typeof input.username === "string" ? input.username.trim() : "";
    if (!/^[A-Za-z0-9_.-]{3,32}$/.test(username))
      fail(400, "INVALID_USERNAME", "账号需为 3–32 位，可使用字母、数字、点、下划线或短横线。");
    const passwordLength = typeof input.password === "string" ? Array.from(input.password).length : 0;
    if (typeof input.password !== "string" || passwordLength < 10 || passwordLength > 128 || !input.password.trim())
      fail(400, "INVALID_PASSWORD", "密码需为 10–128 位，不能全部使用空格。");
    return this.transaction(() => {
      if (this.db.prepare("SELECT id FROM users WHERE username=?").get(username))
        fail(409, "ACCOUNT_EXISTS", "此账号已存在，请登录或使用其他账号。");
      const salt = randomBytes(16).toString("hex"), uid = id("usr");
      this.db.prepare("INSERT INTO users(id,username,salt,password) VALUES(?,?,?,?)")
        .run(uid, username, salt, scryptSync(input.password, salt, 64).toString("hex"));
      this.insert(uid, "consent", {purpose:"analysis",version:1,granted:false,recorded_at:this.now()});
      return this.createSession(this.user(uid));
    });
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
    return this.createSession(row);
  }
  createSession(row) {
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
      if(operation.startsWith('edit:'))check(this.db.prepare("SELECT id FROM objects WHERE owner=? AND type='result' AND id=?").get(uid,operation.slice(5)),'SOURCE_DELETED',410);
      if (/^(accept|retry|reanalyse|change|feedback):/.test(operation) && outcome.source_id)
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
      base_health_document_id: this.all('health_overview',uid).at(-1)?.id||null,
      consent_version: c.version,
      epoch: u.epoch,
      scope_epoch: 1,
      created_at: this.now(),
      expires_at: this.clock() + this.limits.scopeTtlMs,
      queue_expires_at: this.clock() + this.limits.queueTtlMs,
      deadline: null,
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
      deadline: run.queue_expires_at,
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
  conversationSources(uid, conversationId) {
    check(typeof conversationId === "string", "INVALID_INPUT");
    const runs=this.all("run",uid).filter(r=>r.workflow==='chat'&&r.conversation_id===conversationId).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    check(runs.length,"NOT_FOUND",404);
    check(!runs.some(r=>r.deleted),"SOURCE_DELETED",410);
    return [...new Set(runs.map(r=>r.source_ids[0]))].map(sid=>this.get(uid,"source",sid));
  }
  pendingVisitOffer(uid, conversationId) {
    const latest=this.all('run',uid).filter(r=>r.workflow==='chat'&&r.conversation_id===conversationId).at(-1);
    if(!latest || latest.status!=='completed' || latest.execution_error || !latest.runtime || latest.deleted || latest.visit_offer_consumed_by)return null;
    const result=this.get(uid,'result',latest.result_id);
    return result.validity==='current' && ['offer_visit','offer_record','offer_both'].includes(result.payload.intent) ? latest.id : null;
  }
  validateVisitConfirmation(run, payload) {
    payload ||= this.get(run.owner,'result',run.result_id).payload;
    const offerIntent=payload.intent.replace('confirm_','offer_');
    const consentError=(reason,path,rule)=>fail(422,'INVALID_AGENT_OUTPUT','本轮尚未满足操作确认条件，请修正对话意图。',{reason,path,rule});
    const askFirst=`Use intent ${offerIntent} and a natural reply summarizing the requested action and asking for confirmation, then wait for a later user turn. Remove confirmation_quote, confirmation_offer_id and confirmation_has_new_details. Do not invent or reuse an old offer id, and do not claim that saving or generation has started. If the user is refusing, correcting, asking a question or deferring, use clarify instead.`;
    const offer=run.visit_offer_run_id && this.get(run.owner,'run',run.visit_offer_run_id);
    if(!offer)consentError('NO_PENDING_ACTION_OFFER','payload.intent',`There is no pending_action_offer for this turn. A request to ask for confirmation is an offer, not confirmed consent. ${askFirst}`);
    if(!(offer.conversation_id===run.conversation_id && offer.runtime && !offer.execution_error && !offer.visit_offer_consumed_by && offer.status==='completed'))
      consentError('ACTION_OFFER_UNAVAILABLE','payload.intent',`The prior offer is unavailable, unverified or already consumed. ${askFirst}`);
    const result=this.get(run.owner,'result',offer.result_id);
    if(result.validity!=='current')consentError('STALE_ACTION_OFFER','payload.intent',`The prior offer is stale. ${askFirst}`);
    if(result.payload.intent!==offerIntent)consentError('ACTION_OFFER_SCOPE_MISMATCH','payload.intent',`The pending offer does not authorize this action scope. ${askFirst}`);
    if(payload.format_version===2){
      if(payload.confirmation_offer_id!==offer.id)consentError('CONFIRMATION_OFFER_ID_MISMATCH','payload.confirmation_offer_id',`Only if the current user explicitly approves the pending action, copy the exact pending_action_offer.run_id (${offer.id}). Never infer approval merely from a request to ask for confirmation; use ${offerIntent} and wait in that case.`);
      if(payload.confirmation_quote!==this.get(run.owner,'source',run.source_ids[0]).text)consentError('CONFIRMATION_QUOTE_MISMATCH','payload.confirmation_quote','Only if the current user explicitly approves the pending action, copy their entire current source text verbatim as confirmation_quote. Do not quote a previous turn or fabricate consent. Otherwise use clarify or a new offer and wait.');
    } else {
    const text=this.get(run.owner,'source',run.source_ids[0]).text.trim().replace(/[，。！!,.\s]/g,'').toLowerCase();
    // Match the entire consent utterance; mentioning generation is not authorization.
    const affirmative=/^(好的?|可以|行|是的?|同意|确认|没问题|yes|ok|okay|sure)$/.test(text);
    const request=/^(好的?|可以|行|是的?|同意|确认|没问题)?(请|麻烦)?(现在|就)?(帮我|给我)?(按照?刚才说的)?(生成|整理|开始生成|开始整理)(一份|一张|一个)?(医生沟通卡|就诊沟通卡|沟通卡|健康报告|报告|卡片)?(吧)?(谢谢)?$/.test(text)
      || /^(好的?|可以)?(现在)?开始吧$/.test(text)
      || /^(yes|ok|okay|sure)?(please)?generate(a|the)?(doctorcard|visitcard|healthreport|report|card)?(please)?$/.test(text);
    check(text.length<=100 && (affirmative||request),'INVALID_AGENT_OUTPUT',422);
    }
    const later=this.all('run',run.owner).filter(r=>r.workflow==='chat'&&r.conversation_id===run.conversation_id);
    check(later.at(-1)?.id===run.id,'INVALID_AGENT_OUTPUT',422);
    // A retry is a new run, not a new user turn: a subsequent refusal supersedes it.
    check(this.conversationSources(run.owner,run.conversation_id).at(-1)?.id===run.source_ids[0],'INVALID_AGENT_OUTPUT',422);
    return offer;
  }
  enqueueVisitContinuation(run) {
    if(run.workflow!=='chat'||(run.continuation_run_id||run.continuation_record_run_id)||run.execution_error||!run.result_id)return;
    const result=this.get(run.owner,'result',run.result_id);
    if(!['confirm_visit','confirm_record','confirm_both'].includes(result.payload.intent))return;
    check(result.validity==='current','STALE_DEPENDENCY',409);
    const offer=this.validateVisitConfirmation(run),uid=run.owner;
    const confirmation=this.get(uid,'source',run.source_ids[0]).text;
    const controlOnly=result.payload.format_version===2 ? result.payload.confirmation_has_new_details===false : confirmation.replace(/没问题|是的?|医生沟通卡|沟通卡|健康报告|报告|卡片|刚才说的|就按|一份|好的|可以|确认|同意|麻烦|现在|帮我|请|生成|整理|开始|谢谢|好的?|行|吧|就|按|yes|okay|ok|sure|please|generate|[，。！!,.\s]/gi,'')==='';
    const sources=this.conversationSources(uid,run.conversation_id).filter(source=>!controlOnly||source.id!==run.source_ids[0]),text=this.text(sources.map(s=>s.text).join('\n'));
    const selected=[...new Set([...sources.map(s=>s.id),...run.source_ids.filter(sid=>!controlOnly||sid!==run.source_ids[0])])];
    check(selected.length<this.limits.retrievalCount,'PAYLOAD_TOO_LARGE',413);
    check(Buffer.byteLength(text)+selected.reduce((n,sid)=>n+Buffer.byteLength(this.get(uid,'source',sid).text),0)<=this.limits.textBytes*2,'PAYLOAD_TOO_LARGE',413);
    this.checkQueueAdmission(uid);
    const source=this.insert(uid,'source',{kind:'self_report',text,text_version:1,content_hash:hash(text),recorded_at:this.now(),pages:[],derived_source_ids:sources.map(s=>s.id),input_kind:'self_report'});
    const episode=this.insert(uid,'episode',{source_id:source.id,label:null,status:'pending',created_at:this.now()});
    const entry=this.insert(uid,'entry',{source_id:source.id,input_kind:source.input_kind,received_at:this.now(),raw_time_text:null,episode_id:episode.id});
    for(const workflow of (result.payload.intent==='confirm_both'?['visit','entry']:result.payload.intent==='confirm_record'?['entry']:['visit'])){
      let thread=null;
      if(workflow==='entry')thread=this.insert(uid,'record_thread',{episode_id:episode.id,source_ids:[source.id,...selected],version:1,status:'analyzing',created_at:this.now(),updated_at:this.now(),latest_run_id:null,latest_change_id:null,latest_summary_id:null});
      const child=this.newRun(uid,workflow,[source.id,...selected],{conversation_id:run.conversation_id,parent_run_id:run.id,document_id:null,...(thread?{record_thread_id:thread.id}:{})});
      if(thread){thread.latest_run_id=child.id;this.save('record_thread',thread);}
      const operation=this.insert(uid,'operation',{kind:'accept',status:'committed',source_id:source.id,entry_id:entry.id,document_id:null,run_id:child.id,recorded_at:this.now(),saved:true});
      this.queueRun(child,operation.id);
      run[workflow==='visit'?'continuation_run_id':'continuation_record_run_id']=child.id;
    }
    offer.visit_offer_consumed_by=run.id;this.save('run',offer);
  }
  conversationMessages(run) {
    if(!run.conversation_id)return [];
    const messages=[];
    const results=this.all('result',run.owner).filter(result=>result.kind==='assistant_reply'&&result.conversation_id===run.conversation_id).sort((a,b)=>b.created_at.localeCompare(a.created_at));
    for(const source of this.conversationSources(run.owner,run.conversation_id).filter(source=>run.source_ids.includes(source.id))){
      messages.push({role:'user',text:source.text,source_id:source.id});
      const response=results.find(result=>result.source_ids[0]===source.id);
      if(response){
        const text=response.payload.format_version===2?response.payload.reply:response.payload.questions?.join('\n');
        const parent=this.get(run.owner,'run',response.run_id);
        const actions=['continuation_run_id','continuation_record_run_id'].filter(key=>parent[key]).map(key=>{const child=this.get(run.owner,'run',parent[key]);return {run_id:child.id,workflow:child.workflow,status:child.status,phase:child.phase,runtime_verified:!!child.runtime&&!child.execution_error,execution_error:child.execution_error||null,error:child.error||child.execution_error||null,result_id:child.result_id,fact_change_id:child.fact_change_id,record_thread_id:child.record_thread_id||null};});
        if(text)messages.push({role:'assistant',text,intent:response.payload.intent,context_only:true,...(actions.length?{actions}:{})});
      }
    }
    check(Buffer.byteLength(JSON.stringify(messages))<=this.limits.outputBytes,'PAYLOAD_TOO_LARGE',413);
    return messages;
  }
  editVisit(uid,resultId,body,key,expectedEpoch) {
    return this.transaction(()=>this.receipt(uid,`edit:${resultId}`,key,body,()=>{
      this.checkExpectedEpoch(uid,expectedEpoch);
      const result=this.get(uid,"result",resultId);
      check(result.kind==='visit_preparation',"INVALID_INPUT");
      // Patient wording is editable even when its evidence needs a fresh review.
      // Keep the original payload and its stale status unchanged.
      check(['current','stale'].includes(result.status)&&['current','stale'].includes(result.validity),"STALE_DEPENDENCY",409);
      keys(body,['speech','questions','unknowns','expected_edit_revision'],['speech','questions','expected_edit_revision']);
      check(Number.isSafeInteger(body.expected_edit_revision)&&body.expected_edit_revision===(result.user_edit?.revision||0),'REVISION_CONFLICT',409);
      const speech=this.text(body.speech);
      check(speech.length<=20000&&Array.isArray(body.questions)&&body.questions.length<=20&&body.questions.every(q=>typeof q==='string'&&q.length<=1000),'INVALID_INPUT');
      check(body.unknowns===undefined||(Array.isArray(body.unknowns)&&body.unknowns.length<=20&&body.unknowns.every(x=>typeof x==='string'&&x.length<=2000)),'INVALID_INPUT');
      const unknowns=body.unknowns??result.user_edit?.unknowns??result.payload.unknowns??[];
      result.user_edit={speech,questions:[...body.questions],unknowns:[...unknowns],revision:body.expected_edit_revision+1,edited_at:this.now()};
      this.save('result',result);return result;
    }));
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
          check(["entry", "document", "visit", "chat"].includes(workflow));
          let selected=input.selected_source_ids||[],conversationId=null,concern=input.current_concern,derivedSourceIds=[];
          check(Array.isArray(selected));
          if(workflow==='visit'&&input.previous_result_id){
            const previous=this.get(uid,'result',input.previous_result_id);
            check(previous.kind==='visit_preparation','INVALID_INPUT');
            const previousRun=this.get(uid,'run',previous.run_id);
            check(!previousRun.deleted&&previousRun.source_ids.length,'SOURCE_DELETED',410);
            concern=this.get(uid,'source',previousRun.source_ids[0]).text;derivedSourceIds=[previousRun.source_ids[0]];
            selected=previousRun.source_ids.slice(1);conversationId=previousRun.conversation_id||null;
          }
          if(workflow==='chat'){for(const feedback of this.all('care_feedback',uid))if(selected.includes(feedback.source_id))selected=[...new Set([...selected,...feedback.source_ids])];}
          const priorChat=workflow==='chat'?this.all('run',uid).filter(r=>r.workflow==='chat'&&selected.includes(r.source_ids[0])).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]:null;
          conversationId=workflow==='visit'?(input.conversation_id||conversationId):workflow==='chat'?(priorChat?.conversation_id||id('chat')):null;
          if(conversationId&&(workflow==='visit'||priorChat)){
            const conversation=this.conversationSources(uid,conversationId);
            if(workflow==='visit'){concern=conversation.map(source=>source.text).join('\n');derivedSourceIds=[...derivedSourceIds,...conversation.map(source=>source.id)];}
            selected=[...new Set([...selected,...conversation.map(source=>source.id)])];
          }
          const text = document?.requires_transcription ? "" : this.text(workflow === "visit" ? concern : workflow === "chat" ? input.question : input.text);
          check(selected.length<(conversationId?this.limits.retrievalCount:this.limits.retrievalCount+1),'PAYLOAD_TOO_LARGE',413);
          check(Buffer.byteLength(text)+selected.reduce((n,sid)=>n+Buffer.byteLength(this.get(uid,'source',sid).text),0)<=this.limits.textBytes*2,'PAYLOAD_TOO_LARGE',413);
          this.checkQueueAdmission(uid);
          for (const s of selected) this.get(uid, "source", s);
          if (input.episode_id) this.get(uid, "episode", input.episode_id);
          const source = this.insert(uid, "source", {
            kind: workflow === "document" ? "medical_document" : "self_report",
            text,
            text_version: 1,
            content_hash: hash(text),
            recorded_at: this.now(),
            pages: document?.pages || [],
            ...(derivedSourceIds.length?{derived_source_ids:[...new Set(derivedSourceIds)]}:{}),
            input_kind: workflow === "chat" ? "assistant_question" : document?.requires_transcription ? "image" : document ? (document.media_type==='text/plain'?'pasted_document':'pdf') : workflow === "document" ? "pasted_document" : "self_report",
          });
          const episode = workflow === "chat" ? null : input.episode_id
            ? this.get(uid, "episode", input.episode_id)
            : this.insert(uid, "episode", {
                source_id: source.id,
                label: null,
                status: "pending",
                created_at: this.now(),
              });
          const entry = workflow === "chat" ? null : this.insert(uid, "entry", {
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
              media_type: document?.media_type || (document ? "application/pdf" : "text/plain"),
              byte_size: document?.bytes.length || Buffer.byteLength(text),
              content_hash: document ? hash(document.bytes) : source.content_hash,
              extraction_status: document?.requires_transcription ? "queued" : "extracted",
              pages: source.pages,
            });
            if (document)
              this.db.prepare("INSERT INTO originals VALUES(?,?,?)").run(source.id, uid, document.bytes);
          }
          const visitOffer=workflow==='chat'&&conversationId?this.pendingVisitOffer(uid,conversationId):null;
          const run = this.newRun(uid, document?.requires_transcription ? "transcription" : workflow, [source.id, ...selected], { ...(visitOffer?{visit_offer_run_id:visitOffer}:{}), document_id: doc?.id || null, ...(conversationId ? {conversation_id:conversationId} : {}) });
          const operation = this.insert(uid, "operation", {
            kind: "accept",
            status: "committed",
            source_id: source.id,
            entry_id: entry?.id || null,
            document_id: doc?.id || null,
            run_id: run.id,
            recorded_at: this.now(),
            saved: true,
          });
          this.queueRun(run, operation.id);
          return {
            entry_id: entry?.id || null,
            source_id: source.id,
            ...(doc ? { document_id: doc.id } : {}),
            ...(run.conversation_id ? {conversation_id:run.conversation_id} : {}),
            run_id: run.id,
            operation_id: operation.id,
            saved: true,
          };
        },
      ),
    );
  }
  refreshHealthProfile(uid,body,expectedEpoch){
    keys(body,['operation_key']);
    this.checkExpectedEpoch(uid,expectedEpoch);this.requireConsent(uid);
    return this.transaction(()=>this.receipt(uid,'health-profile:refresh',body.operation_key,body,()=>{
      const latest=this.all('run',uid).filter(r=>r.overview_refresh).at(-1);
      if(latest&&!latest.automatic_finalized&&latest.base_profile_revision===this.user(uid).revision&&(latest.base_health_document_id||null)===(this.all('health_overview',uid).at(-1)?.id||null)&&latest.epoch===this.user(uid).epoch&&latest.consent_version===this.consent(uid).version&&!latest.deleted){
        return {run_id:latest.id,status:latest.status,operation_id:latest.operation_id};
      }
      const excluded=supersededHealthSources(this,{owner:uid});
      const sources=this.all('source',uid).filter(s=>!excluded.has(s.id)&&['self_report','medical_document'].includes(s.kind)&&typeof s.text==='string'&&s.text.trim()).map(s=>s.id);
      if(!sources.length)return {run_id:null,status:'no_data'};
      for(const old of this.all('run',uid).filter(r=>r.overview_refresh&&!r.automatic_finalized)){
        old.status='cancelled';old.phase='overview_superseded';old.scope_epoch++;this.save('run',old);this.finishDispatch(old);this.expireCheckpoints(uid,'overview_superseded',old.id);
      }
      const run=this.newRun(uid,'entry',sources,{overview_refresh:true});
      const operation=this.insert(uid,'operation',{kind:'overview_refresh',status:'committed',run_id:run.id,saved:true,recorded_at:this.now()});this.queueRun(run,operation.id);
      return {run_id:run.id,status:run.status,operation_id:operation.id};
    }));
  }
  profile(uid) {
    const u = this.user(uid),
      revs = this.all("fact_revision", uid),
      latest = new Map();
    for (const f of revs)
      if (!latest.has(f.fact_id) || latest.get(f.fact_id).revision < f.revision) latest.set(f.fact_id, f);
    const facts=[...latest.values()].filter(x=>['confirmed','patient_report','document_report'].includes(x.review_status));
    const pending_changes=this.all('fact_change',uid).filter(x=>x.status==='pending');
    return {profile_revision:u.revision,facts,pending_changes,health_profile:{...buildHealthProfile(this,uid,facts,pending_changes),overview:currentOverview(this,uid)}};
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
      if ((r.queue_expires_at ?? r.deadline) <= this.clock()) {
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
      r.started_at = this.now();
      r.deadline = Math.min(this.clock() + this.limits.deadlineMs, r.expires_at);
      this.save("run", r);
      const d = this.all("dispatch", r.owner).find((d) => d.run_id === r.id);
      d.state = "running";
      d.deadline = r.deadline;
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
          latest.read_facts = [...(latest.read_facts||[]),...out.instructions.map((f) => ({ fact_id: f.fact_id, revision: f.revision }))].filter((f,i,a)=>a.findIndex(x=>x.fact_id===f.fact_id&&x.revision===f.revision)===i);
        if (out.care_feedback_context) {
          // Feedback retains historical snapshots. Only a returned, still-current
          // instruction backed by this run's authorized sources grants a fact read.
          const contexts = out.care_feedback_context.feedback_history || [out.care_feedback_context];
          const currentFacts = this.profile(run.owner).facts;
          const returned = contexts.flatMap(context => context.instructions || []).filter(snapshot =>
            currentFacts.some(f => f.fact_id === snapshot.fact_id && f.revision === snapshot.revision &&
              f.field === "instruction" && f.evidence.some(e => run.source_ids.includes(e.source_id))));
          latest.read_facts = [...(latest.read_facts || []), ...returned.map(f => ({ fact_id: f.fact_id, revision: f.revision }))]
            .filter((f, i, all) => all.findIndex(r => r.fact_id === f.fact_id && r.revision === f.revision) === i);
        }
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
      check(run.source_ids.includes(sid)||run.read_sources?.includes(sid), "NOT_FOUND", 404);
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
            indexed_sentences: indexedSentences(source),
          };
        }),
      healththread_retrieve_context: (args) =>
        call("healththread_retrieve_context", args, (r, a) => {
          keys(a, ["query", "episode_id", "source_ids", "source_offset"], []);
          const offset=a.source_offset??0;
          if(Object.hasOwn(a,"source_offset")&&!(r.overview_refresh&&Number.isSafeInteger(a.source_offset)&&offset>=0&&offset<r.source_ids.length&&!Object.hasOwn(a,"source_ids")))fail(422,"INVALID_AGENT_OUTPUT","资料分页位置无效。",{path:"source_offset",rule:"Use a nonnegative integer selected-source offset returned by source_page.next_offset for overview_refresh only; omit source_ids when paging."});
          check(!a.query || (typeof a.query === "string" && a.query.length <= 1000));
          const ids = a.source_ids || (r.overview_refresh ? r.source_ids.slice(offset,offset+this.limits.retrievalCount) : r.conversation_id ? r.source_ids : []);
          check(Array.isArray(ids) && ids.length <= this.limits.retrievalCount);
          if (a.episode_id) this.get(r.owner, "episode", a.episode_id);
          const p = this.profile(r.owner),retained=!r.overview_refresh&&Object.hasOwn(a,'source_ids')?currentDocumentEvidence(this,r):new Set(),
            sources = [...new Set([...ids,...(r.workflow==='chat'?[r.source_ids[0]]:[])])].map(s=>retained.has(s)?this.get(r.owner,'source',s):read(r,s));
          const query = (a.query || "").normalize("NFKC").toLowerCase().trim();
          const record=this.all('record_thread',r.owner).find(t=>t.id===r.record_thread_id||(r.conversation_id&&t.conversation_id===r.conversation_id));
          const facts = p.facts.filter(
            (f) =>
              !(r.record_edit&&record&&f.episode_id===record.episode_id) &&
              (!query || f.value.normalize("NFKC").toLowerCase().includes(query)) &&
              (!a.source_ids?.length || f.evidence.some((e) => ids.includes(e.source_id))) &&
              (!a.episode_id || f.episode_id === a.episode_id),
          );
          const record_context=record?{record_thread_id:record.id,episode_id:record.episode_id,summary:r.record_edit?this.get(r.owner,'source',r.source_ids[0]).text:record.summary||this.all('record_summary',r.owner).find(x=>x.id===record.latest_summary_id)?.summary||'',version:record.version,source_ids:[...record.source_ids],...(r.record_edit?{edit_replaces_history:true,authoritative_source_id:r.source_ids[0]}:{})}:null;
          const contextIds=r.overview_refresh?sources.map(s=>s.id):[...new Set([...sources.map(s=>s.id),...(record?.source_ids||[]),...(p.health_profile.overview.source_ids||[]),...facts.slice(0,this.limits.retrievalCount).flatMap(f=>f.evidence.map(e=>e.source_id))])].slice(0,this.limits.retrievalCount);
          const contextualSources=contextIds.map(sid=>({...this.get(r.owner,'source',sid),...(supersededHealthSources(this,r).has(sid)?{context_only:true,superseded_by_record_edit:true}:{})}));
          return {
            ...(r.overview_refresh?{source_page:{offset,next_offset:offset+this.limits.retrievalCount<r.source_ids.length?offset+this.limits.retrievalCount:null,total:r.source_ids.length}}:{}),
            facts: facts.slice(0, this.limits.retrievalCount),
            record_context,body_overview_context:p.health_profile.overview,
            ...(r.overview_refresh&&r.overview_change_id?{overview_resolution_context:(()=>{const c=this.get(r.owner,'fact_change',r.overview_change_id);return {change_id:c.id,status:c.status,resolutions:c.resolutions||[],proposals:c.proposals.map(p=>({value:p.value,evidence:p.evidence,proposal_status:p.proposal_status,resolutions:p.resolutions||[]}))};})()}:{}),
            ...(feedbackContext(this,r)?{care_feedback_context:feedbackContext(this,r)}:{}),
            sources:contextualSources,
            ...(r.conversation_id?{conversation_messages:this.conversationMessages(r),pending_visit_offer:!!r.visit_offer_run_id,...(()=>{
              const offer=r.visit_offer_run_id?{run_id:r.visit_offer_run_id,action:this.get(r.owner,'result',this.get(r.owner,'run',r.visit_offer_run_id).result_id).payload.intent.replace('offer_','')}:null;
              return {pending_offer:offer,pending_action_offer:offer};
            })()}:{}),
            source_spans:sources.map(source=>({source_id:source.id,sentence_spans:sentenceSpans(source),sentence_annotations:sentenceAnnotations(source),indexed_sentences:indexedSentences(source)})),
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
          const analysisSourceId=this.documentSource(r.owner,doc.id);const source=read(r, analysisSourceId),profile=this.profile(r.owner);
          const contextIds=[...new Set([...r.source_ids,...(profile.health_profile.overview.source_ids||[]),...profile.facts.flatMap(f=>f.evidence.map(e=>e.source_id))])].slice(0,this.limits.retrievalCount);
          return {source, sources:contextIds.map(sid=>this.get(r.owner,'source',sid)),facts:profile.facts.slice(0,this.limits.retrievalCount),body_overview_context:profile.health_profile.overview,
            instructions: this.profile(r.owner).facts.filter(
              (f) => f.field === "instruction" && f.evidence.some((e) => e.source_id === analysisSourceId),
            ),
          };
        }),
      healththread_stage_result: (args) =>
        call("healththread_stage_result", args, (r, a) => this.stageResult(r, a, read), true),
    });
  }
  stageCandidates(run, args, read) {
    keys(args, ["candidates", "base_profile_revision", "operation_key", "record_dialogue", "record_source_refs", "document_source_refs", "comparisons", "overview"],["candidates", "base_profile_revision", "operation_key"]);
    check(["entry", "document"].includes(run.workflow), "INVALID_AGENT_OUTPUT", 422);
    if((run.overview_refresh||run.record_edit||run.legacy_record_adoption||Object.hasOwn(args,'document_source_refs'))&&!args.overview)fail(422,'INVALID_AGENT_OUTPUT','本次自动整理必须包含身体概述。',{path:'overview',rule:'Provide a native overview object with format_version=2, summary, problems, background and uncertainties (unknown dimensions must be null). Keep exact source references and the user edit unchanged. This automatic workflow cannot finish without its overview.'});
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
      const readCandidateSource=(sid)=>{
        check(run.read_sources?.includes(sid),'INVALID_AGENT_OUTPUT',422);
        return read(run,sid);
      };
      if(run.overview_refresh&&(args.candidates.length||args.record_source_refs?.length||args.document_source_refs?.length||args.comparisons?.length||args.record_dialogue))fail(422,'INVALID_AGENT_OUTPUT','本次仅更新近况概览。',{path:'candidates',rule:'For overview_refresh provide candidates=[] and overview only; omit record/dialogue references and comparisons. Current resolved facts are read-only context.'});
      const naturalRecordSummary=run.workflow==='entry'&&run.record_thread_id&&typeof args.record_dialogue?.summary==='string'&&args.record_dialogue.summary.trim().length>0;
      const warnings=[];
      let candidateInputs=args.candidates;
      const candidateIndexes=[];
      if(Object.hasOwn(args,'document_source_refs')){
        check(run.workflow==='document'&&args.candidates.length===0&&(!args.record_source_refs||Array.isArray(args.record_source_refs)&&args.record_source_refs.length===0)&&Array.isArray(args.document_source_refs)&&args.document_source_refs.length<=100,'INVALID_AGENT_OUTPUT',422);
        const seen=new Set();
        candidateInputs=args.document_source_refs.map((ref,index)=>{
          const candidate=materializeSentenceCandidate(ref,readCandidateSource,`document_source_refs[${index}]`);
          const refKey=canonical([ref.source_id,ref.sentence_index]);check(!seen.has(refKey),'INVALID_AGENT_OUTPUT',422);seen.add(refKey);
          candidateIndexes.push(index);
          return candidate;
        });
      }
      // Empty optional selections carry no source claims and are equivalent to
      // omission, including schema-driven document tool calls.
      if(Object.hasOwn(args,'record_source_refs')&&!(Array.isArray(args.record_source_refs)&&args.record_source_refs.length===0)){
        if(!(naturalRecordSummary&&args.candidates.length===0&&Array.isArray(args.record_source_refs)&&args.record_source_refs.length<=100))fail(422,'INVALID_AGENT_OUTPUT','原句索引只用于自然记录整理。',{
          path:'record_source_refs',rule:'For a document or explicit candidates use candidates and omit record_source_refs (an empty array is allowed). Nonempty record_source_refs requires a natural record summary and an empty candidates array; never mix the two extraction forms.',
        });
        const seenRefs=new Set();
        candidateInputs=args.record_source_refs.flatMap((ref,index)=>{
          keys(ref,['source_id','sentence_index','health_observations'],['source_id','sentence_index']);
          check(typeof ref.source_id==='string'&&Number.isSafeInteger(ref.sentence_index)&&ref.sentence_index>=0,'INVALID_AGENT_OUTPUT',422);
          const source=readCandidateSource(ref.source_id),span=sentenceSpans(source)[ref.sentence_index],annotation=sentenceAnnotations(source)[ref.sentence_index];
          if(!span)fail(422,'INVALID_AGENT_OUTPUT','原句编号不在已读取来源中。',{path:`record_source_refs[${index}].sentence_index`,rule:'Copy source_id and sentence_index from indexed_sentences returned by the read/context tool; indexes are zero-based. Do not invent indexes or source IDs.'});
          const refKey=canonical({source_id:ref.source_id,sentence_index:ref.sentence_index});check(!seenRefs.has(refKey),'INVALID_AGENT_OUTPUT',422);seenRefs.add(refKey);
          if(annotation.unsupported||annotation.ambiguous){
            warnings.push({code:'SOURCE_ONLY_SENTENCE',source_id:ref.source_id,sentence_index:ref.sentence_index,reason:annotation.unsupported?'missing_information':'mixed_temporal_scope'});
            return [];
          }
          candidateIndexes.push(index);
          return [{...(ref.health_observations!==undefined?{health_observations:ref.health_observations}:{}),field:'reported_text',value:span.quote,assertion:annotation.assertion,temporal_scope:annotation.temporal_scope,effective_time:annotation.effective_time,evidence:[span],proposal_kind:'new'}];
        });
      }
      const proposals = candidateInputs.map((input, i) => {
        const c=structuredClone(input);
        if(run.record_edit)check(c.evidence?.every(e=>e.source_id===run.source_ids[0]),'INVALID_AGENT_OUTPUT',422);
        if(args.overview&&Array.isArray(c.health_observations))c.health_observations=normalizeOptionalObservations(c.health_observations,c.value);
        const naturalRecord=naturalRecordSummary&&c.field==='reported_text'&&c.proposal_kind==='new';
        for (const field of ["fact_id", "episode_id", "expected_version"]){
          if(c[field]===null&&(naturalRecord||(field==='episode_id'&&c.proposal_kind==='new')))delete c[field];
          if (Object.hasOwn(c, field))
            fail(422, "INVALID_AGENT_OUTPUT", "新增候选不得自行指定事实标识、版本或事件。", {
              path: `candidates[${i}].${field}`,
              rule: "Omit this field for new proposals; server assigns identities.",
            });
        }
        check(c.proposal_kind === "new", "INVALID_AGENT_OUTPUT", 422);
        if(naturalRecord){
          // The server owns finite source markers and literal time metadata.
          // Derive them only after checking the complete verbatim evidence.
          const refs=validateEvidence(c.evidence,readCandidateSource);
          const annotations=refs.map(({source,evidence})=>{
            check(c.value===evidence.quote,'INVALID_AGENT_OUTPUT',422);
            const annotation=sentenceAnnotations(source).find(a=>canonical(a.locator)===canonical(evidence.locator));
            if(!annotation)fail(422,'INVALID_AGENT_OUTPUT','记录候选须引用完整原句。',{
              path:`candidates[${i}].evidence`,rule:'Select one complete sentence_span from the read source and preserve its quote and locator exactly. Do not combine or rewrite evidence spans.',
            });
            return annotation;
          });
          c.assertion=annotations[0].assertion;
          c.temporal_scope=annotations[0].temporal_scope;
          c.effective_time=structuredClone(annotations[0].effective_time);
        }
        let validated;
        try{validated=validateCandidate(c,readCandidateSource);}catch(error){
          if(Array.isArray(args.document_source_refs)&&error.code==='INVALID_AGENT_OUTPUT'&&error.details?.path==='candidate.field')fail(error.status,error.code,error.message,{...error.details,path:`document_source_refs[${candidateIndexes[i]??i}].field`});
          throw error;
        }
        return {...validated,id:id('candidate'),candidate_index:candidateIndexes[i]??i};
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
      const comparisons=attachComparisons(this,run,proposals,args.comparisons,{legacyFallback:!args.overview});
      const change = this.insert(run.owner, "fact_change", {
        run_id: run.id,
        source_ids: run.source_ids,
        base_profile_revision: args.base_profile_revision,
        epoch: run.epoch,
        consent_version: run.consent_version,
        status: "pending",
        kind: "new",
        proposals,
        comparisons,
        conflicts: comparisons.filter(c=>c.requires_resolution),
        created_at: this.now(),
        document_id: run.document_id,
        ...(args.overview?{overview:validateRunHealthState(this,run,args.overview)||validateOverview(args.overview,run.read_sources||[])}:{}),
      });
      const summaryId=run.record_thread_id?stageRecordSummary(this,run,change,args.record_dialogue):null;
      run.fact_change_id = change.id;
      run.status = "needs_review";
      run.phase = "review";
      this.save("run", run);
      this.finishDispatch(run);
      return { fact_change_id: change.id, status: "needs_review",...(summaryId?{record_summary_id:summaryId}:{}),...(warnings.length?{warnings}:{}) };
    });
  }
  confirm(uid, changeId, body, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `confirm:${changeId}`, key, body, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const change = this.get(uid, "fact_change", changeId),
          u = this.user(uid),
          c = this.requireConsent(uid);
        keys(body,['accepted_change_ids','expected_profile_revision','record_summary_id','confirmation_message','resolutions'],['accepted_change_ids','expected_profile_revision']);
        checkRecordConfirmation(this,uid,change,body);
        check(change.status === "pending", "REVISION_CONFLICT", 409);
        check(change.epoch === u.epoch && change.consent_version === c.version, "SCOPE_REVOKED", 403);
        check(
          body.expected_profile_revision === u.revision && change.base_profile_revision <= u.revision,
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
        const selected = resolveProposals(this,uid,change,body);
        for (const sid of change.source_ids) this.get(uid, "source", sid);
        for (const {proposal:p,clean} of selected) {
          validateCandidate(clean, (sid) => this.get(uid, "source", sid));
          let previous = null;
          if (clean.fact_id) {
            previous = this.profile(uid).facts.find((f) => f.fact_id === clean.fact_id);
            check(previous && previous.revision === clean.expected_version, "REVISION_CONFLICT", 409);
          }
          const factId = clean.fact_id || id("fact");
          this.insert(uid, "fact_revision", {
            ...clean,
            episode_id:
              previous?.episode_id ||
              this.all("entry", uid).find((e) => e.source_id === clean.evidence[0].source_id)?.episode_id ||
              null,
            fact_id: factId,
            revision: (previous?.revision || 0) + 1,
            supersedes_revision: previous?.revision || null,
            review_status: clean.proposal_kind === "retraction" ? "retracted" : "confirmed",
            confirmed_at: this.now(),
            change_id: change.id,
          });
          p.proposal_status="confirmed";p.confirmed_fact_id=factId;p.confirmed_revision=(previous?.revision||0)+1;
        }
        if (selected.length) this.db.prepare("UPDATE users SET revision=revision+1 WHERE id=?").run(uid);
        const revision = this.user(uid).revision;
        refreshPendingComparisons(this,uid,change,new Set(selected.map(({proposal})=>proposal.confirmed_fact_id)));
        const remaining=change.proposals.filter(reviewable);
        change.status = remaining.length ? 'pending' : change.proposals.some(p=>p.proposal_status==='confirmed'||p.proposal_status==='kept_existing') ? 'confirmed' : 'rejected';
        change.accepted_change_ids = change.proposals.filter(p=>p.proposal_status==='confirmed').map(p=>p.id);
        change.review_state=remaining.length?(change.accepted_change_ids.length?'partially_confirmed':'deferred'):'complete';
        change.resolutions=change.proposals.flatMap(p=>p.resolutions||[]);
        change.confirmed_at = this.now();
        this.save("fact_change", change);
        if (selected.length) this.invalidateProfileDependents(uid);
        if (change.run_id) {
          const r = this.get(uid, "run", change.run_id);
          r.status = remaining.length ? "needs_review" : "completed";
          r.phase = remaining.length ? "review" : "confirmed";
          this.save("run", r);
          this.finishDispatch(r);
        }
        const audit = this.insert(uid, "audit", {
          kind: "confirm",
          change_id: change.id,
          profile_revision: revision,
          accepted_change_ids: body.accepted_change_ids,
          committed_change_ids: selected.map(({proposal})=>proposal.id),
          resolutions: structuredClone(body.resolutions||[]),
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
          const r = this.newRun(uid, "care_plan", [...new Set([this.documentSource(uid,doc.id),doc.source_id,...change.source_ids])], {
            document_id: doc.id,
            parent_run_id: change.run_id,
          });
          this.queueRun(r, operation.id);
          continuation = r.id;
        }
        const outcome = {
          profile_revision: revision,
          commit_receipt: operation.id,
          operation_id: operation.id,
          change_status:change.status, remaining_change_ids:remaining.map(p=>p.id),
          ...(continuation ? { continuation_run_id: continuation } : {}),
        };
        const overviewRun=queueOverviewRefresh(this,uid,change,operation.id);if(overviewRun)outcome.overview_refresh_run_id=overviewRun;
        finishRecordConfirmation(this,uid,change,body,outcome);return outcome;
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
        const outcome = { profile_revision: user.revision, commit_receipt: operation.id, operation_id: operation.id };
        const overviewRun=queueOverviewRefresh(this,uid,change,operation.id);if(overviewRun)outcome.overview_refresh_run_id=overviewRun;
        finishRecordConfirmation(this,uid,change,{accepted_change_ids:[]},outcome);
        return outcome;
      }),
    );
  }
  continuationParent(uid,previous,errorCode) {
    if(previous.overview_refresh)return null;
    const field=previous.workflow==='visit'?'continuation_run_id':previous.workflow==='entry'?'continuation_record_run_id':null;
    if(!field)return null;
    const lineage=[previous],seen=new Set([previous.id]);
    let ancestor=previous;
    while(ancestor.parent_run_id){
      check(!seen.has(ancestor.parent_run_id),errorCode,409);
      ancestor=this.get(uid,'run',ancestor.parent_run_id);seen.add(ancestor.id);
      if(ancestor.workflow==='chat'){
        check(ancestor.conversation_id&&lineage.every(r=>!r.conversation_id||r.conversation_id===ancestor.conversation_id),errorCode,409);
        if(ancestor[field]!==previous.id){
          // Older reanalysis runs omitted conversation_id and left the chat at
          // the cancelled predecessor. Recover only the current record thread.
          const pointed=lineage.find(r=>r.id===ancestor[field]);
          const thread=previous.record_thread_id&&this.get(uid,'record_thread',previous.record_thread_id);
          check(thread&&thread.latest_run_id===previous.id&&pointed?.status==='cancelled'&&pointed.phase==='reanalysed',errorCode,409);
        }
        return {parent:ancestor,field,conversation_id:ancestor.conversation_id};
      }
      check(ancestor.workflow===previous.workflow&&ancestor.record_thread_id===previous.record_thread_id&&canonical(ancestor.source_ids)===canonical(previous.source_ids),errorCode,409);
      lineage.push(ancestor);
    }
    return null;
  }
  reanalyse(uid, runId, body, key, expectedEpoch) {
    return this.transaction(() =>
      this.receipt(uid, `reanalyse:${runId}`, key, body, () => {
        this.checkExpectedEpoch(uid, expectedEpoch);
        const old = this.get(uid, "run", runId),
          user = this.user(uid),
          consent = this.requireConsent(uid);
        check(body.expected_profile_revision === user.revision, "REVISION_CONFLICT", 409);
        const legacyEntry=old.workflow==='entry'&&!old.record_thread_id&&!old.conversation_id&&!old.document_id&&old.source_ids.every(sid=>this.get(uid,'source',sid).kind==='self_report')&&this.all('entry',uid).find(e=>e.source_id===old.source_ids[0]);
        check(
          (old.status === "needs_review" || legacyEntry&&old.status==='completed') && !old.deleted && old.fact_change_id,
          "RUN_NOT_REANALYSABLE",
          409,
        );
        check(old.epoch === user.epoch && old.consent_version === consent.version, "SCOPE_REVOKED", 403);
        const change = this.get(uid, "fact_change", old.fact_change_id);
        check(change.status === "pending" || legacyEntry&&change.status==='confirmed', "REVISION_CONFLICT", 409);
        for (const sid of old.source_ids) this.get(uid, "source", sid);
        this.checkQueueAdmission(uid);
        const continuation=this.continuationParent(uid,old,'RUN_NOT_REANALYSABLE');
        // Expire the old proposal and scope atomically; never rebase its values into current facts.
        old.status = "cancelled";
        old.phase = "reanalysed";
        old.scope_epoch++;
        this.save("run", old);
        this.finishDispatch(old);
        let recordThread=checkRecordRetry(this,uid,old);
        if(legacyEntry){
          check(!this.all('record_thread',uid).some(t=>t.episode_id===legacyEntry.episode_id||t.source_ids.includes(old.source_ids[0])),'REVISION_CONFLICT',409);
          const episode=this.get(uid,'episode',legacyEntry.episode_id);
          recordThread=this.insert(uid,'record_thread',{episode_id:episode.id,source_ids:[old.source_ids[0]],version:0,status:'analyzing',created_at:this.now(),updated_at:this.now(),latest_run_id:null,latest_change_id:null,latest_summary_id:null});
          old.record_thread_id=recordThread.id;this.save('run',old);
        }
        const run = this.newRun(uid, old.workflow, old.source_ids, {
          ...(recordThread?{record_thread_id:recordThread.id}:{}),
          ...(old.record_edit?{record_edit:true}:{}),
          ...((legacyEntry||old.legacy_record_adoption)?{legacy_record_adoption:true}:{}),
          ...((continuation?.conversation_id||old.conversation_id)?{conversation_id:continuation?.conversation_id||old.conversation_id}:{}),
          document_id: old.document_id,
          parent_run_id: old.id,
        });
        updateRecordRetry(this,recordThread,run);
        if(change.status==='pending'){
          change.status = "expired";
          change.terminal_reason = "reanalysed";
          change.expired_at = this.now();
          change.superseded_by_run_id = run.id;
          this.save("fact_change", change);
        }
        const operation = this.insert(uid, "operation", {
          kind: "reanalyse",
          status: "committed",
          run_id: run.id,
          previous_run_id: old.id,
          source_id: old.source_ids[0],
          expired_fact_change_id: change.status==='expired'?change.id:null,
          saved: true,
          recorded_at: this.now(),
        });
        this.queueRun(run, operation.id);
        if(continuation){continuation.parent[continuation.field]=run.id;this.save('run',continuation.parent);}
        return {
          run_id: run.id,
          source_id: old.source_ids[0],
          operation_id: operation.id,
          expired_fact_change_id: change.status==='expired'?change.id:null,
          saved: true,
          ...(recordThread?{record_thread_id:recordThread.id,record_version:recordThread.version}:{}),
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
  original(uid,documentId) {
    const doc=this.get(uid,'document',documentId);this.get(uid,'source',doc.source_id);
    const row=this.db.prepare('SELECT bytes FROM originals WHERE source_id=? AND owner=?').get(doc.source_id,uid);
    check(row,'NOT_FOUND',404);return{bytes:Buffer.from(row.bytes),media_type:doc.media_type,name:doc.name};
  }
  documentSource(uid,documentId) {
    const doc=this.get(uid,'document',documentId);
    const transcript=this.all('document_transcript',uid).filter(x=>x.document_id===doc.id&&x.status!=='unreadable').at(-1);
    return transcript?.transcript_source_id||doc.source_id;
  }
  documentView(uid,documentId) {
    const doc=this.get(uid,'document',documentId),runs=this.all('run',uid).filter(r=>r.document_id===doc.id&&!r.deleted);
    const extraction=runs.filter(r=>r.workflow==='transcription').at(-1),analysis=runs.filter(r=>r.workflow==='document').at(-1);
    const byId=new Map(runs.map(run=>[run.id,run]));
    // Confirmation can start another care run; retries then descend from that
    // run. Only the current analysis and this owner's document lineage count.
    const care=analysis&&runs.filter(run=>{
      const seen=new Set();let ancestor=run;
      while(ancestor?.workflow==='care_plan'&&!seen.has(ancestor.id)){
        if(ancestor.parent_run_id===analysis.id)return true;
        seen.add(ancestor.id);ancestor=byId.get(ancestor.parent_run_id);
      }
      return false;
    }).at(-1);
    const transcript=this.all('document_transcript',uid).filter(x=>x.document_id===doc.id).at(-1)||null;
    let extraction_status=doc.extraction_status;
    if(extraction){extraction_status=extraction.execution_error?'failed':extraction.status==='running'?'transcribing':extraction.status==='queued'?'queued':['failed','blocked','interrupted','cancelled'].includes(extraction.status)?extraction.status:transcript?.status==='unreadable'?'unreadable':transcript?'extracted':'verifying';}
    return{...doc,extraction_status,transcript,analysis_source_id:this.documentSource(uid,doc.id),transcription_run_id:extraction?.id||null,analysis_run_id:analysis?.id||null,analysis_status:analysis?.execution_error?'failed':analysis?.status||null,care_run_id:care?.id||null,original_url:this.db.prepare('SELECT 1 FROM originals WHERE source_id=? AND owner=?').get(doc.source_id,uid)?'/api/documents/'+doc.id+'/original':null};
  }
  stageTranscription(run,args,read) {
    keys(args,['kind','payload','dependencies','operation_key']);check(args.kind==='transcription','INVALID_AGENT_OUTPUT',422);
    return this.receipt(run.owner,`result:${run.id}`,args.operation_key,args,()=>{
      check(Buffer.byteLength(JSON.stringify(args))<=this.limits.outputBytes,'INVALID_AGENT_OUTPUT',422);
      const source=read(run,run.source_ids[0]),p=args.payload;keys(p,['status','text','uncertainties','source_id','source_text_version']);
      check(p.source_id===source.id&&p.source_text_version===source.text_version&&source.input_kind==='image','INVALID_AGENT_OUTPUT',422);
      check(['readable','partial','unreadable'].includes(p.status)&&typeof p.text==='string'&&Buffer.byteLength(p.text)<=this.limits.textBytes&&!p.text.includes('\0'),'INVALID_AGENT_OUTPUT',422);
      check(Array.isArray(p.uncertainties)&&p.uncertainties.length<=100&&p.uncertainties.every(x=>typeof x==='string'&&x.trim()&&x.length<=2000),'INVALID_AGENT_OUTPUT',422);
      check(p.status==='unreadable'?!p.text.trim()&&p.uncertainties.length>0:!!p.text.trim(),'INVALID_AGENT_OUTPUT',422);
      check(p.status!=='partial'||p.uncertainties.length>0,'INVALID_AGENT_OUTPUT',422);
      check(Array.isArray(args.dependencies)&&args.dependencies.length===1&&args.dependencies[0].source_id===source.id&&args.dependencies[0].source_text_version===source.text_version&&Object.keys(args.dependencies[0]).length===2,'INVALID_AGENT_OUTPUT',422);
      check(this.all('tool_receipt',run.owner).some(x=>x.run_id===run.id&&x.tool==='healththread_read_source'),'TOOL_SEQUENCE_REQUIRED',422);
      const result=this.insert(run.owner,'result',{run_id:run.id,kind:'transcription',schema_version:1,payload:structuredClone(p),dependencies:args.dependencies,source_ids:run.source_ids,status:'staged',validity:'current',created_at:this.now()});
      run.result_id=result.id;run.result_ref=result.id;run.status='completed';run.phase='verifying';this.save('run',run);this.finishDispatch(run);
      return{result_id:result.id,status:'completed'};
    });
  }
  finalizeTranscription(run) {
    if(run.workflow!=='transcription'||run.transcription_finalized)return;
    const result=this.get(run.owner,'result',run.result_id),p=result.payload,doc=this.get(run.owner,'document',run.document_id);
    check(doc.source_id===p.source_id,'INVALID_AGENT_OUTPUT',422);
    let source=null;
    if(p.status!=='unreadable')source=this.insert(run.owner,'source',{kind:'medical_document',text:p.text,text_version:1,content_hash:hash(p.text),recorded_at:this.now(),pages:[],input_kind:'image_transcript',derived_source_ids:[doc.source_id],transcription_status:p.status,uncertainties:p.uncertainties,transcription_run_id:run.id});
    this.insert(run.owner,'document_transcript',{document_id:doc.id,source_id:doc.source_id,source_ids:[doc.source_id,...(source?[source.id]:[])],transcript_source_id:source?.id||null,status:p.status,text:p.text,uncertainties:p.uncertainties,run_id:run.id,provenance:{kind:'model_transcription',runtime:run.runtime},recorded_at:this.now()});
    if(source){const analysis=this.newRun(run.owner,'document',[source.id,...run.source_ids],{document_id:doc.id,parent_run_id:run.id});this.queueRun(analysis,run.operation_id);run.continuation_run_id=analysis.id;}
    result.status='completed';this.save('result',result);run.transcription_finalized=true;run.phase=p.status==='unreadable'?'unreadable':'transcribed';
  }
  stageResult(run, args, read) {
    if(run.workflow==='transcription')return this.stageTranscription(run,args,read);
    keys(args, ["kind", "payload", "dependencies", "operation_key"]);
    return this.receipt(run.owner, `result:${run.id}`, args.operation_key, args, () => {
      check(Buffer.byteLength(JSON.stringify(args)) <= this.limits.outputBytes, "INVALID_AGENT_OUTPUT", 422);
      check(
        (run.workflow === "visit" && args.kind === "visit_preparation") ||
          (run.workflow === "chat" && args.kind === "assistant_reply") ||
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
        ["visit", "chat"].includes(run.workflow)
          ? seenTools.includes("healththread_read_source") &&
              seenTools.includes("healththread_retrieve_context")
          : seenTools.includes("healththread_get_confirmed_instructions"),
        "TOOL_SEQUENCE_REQUIRED",
        422,
      );
      const factRef = (ref, path = "fact_refs") => {
        keys(ref, ["fact_id", "revision"]);
        const f = facts.find((f) => f.fact_id === ref.fact_id && f.revision === ref.revision);
        if (!f || !run.read_facts?.some((r) => r.fact_id === ref.fact_id && r.revision === ref.revision))
          fail(422, "INVALID_AGENT_OUTPUT", "引用事实不是本次已读取的当前版本。", {
            path,
            rule: "Use an exact current fact_id/revision returned by healththread_retrieve_context or healththread_get_confirmed_instructions in this run. Historical feedback snapshots do not grant current fact references; cite their original source evidence instead. Do not invent or increment revisions.",
          });
        return f;
      };
      for (const [dependencyIndex, dep] of args.dependencies.entries()) {
        const path = `dependencies[${dependencyIndex}]`;
        if (dep.fact_id) factRef(dep, path);
        else {
          keys(dep, ["source_id", "source_text_version"]);
          if (!run.read_sources?.includes(dep.source_id))
            fail(422, "INVALID_AGENT_OUTPUT", "引用来源尚未在本次授权范围内读取。", {
              path: `${path}.source_id`,
              rule: "Cite a source already returned by healththread_read_source, healththread_retrieve_context or healththread_get_confirmed_instructions in this run. Copy the returned source_id and text_version; do not cite sources outside this run.",
            });
          if (read(run, dep.source_id).text_version !== dep.source_text_version)
            fail(422, "INVALID_AGENT_OUTPUT", "引用来源版本与已读取原文不一致。", {
              path: `${path}.source_text_version`,
              rule: "Use the exact text_version returned by healththread_read_source or healththread_retrieve_context for this source. Preserve the original quote and locator from that version.",
            });
        }
      }
      const hasFact = (ref) =>
        args.dependencies.some((d) => d.fact_id === ref.fact_id && d.revision === ref.revision);
      const payload = structuredClone(args.payload);
      if(payload.automatic_record)payload.automatic_record=validateAutomaticRecord(this,run,payload.automatic_record,read);
      if (["visit_preparation", "assistant_reply"].includes(args.kind)) {
        const chat = args.kind === "assistant_reply", v2=payload.format_version===2;
        if (chat && v2) {
          if (!Object.hasOwn(payload, "speech")) payload.speech = "";
          if (!Object.hasOwn(payload, "unknowns")) payload.unknowns = [];
        }
        check(payload.format_version===undefined||v2,"INVALID_AGENT_OUTPUT",422);
        if (chat) check(["greeting", "clarify", "prepare", "records", "scope", "offer_visit", "confirm_visit", ...(v2?["offer_record","confirm_record","offer_both","confirm_both"]:[])].includes(payload.intent), "INVALID_AGENT_OUTPUT", 422);
        if(chat && payload.intent.startsWith('confirm_'))this.validateVisitConfirmation(run,payload);
        keys(
          payload,
          ["speech", "questions", "unknowns", "claims", ...(chat ? ["intent"] : []), ...(v2?["format_version",...(chat?["reply","confirmation_quote","confirmation_offer_id","confirmation_has_new_details","automatic_record"]:[])]:[])],
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
        if(v2&&chat)check(['confirmation_quote','confirmation_offer_id'].every(key=>payload[key]===undefined||(typeof payload[key]==='string'&&payload[key].length>0&&payload[key].length<=20000))&&typeof payload.reply==='string'&&payload.reply.trim().length>0&&payload.reply.length<=20000 && (payload.confirmation_has_new_details===undefined||typeof payload.confirmation_has_new_details==='boolean'),'INVALID_AGENT_OUTPUT',422);
        const invalidQuestion=v2?-1:payload.questions.findIndex(q=>
          !/[？?]$/.test(q) ||
          /(请服|请用|停药|加量|减量|[0-9一二三四五六七八九十]+\s*(?:mg|ml|毫克|毫升|片|粒|次|天|周))/i.test(q));
        if(invalidQuestion!==-1)fail(422,'INVALID_AGENT_OUTPUT','问题包含不允许的表述，请仅修改问题。',{
          path:'payload.questions',question_index:invalidQuestion,
          rule:'Each question must end in a question mark and must not contain medication instructions, numeric doses, frequencies or durations (including source durations such as 三天). Rewrite only the invalid question as a non-numeric patient question. Preserve the original duration in speech and claims; keep their exact evidence, locators and dependencies unchanged. Do not guess or repair source locators for this error.',
        });
        if(!v2&&!payload.claims.some(c=>Array.isArray(c.evidence)&&c.evidence.some(e=>e.source_id===run.source_ids[0]&&e.quote===c.text)))
          fail(422,'INVALID_AGENT_OUTPUT','缺少本次主来源的原句证据。',{
            path:'payload.claims',required_source_id:run.source_ids[0],
            rule:'Include at least one exact sentence_span from healththread_read_source for required_source_id. Copy quote and locator unchanged; add its source_id/source_text_version to dependencies. For conversation visits the primary source already contains every user turn.',
          });
        const supported = [];
        for (const [claimIndex,claim] of payload.claims.entries()) {
          keys(claim, ["text", "fact_refs", "evidence"]);
          check(
            typeof claim.text === "string" && Array.isArray(claim.fact_refs) && Array.isArray(claim.evidence),
            "INVALID_AGENT_OUTPUT",
            422,
          );
          const matching_support={fact_refs:[],evidence:[]},mismatching_support={fact_refs:[],evidence:[]};
          const matches=quote=>v2?quote.trim()===claim.text.trim():quote===claim.text;
          const support=(kind,index,quote)=>{(matches(quote)?matching_support:mismatching_support)[kind].push(index);return quote;};
          const quotes = claim.fact_refs.map((ref, refIndex) => {
            const path = `payload.claims[${claimIndex}].fact_refs[${refIndex}]`;
            if (!hasFact(ref)) fail(422, "INVALID_AGENT_OUTPUT", "引用事实缺少对应依赖。", {
              path, rule: "Add this exact fact_id/revision to dependencies, using only current facts read in this run.",
            });
            return support('fact_refs',refIndex,factRef(ref, path).value);
          });
          if (claim.evidence.length) {
            for (const [evidenceIndex,{ evidence: e }] of validateEvidence(claim.evidence, (sid) => read(run, sid)).entries()) {
              if(!args.dependencies.some(d=>d.source_id===e.source_id&&d.source_text_version===e.source_text_version))
                fail(422,'INVALID_AGENT_OUTPUT','引用来源缺少对应依赖。',{
                  path:'dependencies',missing_dependencies:[{source_id:e.source_id,source_text_version:e.source_text_version}],
                  rule:'Add this exact source dependency. Every evidence source_id/source_text_version must have a matching dependencies entry, including the primary concern source. Preserve validated claims and evidence.',
                });
              quotes.push(support('evidence',evidenceIndex,e.quote));
            }
          }
          if(!(quotes.length > 0 && quotes.every(matches)))
            fail(422,'INVALID_AGENT_OUTPUT','证据摘要与所引原文不一致，请仅修正摘要文本。',{
              path:'payload.claims',claim_index:claimIndex,reason:'CLAIM_TEXT_EVIDENCE_MISMATCH',
              matching_support,mismatching_support,
              rule:(matching_support.fact_refs.length||matching_support.evidence.length
                ?'Preserve claim.text and its matching_support. Remove unrelated mismatching_support references from this claim, or put distinct supported original statements in separate claims. A physician instruction does not prove patient adherence. '
                :'Copy the supporting wording exactly, preserving negation, uncertainty and internal whitespace. ')+
                'Every claim.text must match each supporting evidence.quote or fact value; v2 permits only leading/trailing whitespace differences. Never rewrite evidence quotes or locators. If references change, include each exact authorized source_id/source_text_version or fact_id/revision in dependencies. Natural synthesis belongs in speech/reply, not claim.text.',
            });
          supported.push(claim.text);
        }
        // Only source-supported sentences may be asserted in the speech. Questions/unknowns remain explicitly questions.
        if(!v2)check(payload.speech === supported.join("\n"), "INVALID_AGENT_OUTPUT", 422);
        if(v2&&!chat)check(payload.speech.trim().length>0,"INVALID_AGENT_OUTPUT",422);
        if (!chat) {
          payload.department = { status: "not_configured" };
          payload.triage = { status: "not_configured" };
        }
      } else {
        keys(payload, ["tasks", "explanation", "guidance"], ["tasks"]);
        if(payload.guidance!==undefined){
          check(Array.isArray(payload.guidance)&&payload.guidance.length<=30,"INVALID_AGENT_OUTPUT",422);
          for(const advice of payload.guidance){
            keys(advice,["text","source_kind","source_refs","category"]);
            check(advice.source_kind==="model_guidance"&&["precaution","recovery"].includes(advice.category)&&typeof advice.text==="string"&&advice.text.trim().length>0&&advice.text.length<=4000&&Array.isArray(advice.source_refs)&&advice.source_refs.length>0,"INVALID_AGENT_OUTPUT",422);
            check(!/[0-9一二三四五六七八九十]+\s*(?:mg|ml|毫克|毫升|片|粒)/i.test(advice.text)&&!/(?:停药|加量|减量|自行服用)/.test(advice.text),"INVALID_AGENT_OUTPUT",422);
            for(const ref of advice.source_refs){keys(ref,["source_id","source_text_version"]);check(run.read_sources?.includes(ref.source_id)&&read(run,ref.source_id).text_version===ref.source_text_version,"INVALID_AGENT_OUTPUT",422);}
          }
        }
        check(Array.isArray(payload.tasks) && payload.tasks.length <= 100, "INVALID_AGENT_OUTPUT", 422);
        const seen = new Set();
        const allowedInstructions=facts.filter(f=>f.field==='instruction'&&f.evidence.some(e=>run.source_ids.includes(e.source_id))&&run.read_facts?.some(r=>r.fact_id===f.fact_id&&r.revision===f.revision));
        for (const [taskIndex,task] of payload.tasks.entries()) {
          keys(task, ["text", "instruction_refs", "schedule", "explanation", "questions"],["text", "instruction_refs", "schedule"]);
          check(
            typeof task.text === "string" &&
              Array.isArray(task.instruction_refs) &&
              task.instruction_refs.length > 0,
            "INVALID_AGENT_OUTPUT",
            422,
          );
          const instructions = task.instruction_refs.map((ref,refIndex) => {
            check(hasFact(ref), "INVALID_AGENT_OUTPUT", 422);
            const f = factRef(ref);
            if(!allowedInstructions.some(i=>i.fact_id===f.fact_id&&i.revision===f.revision))fail(422,'INVALID_AGENT_OUTPUT','任务只能引用本次文档返回的医嘱。',{
              path:`payload.tasks[${taskIndex}].instruction_refs[${refIndex}]`,
              allowed_instruction_refs:allowedInstructions.map(i=>({fact_id:i.fact_id,revision:i.revision})),
              rule:'Build tasks only from the instructions returned by healththread_get_confirmed_instructions for this document. Older facts are context, not additional task authority; remove those tasks. Preserve valid current-document tasks and exact schedules. Source-attributed guidance may use already-authorized context without changing physician instructions.',
            });
            return f;
          });
          check(
            instructions.every((i) => i.value === task.text) && !seen.has(task.text),
            "INVALID_AGENT_OUTPUT",
            422,
          );
          validateCareExplanation(task,instructions);
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
        ...(run.conversation_id ? {conversation_id:run.conversation_id} : {}),
        schema_version: 1,
        payload,
        dependencies: [...args.dependencies,...(payload.guidance||[]).flatMap(g=>g.source_refs)],
        status: "current",
        validity: "current",
        run_id: run.id,
        source_ids: run.source_ids,
        created_at: this.now(),
      });
      if (args.kind === "care_plan")
        for (const task of [...payload.tasks,...(payload.guidance||[]).map(g=>({...g,instruction_refs:[],schedule:null}))]) {
          const signature=refs=>canonical(refs.map(ref=>({fact_id:ref.fact_id,revision:ref.revision})).sort((a,b)=>a.fact_id.localeCompare(b.fact_id)||a.revision-b.revision));
          const existing=this.all('care_task',run.owner).find(t=>t.document_id===run.document_id&&t.validity==='current'&&t.text===task.text);
          if(existing){
            if(signature(existing.instruction_refs)!==signature(task.instruction_refs)){
              existing.instruction_refs=structuredClone(task.instruction_refs);existing.dependencies=structuredClone(task.instruction_refs);existing.version++;
              this.save('care_task',existing);
            }
            continue;
          }
          this.insert(run.owner, "care_task", {
            ...task,
            ...(task.explanation?{explanation_provenance:{kind:"model_paraphrase",instruction_refs:task.instruction_refs,run_id:run.id}}:{}),
            document_id: run.document_id,
            result_id: result.id,
            source_kind:task.source_kind||"physician_instruction",
            dependencies: structuredClone(task.source_refs||task.instruction_refs),
            source_ids: run.source_ids,
            status: "open",
            validity: "current",
            version: 1,
          });
        }
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
        const cancelledOverviewCheckpoint=previous.overview_refresh&&previous.status==='cancelled'&&previous.fact_change_id&&this.get(uid,'fact_change',previous.fact_change_id).overview;
        const automaticCheckpoint=(!!previous.execution_error||cancelledOverviewCheckpoint)&&!previous.automatic_finalized&&(
          (previous.result_id&&this.get(uid,'result',previous.result_id).payload?.automatic_record)||
          (previous.fact_change_id&&this.get(uid,'fact_change',previous.fact_change_id).overview)||
          (previous.workflow==='transcription'&&previous.result_id&&!previous.transcription_finalized));
        const unreadable=previous.workflow==='transcription'&&previous.transcription_finalized&&this.get(uid,'result',previous.result_id).payload.status==='unreadable';
        check(["failed", "blocked", "interrupted"].includes(previous.status)||automaticCheckpoint||unreadable||(previous.overview_refresh&&previous.status==="cancelled"), "RUN_NOT_RETRYABLE", 409);
        check(!previous.deleted && (automaticCheckpoint||unreadable||(!previous.fact_change_id&&!previous.result_id)), "RUN_NOT_RETRYABLE", 409);
        if(automaticCheckpoint){
          if(previous.fact_change_id){const change=this.get(uid,'fact_change',previous.fact_change_id);change.status='expired';change.terminal_reason='automatic_retry';this.save('fact_change',change);}
          if(previous.result_id){const result=this.get(uid,'result',previous.result_id);result.status='stale';result.validity='stale';this.save('result',result);}
          previous.status='cancelled';previous.scope_epoch++;this.save('run',previous);
        }
        for (const sid of previous.source_ids) this.get(uid, "source", sid);
        check(previous.source_ids.length > 0, "RUN_NOT_RETRYABLE", 409);
        this.checkQueueAdmission(uid);
        if(previous.overview_refresh)check(this.all('run',uid).filter(r=>r.overview_refresh).at(-1)?.id===previous.id,'RUN_NOT_RETRYABLE',409);
        const recordThread=checkRecordRetry(this,uid,previous);
        const continuation=this.continuationParent(uid,previous,'RUN_NOT_RETRYABLE');
        const retrySources=previous.workflow==='care_plan'&&previous.document_id?[...new Set([this.documentSource(uid,previous.document_id),...previous.source_ids])]:previous.source_ids;
        const run = this.newRun(uid, previous.workflow, retrySources, {
          ...(previous.record_thread_id?{record_thread_id:previous.record_thread_id}:{}),
          ...(previous.record_edit?{record_edit:true}:{}),
          ...(previous.overview_refresh?{overview_refresh:true,overview_change_id:previous.overview_change_id}:{}),
          ...(previous.legacy_record_adoption?{legacy_record_adoption:true}:{}),
          ...((continuation?.conversation_id||previous.conversation_id)?{conversation_id:continuation?.conversation_id||previous.conversation_id}:{}),
          ...(previous.visit_offer_run_id?{visit_offer_run_id:previous.visit_offer_run_id}:{}),
          document_id: previous.document_id,
          parent_run_id: previous.id,
        });
        updateRecordRetry(this,recordThread,run);
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
        if(continuation){continuation.parent[continuation.field]=run.id;this.save('run',continuation.parent);}
        return { run_id: run.id, source_id: previous.source_ids[0], operation_id: op.id, saved: true };
      }),
    );
  }
  cancel(uid, runId, expectedEpoch) {
    return this.transaction(() => {
      this.checkExpectedEpoch(uid, expectedEpoch);
      const r = this.get(uid, "run", runId);
      if (active.includes(r.status) || (['chat','transcription'].includes(r.workflow) && r.status==='completed' && !r.runtime)) {
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
      check(u.epoch === r.epoch && this.consent(r.owner).granted && this.consent(r.owner).version === r.consent_version && !r.deleted && this.clock()<r.expires_at, "SCOPE_REVOKED", 403);
      for(const sid of r.source_ids)this.get(r.owner,"source",sid);
      check(metadata && ['fixture','real'].includes(metadata.mode),'INVALID_AGENT_OUTPUT',422);
      if(metadata.mode==='real'){
        const agh=metadata.agh;
        check(agh&&agh.provider==='agnes-ai'&&typeof agh.session_id==='string'&&agh.session_id.length>0&&typeof agh.model==='string'&&Number.isSafeInteger(agh.last_seq)&&agh.last_seq>=0&&Array.isArray(agh.tool_receipt_ids)&&agh.tool_receipt_ids.length===r.tool_receipts.length&&r.tool_receipts.every((id,index)=>agh.tool_receipt_ids[index]===id),'INVALID_AGENT_OUTPUT',422);
      }
      r.runtime = metadata;
      this.finalizeTranscription(r);
      finalizeAutomaticRecords(this,r);
      this.enqueueVisitContinuation(r);
      this.save("run", r);
      return r;
    });
  }
  careTasks(uid) {
    this.user(uid);
    return { tasks: this.all("care_task", uid) };
  }
  updateEpisode(uid,episodeId,body,expectedEpoch) {
    return this.transaction(()=>{
      this.checkExpectedEpoch(uid,expectedEpoch);keys(body,['status','expected_version']);
      const episode=this.get(uid,'episode',episodeId);
      check(['active','improved','resolved'].includes(body.status));
      let state=this.all('episode_state',uid).find(s=>s.episode_id===episodeId);
      check(body.expected_version===(state?.version||1),'REVISION_CONFLICT',409);
      const data={episode_id:episodeId,source_id:episode.source_id,status:body.status,version:(state?.version||1)+1,updated_at:this.now()};
      state=state?this.save('episode_state',{...state,...data}):this.insert(uid,'episode_state',data);
      return {...episode,...state,id:episodeId};
    });
  }
  feedbackTask(uid,taskId,body,key,expectedEpoch) {
    return this.transaction(()=>this.receipt(uid,`feedback:${taskId}`,key,body,()=>{
      this.checkExpectedEpoch(uid,expectedEpoch);this.requireConsent(uid);keys(body,['text','expected_version']);
      const task=this.get(uid,'care_task',taskId);check(task.version===body.expected_version,'REVISION_CONFLICT',409);
      const text=this.text(body.text);this.checkQueueAdmission(uid);
      const instructions=task.instruction_refs.map(ref=>{
        const instruction=this.all('fact_revision',uid).find(f=>f.fact_id===ref.fact_id&&f.revision===ref.revision);
        check(instruction&&instruction.field==='instruction','STALE_DEPENDENCY',409);
        for(const e of instruction.evidence)this.get(uid,'source',e.source_id);
        return instruction;
      });
      const guidanceSources=(task.source_refs||[]).map(ref=>{
        const source=this.get(uid,'source',ref.source_id);check(source.text_version===ref.source_text_version,'STALE_DEPENDENCY',409);return source;
      });
      const linked=[...new Set([...instructions.flatMap(f=>f.evidence.map(e=>e.source_id)),...guidanceSources.map(source=>source.id)])];
      check(linked.length<this.limits.retrievalCount,'PAYLOAD_TOO_LARGE',413);
      check(Buffer.byteLength(text)+linked.reduce((n,sid)=>n+Buffer.byteLength(this.get(uid,'source',sid).text),0)<=this.limits.textBytes*2,'PAYLOAD_TOO_LARGE',413);
      const source=this.insert(uid,'source',{kind:'self_report',text,text_version:1,content_hash:hash(text),recorded_at:this.now(),pages:[],input_kind:'care_feedback',derived_source_ids:linked});
      const conversationId=id('chat');
      const feedback=this.insert(uid,'care_feedback',{task_id:task.id,task_version:task.version,task_validity:task.validity,source_id:source.id,source_ids:[source.id,...linked],instruction_refs:structuredClone(task.instruction_refs),instruction_snapshots:structuredClone(instructions),task_snapshot:{text:task.text,source_kind:task.source_kind||'physician_instruction',category:task.category||null,version:task.version,validity:task.validity},guidance_source_refs:structuredClone(task.source_refs||[]),guidance_source_snapshots:structuredClone(guidanceSources),conversation_id:conversationId,recorded_at:this.now()});
      const run=this.newRun(uid,'chat',[source.id,...linked],{conversation_id:conversationId,care_feedback_id:feedback.id});
      const operation=this.insert(uid,'operation',{kind:'care_feedback',status:'committed',task_id:task.id,feedback_id:feedback.id,source_id:source.id,source_ids:[source.id,...linked],run_id:run.id,recorded_at:this.now(),saved:true});
      this.queueRun(run,operation.id);
      return {run_id:run.id,source_id:source.id,conversation_id:conversationId,feedback_id:feedback.id,task_id:task.id,task_validity:task.validity,operation_id:operation.id,saved:true};
    }));
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
        const replacement = body.replaces_change_id ? this.get(uid, "fact_change", body.replaces_change_id) : null;
        if (replacement) {
          check(replacement.status === "pending" && replacement.kind === "correction" && body.kind === "correction" && replacement.proposals.length === 1 && replacement.proposals[0].fact_id === factId && replacement.proposals[0].expected_version === fact.revision, "REVISION_CONFLICT", 409);
          check(replacement.epoch === u.epoch && replacement.consent_version === consent.version, "SCOPE_REVOKED", 403);
        }
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
          ...(body.kind==='correction'?{health_observations:correctionObservations(fact,text)}:{}),
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
        if (replacement) {
          replacement.status = "expired";
          replacement.terminal_reason = "correction_updated";
          replacement.expired_at = this.now();
          this.save("fact_change", replacement);
        }
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
      episode_states: "episode_state",
      care_feedback: "care_feedback",
      fact_revisions: "fact_revision",
      fact_changes: "fact_change",
      results: "result",
      care_tasks: "care_task",
      runs: "run",
      consents: "consent",
      audit: "audit",
      operations: "operation",
      health_overviews:"health_overview",document_transcripts:"document_transcript",
      record_threads:"record_thread",record_summaries:"record_summary",record_confirmations:"record_confirmation",
    }))
      out[name] = this.all(type, uid);
    out.originals = this.db
      .prepare("SELECT source_id,bytes FROM originals WHERE owner=?")
      .all(uid)
      .map((x) => ({
        source_id: x.source_id,
        media_type: this.all("document",uid).find(doc=>doc.source_id===x.source_id)?.media_type || (this.get(uid,"source",x.source_id).input_kind==='pdf'?'application/pdf':'application/octet-stream'),
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
        // Server-derived concern snapshots must be erased with their original dialogue.
        let derivedAdded=true;
        while(derivedAdded){derivedAdded=false;for(const source of this.all('source',uid))if(!sourceIds.includes(source.id)&&source.derived_source_ids?.some(sid=>sourceIds.includes(sid))){sourceIds.push(source.id);derivedAdded=true;}}

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
          "record_thread","record_summary","record_confirmation","health_overview","document_transcript",
          "runtime_binding",
          "fact_revision",
          "fact_change",
          "result",
          "care_task",
          "care_feedback",
          "episode_state",
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
              obj.comparisons?.some(c=>removedFacts.has(c.fact_id)) ||
              obj.dependencies?.some((d) => removedFacts.has(d.fact_id) || sourceIds.includes(d.source_id)) ||
              obj.proposals?.some(
                (p) =>
                  removedFacts.has(p.fact_id) || p.evidence?.some((e) => sourceIds.includes(e.source_id)),
              ) ||
              removed.has(obj.result_id) ||
              removed.has(obj.task_id) ||
              removed.has(obj.episode_id) ||
              removed.has(obj.record_thread_id) ||
              removed.has(obj.fact_change_id);
            if (dependent) {
              removed.add(obj.id);
              expanded = true;
            }
          }
        }
        for (const objectId of removed) {
          this.db.prepare("DELETE FROM objects WHERE id=? AND owner=?").run(objectId, uid);
          this.db.prepare("UPDATE receipts SET outcome='{}' WHERE owner=? AND operation=?").run(uid,`edit:${objectId}`);
        }
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
