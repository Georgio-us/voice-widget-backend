import { logEvent, EventTypes, buildPayload } from './eventLogger.js';
import { appendMessage } from './sessionLogger.js';

const getCardsForLog = (cards) => Array.isArray(cards) && cards.length > 0
  ? cards.map(card => ({
      id: card.id,
      city: card.city || null,
      district: card.district || null,
      priceEUR: card.priceEUR || null,
      rooms: card.rooms || null
    }))
  : [];

export const logAudioUserTurn = ({ req, session, sessionId, transcription, inputTypeForLog, userIp, userAgent }) => {
  const audioDurationMs = req.file ? null : null;

  logEvent({
    sessionId,
    eventType: EventTypes.USER_MESSAGE,
    userIp,
    userAgent,
    source: 'backend',
    payload: buildPayload({
      inputType: inputTypeForLog,
      text: transcription,
      textLength: transcription.length,
      audioDurationMs,
      stage: session.stage,
      clientProfile: {
        language: session.clientProfile.language,
        location: session.clientProfile.location,
        budgetMin: session.clientProfile.budgetMin,
        budgetMax: session.clientProfile.budgetMax,
        purpose: session.clientProfile.purpose,
        propertyType: session.clientProfile.propertyType,
        urgency: session.clientProfile.urgency
      },
      insights: session.insights,
      cardsCount: session.shownSet ? session.shownSet.size : 0
    })
  }).catch(err => {
    console.error('❌ Failed to log user_message event:', err);
  });

  appendMessage({
    sessionId,
    role: 'user',
    message: {
      inputType: inputTypeForLog,
      text: transcription,
      ...(req.file ? { transcription: transcription } : {}),
      meta: {
        stage: session.stage,
        insights: session.insights
      }
    },
    userAgent,
    userIp
  }).catch(err => {
    console.error('❌ Failed to append user message to session log:', err);
  });
};

export const logAudioAssistantTurn = ({
  session,
  sessionId,
  botResponse,
  cards,
  inputTypeForLog,
  promptTokens,
  completionTokens,
  totalTokens,
  transcriptionTime,
  gptTime,
  totalTime,
  userIp,
  userAgent
}) => {
  const messageId = `${sessionId}_${Date.now()}`;
  const cardsForLog = getCardsForLog(cards);
  const messageText = botResponse ? botResponse.substring(0, 200) : null;

  logEvent({
    sessionId,
    eventType: EventTypes.ASSISTANT_REPLY,
    userIp,
    userAgent,
    source: 'backend',
    payload: buildPayload({
      messageId,
      messageText,
      hasCards: cards.length > 0,
      cards: cardsForLog,
      inputType: inputTypeForLog,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens
      },
      timing: {
        transcription: transcriptionTime,
        gpt: gptTime,
        total: totalTime
      },
      stage: session.stage,
      insights: session.insights
    })
  }).catch(err => {
    console.error('❌ Failed to log assistant_reply event:', err);
  });

  appendMessage({
    sessionId,
    role: 'assistant',
    message: {
      text: botResponse,
      cards: cardsForLog,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens
      },
      timing: {
        transcription: transcriptionTime,
        gpt: gptTime,
        total: totalTime
      },
      meta: {
        stage: session.stage,
        insights: session.insights
      }
    },
    userAgent,
    userIp
  }).catch(err => {
    console.error('❌ Failed to append assistant message to session log:', err);
  });

  return { messageId, cardsForLog };
};
