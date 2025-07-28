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
    // ✅ НОВОЕ - Валидация файла
    if (!req.file) {
      return res.status(400).json({ error: 'Аудио файл не найден' });
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const audioPath = path.join(__dirname, '..', req.file.path);

    // 🔊 Расшифровка аудио
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-1',
    });

    // ✅ НОВОЕ - Создаем краткое резюме из транскрипции
    const summaryPrompt = `Пользователь сказал: "${transcription.text}"

Создай краткое резюме (1-2 предложения) того, о чем спросил пользователь. Резюме должно быть понятным и информативным.`;

    const summaryCompletion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Ты создаешь краткие резюме голосовых сообщений. Отвечай только резюме, без лишних слов.' },
        { role: 'user', content: summaryPrompt }
      ],
      model: 'gpt-4',
      max_tokens: 100, // ✅ НОВОЕ - Ограничиваем длину резюме
    });

    // 💬 Обработка текста в ChatGPT (основной ответ)
    const completion = await openai.chat.completions.create({
      messages: [
        { role: 'system', content: 'Ты — вежливый голосовой помощник агентства недвижимости. Отвечай кратко и по делу.' },
        { role: 'user', content: transcription.text }
      ],
      model: 'gpt-4',
    });

    // 🧹 Удаляем временный файл
    fs.unlink(audioPath, (err) => {
      if (err) console.error('Ошибка удаления файла:', err);
    });

    // ✅ НОВОЕ - Возвращаем расширенный ответ с транскрипцией и резюме
    res.json({ 
      response: completion.choices[0].message.content,
      transcription: transcription.text, // ✅ НОВОЕ - Полная транскрипция
      summary: summaryCompletion.choices[0].message.content.trim() // ✅ НОВОЕ - Краткое резюме
    });

  } catch (error) {
    console.error('❌ Ошибка в контроллере:', error.message);
    
    // ✅ НОВОЕ - Более подробная обработка ошибок
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'Аудио файл не найден на сервере' });
    } else if (error.response?.status === 401) {
      res.status(500).json({ error: 'Ошибка авторизации OpenAI API' });
    } else {
      res.status(500).json({ error: 'Произошла ошибка при обработке аудио' });
    }
  }
};