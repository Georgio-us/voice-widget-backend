
import { File } from 'node:buffer';
globalThis.File = File;

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAI } from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const transcribeAndRespond = async (req, res) => {
  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const audioPath = path.join(__dirname, '..', req.file.path);

    // 🔊 Расшифровка аудио
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
    });

    // 💬 Обработка текста в ChatGPT
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Ты — вежливый голосовой помощник агентства недвижимости. Отвечай кратко и по делу.' },
        { role: 'user', content: transcription.text }
      ],
      model: 'gpt-4',
    });

    // 🧹 Удаляем временный файл
    fs.unlink(audioPath, () => {});

    // 📤 Возвращаем ответ
    res.json({ reply: completion.choices[0].message.content });

  } catch (error) {
    console.error('❌ Ошибка в контроллере:', error.message);
    res.status(500).json({ error: 'Произошла ошибка при обработке аудио.' });
  }
};