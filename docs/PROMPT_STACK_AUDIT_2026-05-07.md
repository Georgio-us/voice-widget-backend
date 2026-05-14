# Prompt Stack Audit

Last updated: 2026-05-14  
Branch: `Split`  
Status: current runtime prompt stack audit. Historical audit text was replaced because it no longer matched active code.

## Main Assistant Prompt Stack

Runtime path: `POST /api/audio/upload` -> `transcribeAndRespond`.

Message order for the main assistant call:

1. `BASE_SYSTEM_PROMPT` from `services/personality.js`
2. inline `EXECUTION_LOCKED` instruction
3. dynamic `GEO_FACTS_V1` built from current canonical execution
4. language instruction (`ru` / `en` / `es`)
5. chronological dialog history (`user` + `assistant`)

Model parameters:

- `model: gpt-4o-mini`
- `temperature: 0.3`
- `stream: false`

## Active Dynamic Facts

`GEO_FACTS_V1` includes:

1. `matchedCount`
2. `geoStatus`
3. `geoReason`
4. `geoTokens`
5. rent feed facts (`rentCount`, `rentCities`, `rentProvinces`)

Current geo statuses:

1. `supported`
2. `limited`
3. `unsupported`
4. `broad`
5. `null`

Important prompt contract:

1. If `matchedCount > 0`, assistant must not say there are no objects in the effective catalog result.
2. If `geoStatus=unsupported` and `matchedCount > 0`, assistant must explain requested geo is outside active catalog and offer available alternatives through the button.
3. If `geoStatus=broad` and `matchedCount > 0`, assistant must explain the active catalog focus and offer available catalog options.
4. If `geoStatus=unsupported` and `matchedCount=0`, assistant must route to manager/contact.
5. Rent availability can only be promised inside runtime rent feed facts.

## UI Contract Around Prompt

The prompt may mention a button, but backend owns button delivery.

Backend emits explicit `ui.systemEvent` for:

1. `open_manager`
   - no new extracted fields;
   - manager/schedule/legal/mortgage/process intent;
   - unsupported geo after supported/limited matched context.
2. `open_results`
   - frontend may infer this from `queryTraceV1.matchedCount > 0` only when no explicit backend event exists.

Frontend must render explicit `ui.systemEvent` before using inferred trace events.

## Other LLM Prompts Still Present

Active:

1. schema-first extraction prompt in `extractInsightsWithLLM()`
   - JSON-only;
   - `temperature: 0`;
   - sanitized into approved insight keys.

Legacy/non-main:

1. deprecated GPT analysis block remains in `audioController.js`;
2. RMv3 server facts / guardrails helpers remain in file but are not part of the main assistant prompt stack;
3. reference fallback classifier remains separate diagnostic/clarification infrastructure.

## Current Risks

1. `audioController.js` still contains legacy prompt/scaffold code, so code readers can confuse inactive helpers with the active prompt stack.
2. `BASE_SYSTEM_PROMPT` still has broad consultative behavior; `GEO_FACTS_V1` is the grounding layer that keeps catalog claims aligned.
3. Prompt text and UI event delivery must be checked together. A correct phrase without the backend `ui.systemEvent` is a contract failure.
