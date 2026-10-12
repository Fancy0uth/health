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
export function validateCandidate(c, readSource) {
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
  const markers = classifySourceMarkers(quote),
    { neg, uncertain, past } = markers;
  valid(!markers.unsupported && !markers.ambiguous);
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
  if (c.field === "instruction")
    valid(
      refs.every((x) => x.source.kind === "medical_document") &&
        /(请|嘱|建议|按时|每日|每天|复查|复诊|\btake\b|\breturn\b|\brecord\b)/i.test(quote) &&
        !neg &&
        !uncertain &&
        !past,
    );
  if (c.field === "diagnosis") valid(/(诊断|确诊|考虑|待排|疑似|diagnos)/i.test(quote));
  if (c.field === "medication") valid(/(服用|用药|药物|口服|静滴|\bmedication\b|\btake\b)/i.test(quote));
  if (c.field === "allergy") valid(/(过敏|allerg)/i.test(quote));
  if (c.field === "test") valid(/(检查|检验|报告|化验|test|scan)/i.test(quote));
  const time = c.effective_time;
  keys(time, ["raw", "precision", "start", "end", "timezone", "anchor_source_id"]);
  valid(["exact", "interval", "relative", "unknown"].includes(time.precision));
  valid(refs.some((x) => x.source.id === time.anchor_source_id));
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
  return structuredClone(c);
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
  const neg = /(否认|未见|没有|无|未发现|\bno\b|\bdenies\b|\bwithout\b)/i.test(quote);
  const uncertain = /(考虑|待排|可能|疑似|不确定|不详|\bpossible\b|\bsuspected\b|\bmay\b)/i.test(quote);
  const past = /(既往|曾|以前|过去|去年|\bhistory of\b|\bpreviously\b)/i.test(quote);
  const current = /(目前|现在|今日|今天|当前|\bcurrently\b|\btoday\b)/i.test(quote);
  return {
    assertion: uncertain ? "uncertain" : neg ? "negated" : "affirmed",
    temporal_scope: past ? "past" : current ? "current" : "unknown",
    ambiguous: past && current,
    unsupported: /(未提及|未询问|不详|not mentioned|not assessed)/i.test(quote),
    neg,
    uncertain,
    past,
  };
}

// Recognize only declared literal forms. Enclosing spans retain qualifiers and all
// simultaneous cues; never turn an offset into a calendar date or clinical rule.
export function literalSourceTime(quote, sourceId) {
  const number =
    "(?:[0-9]+|one|two|three|four|five|six|seven|eight|nine|ten|十一|十二|[一二三四五六七八九十两]+)";
  const date =
    "(?:[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}|[0-9]{4}/[0-9]{1,2}/[0-9]{1,2}|[0-9]{4}年[0-9]{1,2}月[0-9]{1,2}日)";
  const relative =
    "(?:每[日天周月]|" +
    number +
    "(?:小时|天|日|周|个月|月)(?:后|前)|\\b(?:daily|weekly|monthly|every (?:day|week|month)|(?:after|before|in) (?:about |approximately |at least |at most )?" +
    number +
    " (?:days?|weeks?|months?|hours?)|(?:last|next) (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month|year))\\b)";
  const pattern = new RegExp(
    "(?:大约|约|至少|最多|about |approximately |at least |at most )?(?:" +
      date +
      "|" +
      relative +
      ")(?:左右|以内|之前|之后)?",
    "gi",
  );
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
