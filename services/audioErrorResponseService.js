import { logEvent, EventTypes, buildPayload } from './eventLogger.js';
import { appendMessage } from './sessionLogger.js';

const classifyAudioError = (error) => {
  let userMessage = 'Произошла техническая ошибка. Попробуйте еще раз.';
  let statusCode = 500;
  const message = String(error?.message || '');

  if (message.includes('OpenAI') || message.includes('API')) {
    userMessage = 'Сервис ИИ временно недоступен. Попробуйте через минуту.';
    statusCode = 503;
  } else if (message.includes('audio') || message.includes('transcription')) {
    userMessage = 'Не удалось обработать аудио. Попробуйте записать заново.';
    statusCode = 422;
  } else if (message.includes('timeout')) {
    userMessage = 'Запрос выполняется слишком долго. Попробуйте сократить сообщение.';
    statusCode = 408;
  }

  return { userMessage, statusCode };
};

export const sendAudioErrorResponse = ({ req, res, error, sessionId, userIp, userAgent }) => {
  console.error(`❌ Ошибка [${sessionId?.slice(-8) || 'unknown'}]:`, error.message);

  const { userMessage, statusCode } = classifyAudioError(error);
  const stackTruncated = error.stack ? error.stack.substring(0, 500) : null;

  logEvent({
    sessionId: sessionId || null,
    eventType: EventTypes.ERROR,
    userIp,
    userAgent,
    source: 'backend',
    payload: buildPayload({
      scope: 'backend',
      message: error.message,
      stack: stackTruncated,
      meta: {
        statusCode,
        path: req.path,
        method: req.method,
        eventType: 'transcribeAndRespond'
      }
    })
  }).catch(err => {
    console.error('❌ Failed to log error event:', err);
  });

  if (sessionId) {
    appendMessage({
      sessionId,
      role: 'system',
      message: {
        text: `Ошибка: ${error.message}`,
        meta: {
          statusCode,
          path: req.path,
          method: req.method
        }
      },
      userAgent,
      userIp
    }).catch(err => {
      console.error('❌ Failed to append error message to session log:', err);
    });
  }

  return res.status(statusCode).json({
    error: userMessage,
    timestamp: new Date().toISOString(),
    requestId: sessionId?.slice(-8) || 'unknown'
  });
};
