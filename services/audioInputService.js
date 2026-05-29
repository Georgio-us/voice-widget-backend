import { File } from 'node:buffer';
import { callOpenAIWithRetry } from './openAiRetryService.js';

export const resolveAudioInput = async ({ req, openai }) => {
  let transcription = '';
  let transcriptionTime = 0;

  if (req.file) {
    const audioFile = new File([req.file.buffer], req.file.originalname, {
      type: req.file.mimetype
    });

    const transcriptionStart = Date.now();
    const whisperPayload = {
      file: audioFile,
      model: 'whisper-1',
      response_format: 'text'
    };
    const whisperResponse = await callOpenAIWithRetry(() =>
      openai.audio.transcriptions.create(whisperPayload), 2, 'Whisper'
    );

    transcriptionTime = Date.now() - transcriptionStart;
    transcription = typeof whisperResponse === 'string'
      ? whisperResponse
      : String(whisperResponse?.text || '');
  } else {
    transcription = req.body.text.trim();
  }

  return {
    transcription,
    transcriptionTime,
    inputTypeForLog: req.file ? 'audio' : 'text',
    inputType: req.file ? 'аудио' : 'текст'
  };
};
