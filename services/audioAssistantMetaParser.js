export const extractAssistantAndMeta = (fullText) => {
  try {
    const marker = '---META---';
    const idx = fullText.indexOf(marker);
    if (idx === -1) {
      return { assistantText: fullText, meta: null, metaRaw: null, parseError: false };
    }
    const assistantText = fullText.slice(0, idx).trim();
    let jsonPart = fullText.slice(idx + marker.length).trim();
    jsonPart = jsonPart.replace(/```json\s*|\s*```/g, '').trim();
    if (jsonPart.length > 5000) jsonPart = jsonPart.slice(0, 5000);
    let parsed = null;
    let parseError = false;
    try {
      parsed = JSON.parse(jsonPart);
    } catch {
      parsed = null;
      parseError = true;
    }
    return { assistantText, meta: parsed, metaRaw: jsonPart, parseError };
  } catch {
    return { assistantText: fullText, meta: null, metaRaw: null, parseError: true };
  }
};
