import { buildManagerSystemEvent, getManagerCtaReason } from './managerCtaPolicy.js';
import { getUiHighlightTarget } from './chatIntentPolicy.js';

export const buildAssistantUiDecision = ({
  transcription = '',
  targetLang = 'uk',
  extractionReport = {}
} = {}) => {
  let ui = undefined;
  const managerCtaReason = getManagerCtaReason(transcription, {
    updatesApplied: extractionReport.updatesApplied === true
  });
  if (managerCtaReason) {
    ui = {
      ...(ui || {}),
      systemEvent: buildManagerSystemEvent(targetLang, managerCtaReason)
    };
  }

  const uiHighlightTarget = getUiHighlightTarget(transcription);
  if (uiHighlightTarget) {
    ui = {
      ...(ui || {}),
      highlight: uiHighlightTarget,
      highlightTarget: uiHighlightTarget
    };
  }

  return { ui };
};
