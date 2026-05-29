import { detectVerbalSelectIntent } from './chatIntentPolicy.js';

export const applyVerbalSelectUiDecision = ({
  transcription = '',
  session = null,
  botResponse = '',
  ui = undefined
} = {}) => {
  try {
    if (detectVerbalSelectIntent(transcription) !== true) {
      return { botResponse, ui, applied: false, cardId: null };
    }

    const chosenCardId =
      (session?.lastShown && session.lastShown.cardId) ? String(session.lastShown.cardId) :
      (session?.currentFocusCard && session.currentFocusCard.cardId) ? String(session.currentFocusCard.cardId) :
      null;

    if (!chosenCardId) {
      return { botResponse, ui, applied: false, cardId: null };
    }

    return {
      botResponse: 'Отлично, зафиксировал выбор.',
      ui: { ...(ui || {}), autoSelectCardId: chosenCardId },
      applied: true,
      cardId: chosenCardId
    };
  } catch {
    return { botResponse, ui, applied: false, cardId: null };
  }
};
