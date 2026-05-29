import { INSIGHTS_RESPONSE_SCHEMA, parseStructuredInsightsResponse } from './aiExtractionContract.js';
import { callOpenAIWithRetry } from './openAiRetryService.js';

export const callStructuredInsightsLlm = async ({ openai, messages } = {}) => {
  const gptStart = Date.now();
  let completion = await callOpenAIWithRetry(() =>
    openai.chat.completions.create({
      messages,
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: INSIGHTS_RESPONSE_SCHEMA },
      stream: false
    }), 2, 'GPT'
  );

  const gptTime = Date.now() - gptStart;

  let promptTokens = Number(completion?.usage?.prompt_tokens || 0);
  let completionTokens = Number(completion?.usage?.completion_tokens || 0);
  let totalTokens = Number(completion?.usage?.total_tokens || 0);

  let rawModelContent = String(completion?.choices?.[0]?.message?.content || '').trim();
  let parsedStructured = parseStructuredInsightsResponse(rawModelContent);
  let fallbackUsed = false;

  if (parsedStructured.parseError) {
    fallbackUsed = true;
    const fallbackMessages = [
      ...messages,
      {
        role: 'system',
        content: 'Repair mode: output ONLY valid JSON by insights_response schema.'
      }
    ];
    const fallbackCompletion = await callOpenAIWithRetry(() =>
      openai.chat.completions.create({
        messages: fallbackMessages,
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: INSIGHTS_RESPONSE_SCHEMA },
        stream: false
      }), 1, 'GPT-Structured-Fallback'
    );
    promptTokens += Number(fallbackCompletion?.usage?.prompt_tokens || 0);
    completionTokens += Number(fallbackCompletion?.usage?.completion_tokens || 0);
    totalTokens += Number(fallbackCompletion?.usage?.total_tokens || 0);
    rawModelContent = String(fallbackCompletion?.choices?.[0]?.message?.content || '').trim();
    parsedStructured = parseStructuredInsightsResponse(rawModelContent);
    completion = fallbackCompletion;
  }

  return {
    completion,
    gptTime,
    promptTokens,
    completionTokens,
    totalTokens,
    rawModelContent,
    parsedStructured,
    fallbackUsed
  };
};
