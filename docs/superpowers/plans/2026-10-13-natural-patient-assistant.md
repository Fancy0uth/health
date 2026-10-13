# Natural patient assistant redesign

User explicitly requests a conversational assistant that understands symptoms, proactively clarifies, accepts corrections, and only organizes records / generates cards after confirmation. This is implementation authorization; do not add redundant approval gates or distribute/push without request.

## Contract
- Keep one Agnes SDK runtime and five scoped business tools. Replace rigid conversational output with payload format_version=2 and natural `reply` for assistant_reply. Legacy payloads continue rendering.
- For v2 chat, speech/claims are evidence metadata, not visible reply text. Claims may be empty; validate any evidence submitted, but do not require exact-quote visible speech. No regex bans on digits/frequency/duration/question punctuation.
- For v2 visit, speech is a natural patient-facing synthesis; claims retain exact evidence separately. It must preserve uncertainty, negate prior corrected statements appropriately, omit product commands, avoid unsupported diagnoses, and remain editable.
- Main composer always talks to chat. Legacy record threads remain accessible, but ordinary new messages do not start entry extraction.
- Model intents support clarify/prepare/records/scope/greeting and offer/confirm for visit, record, or both. Offers contain a readable summary and requested action. Current pending offer identity is included in context. V2 confirmation supplies exact current-user confirmation_quote and confirmation_offer_id. Server verifies current unconsumed offer, matching action, conversation, latest user turn and runtime receipts, not a closed whitelist of affirmative sentences. Model identifies refusal/corrections/deferred consent; no action is created for those.
- confirmed visit => existing continuation_run_id. confirmed record => continuation_record_run_id, an entry workflow assembling authorized conversation sources; candidates remain pending patient fact verification (record saved, never silently calls medically verified). both => both separately queued, no duplicate on replay.
- Natural assistant context includes complete prior assistant replies and current action outcomes. Pure chat is not a formal health record. Saved drafts/artifacts have truthful status and quiet view links. No repeated promotional CTA or metadata dumps.

## Work split
1. Backend domain: v2 validation, natural context, scoped offers/confirmations and record/both continuations, no premature health entries; corresponding domain tests. Own domain-store, record-dialogue, domain-server.
2. Frontend: v2 reply renderer, unified main composer, quiet record/card progress with reload and failure handling. Own packages/client and apps/web/mobile plus client tests. Preserve legacy historical rendering.
3. Runtime prompts/schema: natural patient dialogue and visit synthesis, supported offer/confirmation protocol, schemas synchronized and asset hashes updated; runtime tests. Own agents/runtime and contracts/schemas.
4. Root: integrate, review consent/correction/failure behaviors, full suite, actual browser Agnes sequence: simple discomfort -> short answers -> correction -> refusal -> explicit save/card confirmation -> verify outputs and edit/save. Synthetic isolated account; retain user's local credentials and records.

## Acceptance
- Plain one-sentence discomfort gets a relevant natural reply and focused question.
- Short follow-ups resolve against assistant history, corrections supersede old details.
- Conversation does not promote sources into confirmed facts.
- Offers are not commands; refusal / inquiry / quoted instructions / conditionals don't create artifacts.
- Explicit consent can use natural phrasing without brittle keyword grammar; scope/replay safeguards remain.
- Real model run produces concise coherent card and record, inspectable provenance, no duplicated body paragraphs or fixed template metadata.
- Full tests and browser verification on desktop/mobile; leave updated local app open. Report actual evidence and limitations.
