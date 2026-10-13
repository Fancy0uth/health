import {validateObservations} from "./health-profile.mjs";
import { check, fail } from "./domain-errors.mjs";
const calendarDate = (x) =>
  typeof x === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(x) &&
  Number.isFinite(Date.parse(x)) &&
  new Date(x).toISOString().slice(0, 10) === x;
const valid = (x, details) => {
  if (!x) fail(422, "INVALID_AGENT_OUTPUT", "原文支持或字段格式校验失败。", details);
};
export function keys(value, allowed, required = allowed) {
  valid(value && typeof value === "object" && !Array.isArray(value));
  valid(Object.keys(value).every((k) => allowed.includes(k)));
  valid(required.every((k) => Object.hasOwn(value, k)));
}
export function validateEvidence(evidence, readSource) {
  valid(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= 20);
  return evidence.map((e) => {
    keys(e, ["source_id", "source_text_version", "locator", "quote"]);
    keys(e.locator, ["page", "start", "end"]);
    const s = readSource(e.source_id),
      { start, end, page } = e.locator;
    valid(
      s.text_version === e.source_text_version &&
        Number.isSafeInteger(start) &&
        Number.isSafeInteger(end) &&
        start >= 0 &&
        end > start &&
        end <= s.text.length &&
        typeof e.quote === "string" &&
        s.text.slice(start, end) === e.quote,
      {
        path: "evidence.locator",
        rule: "Use the exact sentence_spans locator and source_text_version returned by read_source; do not estimate offsets.",
      },
    );
    valid(start === 0 || /[。！？!?\n；;]/.test(s.text[start - 1]));
    valid(end === s.text.length || /[。！？!?\n；;]/.test(s.text[end - 1]));
    if (s.pages?.length)
      valid(
        Number.isSafeInteger(page) &&
          s.pages.some((p) => p.page === page && start >= p.start && end <= p.end),
      );
    else
      valid(page === null, {
        path: "evidence.locator.page",
        expected: null,
        rule: "Pasted text has no PDF page.",
      });
    return { source: s, evidence: e };
  });
}
export function validateCandidate(c, readSource, {semantic=false}={}) {
  keys(
    c,
    [
      "field",
      "value",
      "assertion",
      "temporal_scope",
      "effective_time",
      "evidence",
      "proposal_kind",
      "fact_id",
      "expected_version",
      "episode_id",
      "health_observations",
    ],
    ["field", "value", "assertion", "temporal_scope", "effective_time", "evidence", "proposal_kind"],
  );
  valid(
    [
      "reported_text",
      "symptom",
      "diagnosis",
      "medication",
      "instruction",
      "allergy",
      "test",
      "observation",
    ].includes(c.field),
  );
  valid(
    ["affirmed", "negated", "uncertain"].includes(c.assertion) &&
      ["current", "past", "unknown"].includes(c.temporal_scope),
  );
  valid(["new", "correction", "retraction"].includes(c.proposal_kind));
  const refs = validateEvidence(c.evidence, readSource);
  // Intentionally conservative: preserve a complete source sentence verbatim, not an inferred diagnosis or dose.
  valid(typeof c.value === "string" && refs.every(({ evidence: e }) => e.quote === c.value), {
    path: "candidate.value",
    rule: "Value must equal every primary evidence quote verbatim, including source prefixes and punctuation.",
  });
  for (const { source: s, evidence: e } of refs) {
    const { start, end } = e.locator;
    valid(start === 0 || /[。！？!?\n；;]/.test(s.text[start - 1]));
    valid(end === s.text.length || /[。！？!?\n；;]/.test(s.text[end - 1]));
  }
  // Each reference must support the rendered value itself. Unrelated sentences cannot lend semantics.
  const quote = c.value;
  if(c.health_observations!==undefined)validateObservations(c.health_observations,quote);
  const markers = classifySourceMarkers(quote),
    { neg, uncertain, past } = markers;
  const withdrawalReason = c.proposal_kind === "retraction" && c.field === "reported_text";
  if(!semantic){
  valid(!markers.ambiguous);
  valid(!markers.unsupported || withdrawalReason, {
    path: "candidate.assertion",
    rule: "Information missing or unknown is not an affirmed/negated clinical fact. Keep the original source without a new/corrected candidate. An explicit reported_text retraction may retain the uncertain reason.",
  });
  valid(c.assertion === markers.assertion, {
    path: "candidate.assertion",
    expected: markers.assertion,
    rule: "Preserve uncertainty and negation markers in the complete source sentence.",
  });
  valid(c.temporal_scope === markers.temporal_scope, {
    path: "candidate.temporal_scope",
    expected: markers.temporal_scope,
    rule: "Only explicit past/current source markers justify these tags.",
  });
  }
  if (c.field === "instruction")
    valid(
      refs.every((x) => x.source.kind === "medical_document") &&
        /(请|嘱|建议|按时|每日|每天|复查|复诊|\btake\b|\breturn\b|\brecord\b)/i.test(quote) &&
        !neg &&
        !uncertain &&
        !past,
    );
  const fieldHint={path:'candidate.field',rule:'The exact source does not support this clinical category. Use observation or reported_text for a general patient observation, preserving value, evidence and supported health_observations unchanged; do not add a diagnosis, prescription or laboratory interpretation.'};
  if (c.field === "diagnosis") valid(/(诊断|确诊|考虑|待排|疑似|diagnos)/i.test(quote),fieldHint);
  if (c.field === "medication") valid(/(服用|用药|药物|口服|静滴|\bmedication\b|\btake\b)/i.test(quote),fieldHint);
  if (c.field === "allergy") valid(/(过敏|allerg)/i.test(quote),fieldHint);
  if (c.field === "test") valid(
    /(检查|检验|报告|化验|test|scan)/i.test(quote) ||
      c.health_observations?.some(o=>o.dimension==='measurement'&&/[0-9]/.test(o.value)),
    fieldHint,
  );
  validateSourceTime(
    c.effective_time,
    quote,
    refs.map(({ source }) => source.id),
  );
  return structuredClone(c);
}

// Also validate legacy confirmed instruction metadata at continuation: equality
// with a stored raw value alone does not establish that it expresses time.
export function validateSourceTime(time, quote, sourceIds) {
  keys(time, ["raw", "precision", "start", "end", "timezone", "anchor_source_id"]);
  valid(["exact", "interval", "relative", "unknown"].includes(time.precision));
  valid(sourceIds.includes(time.anchor_source_id));
  const literal = literalSourceTime(quote, time.anchor_source_id);
  if (literal.raw !== null) {
    valid(time.raw === literal.raw, {
      path: "candidate.effective_time.raw",
      expected: literal.raw,
      rule: "Preserve the full literal source-time span, including qualifiers. See read_source sentence_annotations; do not infer calendar dates.",
    });
    if (literal.precision === "relative")
      valid(time.precision === "relative", {
        path: "candidate.effective_time.precision",
        expected: "relative",
      });
    else
      valid(time.precision === "unknown" || (calendarDate(literal.raw) && time.precision === "exact"), {
        path: "candidate.effective_time.precision",
        expected: "unknown",
        rule: "Qualified, malformed, non-normalized or multiple date cues stay literal with null endpoints.",
      });
  }
  if (literal.raw === null) {
    const weak = typeof time.raw === "string" && weakSourceTimes(quote).includes(time.raw);
    valid(
      (time.raw === null && time.precision === "unknown") ||
        (weak && ["relative", "unknown"].includes(time.precision)),
      {
        path: "candidate.effective_time",
        expected: literal,
        rule: "Without a recognized time cue, use unknown/raw=null or a supported literal past/current marker; action text is not time.",
      },
    );
  }
  valid(time.timezone === null || time.timezone === "Asia/Shanghai" || time.timezone === "UTC");
  if (time.precision === "unknown")
    valid(
      (time.raw === null ||
        (typeof time.raw === "string" && time.raw.length > 0 && quote.includes(time.raw))) &&
        time.start === null &&
        time.end === null,
    );
  else {
    valid(typeof time.raw === "string" && time.raw.length > 0 && quote.includes(time.raw));
    if (time.precision === "relative") valid(time.start === null && time.end === null);
    else {
      valid(calendarDate(time.start) && time.raw.includes(time.start));
      valid(
        time.end === null ||
          (calendarDate(time.end) && time.raw.includes(time.end) && time.end >= time.start),
      );
      valid(time.precision !== "interval" || time.end !== null);
    }
  }
}

function weakSourceTimes(quote) {
  const marker = String.raw`(?:目前|现在|今日|今天|当前|既往|曾经|曾|以前|过去|去年|\bhistory of\b|\bpreviously\b|\bcurrently\b|\btoday\b)`;
  // Individual markers and whole adjacent marker groups, bounded linear scans.
  // Do not enumerate arbitrary substrings or borrow intervening action words.
  const single = [...quote.matchAll(new RegExp(marker, "gi"))].map((match) => match[0]);
  const groups = [...quote.matchAll(new RegExp(`${marker}(?:\\s*${marker})*`, "gi"))].map(
    (match) => match[0],
  );
  // These source-relative phrases carry no inferred calendar date. Limit them
  // to time-of-day and meal/sleep anchors; never absorb following action text.
  const day=String.raw`(?:今天|今日|昨天|昨日|前天|明天|明日|后天)`;
  const part=String.raw`(?:凌晨|清晨|早晨|早上|上午|中午|午后|下午|傍晚|晚上|夜里|夜间)`;
  const anchor=String.raw`(?:(?:早饭|早餐|午饭|午餐|晚饭|晚餐|饭|餐)(?:前|后)|睡前|睡觉前|起床后|起床时)`;
  const natural=String.raw`(?:${day}(?:${part})?(?:${anchor})?|(?:今早|今晨|今晚|今夜|昨早|昨晚|昨夜|明早|明晚|前晚)(?:${anchor})?|${anchor}|最近几天|这几天|近几天|这两天|近日|最近|上周|本周|这周|下周|上个月|这个月|上月|本月|下月|\b(?:this (?:morning|afternoon|evening)|last night|yesterday(?: (?:morning|afternoon|evening))?|tomorrow(?: (?:morning|afternoon|evening))?|before breakfast|after breakfast|before lunch|after lunch|before dinner|after dinner|at bedtime)\b)`;
  const naturalTimes=[...quote.matchAll(new RegExp(natural,'gi'))].map(match=>match[0]);
  return [...new Set([...single, ...groups, ...naturalTimes])];
}

// Mechanical source locators, never medical extraction or model output repair.
export function sentenceSpans(source) {
  const spans = [];
  let bytes = 0;
  for (const match of source.text.matchAll(/[^。！？!?；;\n]+(?:[。！？!?；;]|\n|$)/gu)) {
    if (!match[0].trim()) continue;
    bytes += Buffer.byteLength(match[0]);
    if (spans.length >= 100 || bytes > 32768) fail(413, "SOURCE_SPANS_LIMIT");
    const start = match.index,
      end = start + match[0].length;
    const page = source.pages?.length
      ? source.pages.find((p) => start >= p.start && end <= p.end)?.page
      : null;
    if (page === undefined) fail(422, "SOURCE_SPAN_CROSSES_PAGE");
    spans.push({
      source_id: source.id,
      source_text_version: source.text_version,
      locator: { page, start, end },
      quote: match[0],
    });
  }
  return spans;
}

// Finite surface markers only; these annotations do not assert clinical meaning.
export function classifySourceMarkers(quote) {
  // Finite information-absence markers take precedence over ordinary negation.
  // Unsupported new/corrected facts remain source-only; withdrawal reasons can
  // retain uncertainty because they remove, rather than assert, an active fact.
  const missingness =
    /(未提及|未询问|不详|不知道|不清楚|未知|(?:未|没(?:有)?|无)(?:记录|记载|提供)|\b(?:unknown|not\s+(?:mentioned|assessed|known|recorded|documented|provided)|(?:do|does)\s+not\s+know|(?:don|doesn)['’]t\s+know|no\s+(?:information|records?))\b)/i.test(
      quote,
    );
  const neg = /(否认|未见|没有|无|未发现|\bno\b|\bdenies\b|\bwithout\b)/i.test(quote);
  const uncertain =
    missingness || /(考虑|待排|可能|疑似|不确定|不详|\bpossible\b|\bsuspected\b|\bmay\b)/i.test(quote);
  const past = /(既往|曾|以前|过去|去年|\bhistory of\b|\bpreviously\b)/i.test(quote);
  const current = /(目前|现在|今日|今天|当前|\bcurrently\b|\btoday\b)/i.test(quote);
  return {
    assertion: uncertain ? "uncertain" : neg ? "negated" : "affirmed",
    temporal_scope: past ? "past" : current ? "current" : "unknown",
    ambiguous: past && current,
    unsupported: missingness,
    neg,
    uncertain,
    past,
  };
}

// Recognize only declared literal forms. Enclosing spans retain qualifiers and all
// simultaneous cues; never turn an offset into a calendar date or clinical rule.
export function literalSourceTime(quote, sourceId) {
  // Capture whole numeric/date-like tokens, including invalid widths and decimal
  // components. Boundaries prohibit extracting a valid-looking suffix/prefix.
  const numeric = String.raw`[+-]?[0-9]+(?:[.,][0-9]+)*`;
  const number = String.raw`(?:${numeric}|one|two|three|four|five|six|seven|eight|nine|ten|十一|十二|[一二三四五六七八九十两]+)`;
  const dateNumber = String.raw`[+-]?[0-9]+(?:\.[0-9]+)*`;
  const date = String.raw`(?:${dateNumber}-${dateNumber}-${dateNumber}|${dateNumber}/${dateNumber}/${dateNumber}|${dateNumber}年${dateNumber}月${dateNumber}日)`;
  const numericRelative = String.raw`${number}(?:小时|天|日|周|个月|月)(?:后|前)`;
  const wordRelative = String.raw`(?:每[日天周月]|\b(?:daily|weekly|monthly|every (?:day|week|month)|(?:after|before|in)\s+(?:(?:about|approximately|at least|at most)\s+)?${number}\s+(?:days?|weeks?|months?|hours?)|(?:last|next) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year))\b)`;
  const qualifier = String.raw`(?:(?:大约|约|至少|最多|\babout|\bapproximately|\bat least|\bat most)\s*)?`;
  const suffix = String.raw`(?:\s*(?:左右|以内|之前|之后))?`;
  // A comma can separate two dates; within a numeric offset it must not expose
  // a suffix such as 5天后 from the literal 1,5天后.
  const dateCue = String.raw`(?<![A-Za-z0-9_.+/-])${qualifier}${date}${suffix}(?![A-Za-z0-9_/+-]|\.[0-9])`;
  const numericCue = String.raw`(?<![A-Za-z0-9_.,+/-])${qualifier}${numericRelative}${suffix}(?![A-Za-z0-9_/+-]|[.,][0-9])`;
  // Word cues use word boundaries: ordinary punctuation is not part of a number.
  const wordCue = String.raw`(?<![A-Za-z0-9_])${qualifier}${wordRelative}${suffix}(?![A-Za-z0-9_])`;
  const pattern = new RegExp(`${dateCue}|${numericCue}|${wordCue}`, "gi");
  const matches = [...quote.matchAll(pattern)];
  const raw = matches.length
    ? quote.slice(matches[0].index, matches.at(-1).index + matches.at(-1)[0].length)
    : null;
  const containsDate = raw !== null && new RegExp(date).test(raw);
  return {
    raw,
    precision: raw === null || containsDate ? "unknown" : "relative",
    start: null,
    end: null,
    timezone: null,
    anchor_source_id: sourceId,
  };
}

export function sentenceAnnotations(source) {
  return sentenceSpans(source).map((e) => {
    const markers = classifySourceMarkers(e.quote);
    return {
      locator: e.locator,
      assertion: markers.assertion,
      temporal_scope: markers.temporal_scope,
      ambiguous: markers.ambiguous,
      unsupported: markers.unsupported,
      effective_time: literalSourceTime(e.quote, source.id),
    };
  });
}

// A compact reference selects an immutable complete sentence, never model text.
// Callers supply the same-owner, already-read source authorization boundary.
export function materializeSentenceCandidate(ref,readSource,path){
  keys(ref,['source_id','sentence_index','field','health_observations'],['source_id','sentence_index','field']);
  valid(typeof ref.source_id==='string'&&Number.isSafeInteger(ref.sentence_index)&&ref.sentence_index>=0,{path,rule:'Copy an authorized source_id and zero-based integer sentence_index from indexed_sentences.'});
  const source=readSource(ref.source_id),span=sentenceSpans(source)[ref.sentence_index],annotation=sentenceAnnotations(source)[ref.sentence_index];
  valid(!!span,{path:path+'.sentence_index',rule:'Copy the exact source_id and zero-based sentence_index from the authorized indexed_sentences.'});
  valid(!annotation.unsupported&&!annotation.ambiguous,{path,rule:'This sentence has missing information or mixed temporal scope. Preserve its uncertainty in the overview and immutable source; do not select it as a clinical fact.'});
  return {field:ref.field,value:span.quote,assertion:annotation.assertion,temporal_scope:annotation.temporal_scope,effective_time:annotation.effective_time,evidence:[span],proposal_kind:'new',...(ref.health_observations!==undefined?{health_observations:ref.health_observations}:{})};
}

// Finite literal disagreement, not an allergy diagnosis or a general conflict
// heuristic. Unknown allergens and qualified/time-separated histories are left
// to model comparison; this only preserves an unresolved drug-history pair.
export function definiteDrugAllergyDisagreement(a,b){
  if(a.field!=='allergy'||b.field!=='allergy')return false;
  const qualified=/[0-9０-９]|首次|新发|新出现|最近|近期|近日|今天|今日|昨天|昨日|本次|这次|后来|之后|以后|曾否认|已否认|已排除|尚待|待确认|不确定|可能|疑似|考虑|食物|海鲜|花粉|尘螨|环境/;
  const denial=v=>{
    const m=classifySourceMarkers(v.value);
    return v.assertion==='negated'&&m.assertion==='negated'&&!m.ambiguous&&!qualified.test(v.value)&&
      /^(?:(?:既往史|过敏史|药物过敏史)[：:]\s*)?(?:否认|无|没有|未见)药物过敏(?:史)?[。.!！]?\s*$/.test(v.value.trim());
  };
  const positive=v=>{
    const m=classifySourceMarkers(v.value);
    return v.assertion==='affirmed'&&m.assertion==='affirmed'&&!m.ambiguous&&!m.unsupported&&!qualified.test(v.value)&&
      /^(?:(?:过敏史|既往史|药物过敏史)[：:]\s*)?(?:曾经|曾|既往)?(?:有|对)?(?:药物|(?:青霉素|阿莫西林|头孢菌素|阿司匹林|布洛芬|磺胺)(?:类)?(?:药物)?)过敏(?:史)?$/.test(v.value.trim().split(/[，,。.!！]/)[0]);
  };
  return denial(a)&&positive(b)||denial(b)&&positive(a);
}

// Explanations are separate model paraphrases. Original task text remains exact.
export function validateCareExplanation(task,instructions) {
  const original=instructions.map(i=>i.value).join('\n');
  const texts=[];
  if(task.explanation!==undefined){valid(typeof task.explanation==='string'&&task.explanation.trim().length>0&&task.explanation.length<=4000,{path:'task.explanation',rule:'Provide a nonempty paraphrase of at most 4000 characters.'});texts.push(['explanation',task.explanation]);}
  if(task.questions!==undefined){valid(Array.isArray(task.questions)&&task.questions.length<=10,{path:'task.questions'});task.questions.forEach((q,i)=>{valid(typeof q==='string'&&q.trim().length>0&&q.length<=1000&&/[？?]$/.test(q),{path:`task.questions[${i}]`,rule:'Use short questions, not new instructions.'});texts.push([`questions[${i}]`,q]);});}
  const quantities=(text,dateQuestion=false)=>[...text.matchAll(/(?:[0-9]+(?:[.,][0-9]+)?\s*(?:mg|ml|g|毫克|毫升|克|片|粒|滴|次|天|日|周|月|小时|分钟|%|度)?|[一二三四五六七八九十百两]+\s*(?:毫克|毫升|克|片|粒|滴|次|天|日|周|月|小时|分钟|度)|每[日天周月]|\b(?:daily|weekly|monthly|once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten)\b)/gi)].filter(m=>!(dateQuestion&&/^一(?:天|日|周|月)$/.test(m[0])&&text[m.index-1]==='哪')).map(m=>m[0].replace(/\s+/g,'').toLowerCase().replace(/^(?:每天|daily)$/,'每日').replace(/^weekly$/,'每周').replace(/^monthly$/,'每月'));
  const sourceQuantities=quantities(original);
  for(const [field,text]of texts){
    valid(quantities(text,field.startsWith('questions')).every(q=>sourceQuantities.includes(q)),{path:`task.${field}`,rule:'Do not add or change quantities, doses, frequencies or dates absent from the original instruction.'});
    // A neutral question or explicit prohibition may mention adjustment; advice may not.
    for(const sentence of text.split(/[，,。！!；;\n]|但是|不过|然而|但/).filter(Boolean)){
      const change=/(停药|停用|停服|加量|减量|加药|减药|换药|增减|翻倍|倍增|减半|不再(?:服|用|吃)药|停止(?:服|用|吃)药|调整.{0,8}(剂量|药量|用药)|double.{0,15}dose|stop.{0,15}(medication|medicine)|increase.{0,15}dose|reduce.{0,15}dose)/i.test(sentence);
      const guarded=/(不要|不可|不能|勿|不应|不得|不建议|do not|don't|never).{0,20}(停药|停用|停服|加量|减量|加药|减药|换药|增减|翻倍|倍增|减半|不再(?:服|用|吃)药|停止(?:服|用|吃)药|调整|double|stop|increase|reduce)/i.test(sentence);
      const neutral=field.startsWith('questions')&&/(医生|药师|医护|doctor|pharmacist)/i.test(sentence)&&!/(可以|建议|应该|请)(?:自行)?(?:停|加|减|换)/.test(sentence);
      valid(!change||guarded||neutral,{path:`task.${field}`,rule:'A model explanation never grants medication changes. Retain the original instruction and ask a clinician about ambiguities.'});
    }
  }
}
