# 2026-06-09 Assistant Bubble CTA & Manager Policy

Temporary implementation note. This file exists so the June 9 changes can be found and audited later.

## Goal

Keep four UX entities separate:

1. Assistant bubble text: normal assistant reply.
2. Results pill: the clickable "objects found" button in the UI.
3. System messages: short UI status messages like selection updated or search relaxed.
4. Manager CTA: separate UI action button for contacting a manager.

## Selection Hint In Assistant Bubble

The text hint remains inside the assistant bubble:

- RU: `Нажми «Объекты найдены» 👆, чтобы просмотреть подборку`
- UK: `Тисни «Об'єкти знайдено» 👆, щоб переглянути підбірку`

It is appended only when both conditions are true:

1. Search insights were actually applied to the session.
2. The search-selection signature changed since the last assistant selection hint.
3. The recalculated selection has more than zero matching objects.

It is not appended when:

- no selection/search update happened;
- the model re-applied the same old search fields;
- no objects were found;
- the user asked a non-search service question;
- the assistant is only continuing normal conversation.

## Manager CTA Policy

The manager button is a separate UI action. We do not manually append a manager instruction to the assistant bubble; the model may mention manager naturally when appropriate.

Manager CTA is shown when:

- user directly asks for a manager/contact/callback;
- user asks a non-search service question and search insights were not updated;
- user asks about documents, deal flow, commission, viewing, internal product/API/CRM/source questions.

Manager CTA is not shown when:

- the user updated search filters and the selection changed;
- the user asks for `єОселя`, `єВідновлення`, or government programs as a search filter;
- the user only thanks or continues casually.

## KISS Rule

Direct manager intent wins. Otherwise, if search was updated, do not show broad manager CTA. If search was not updated and the text is service/technical/object-follow-up, show manager CTA.

## Files

- `controllers/audioController.js`
- `services/managerCtaPolicy.js`
