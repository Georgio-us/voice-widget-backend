import { OpenAI } from 'openai';

const openai = new OpenAI();

/**
 * Локализует название ЖК на RU и UA.
 * Если перевести нельзя (имя собственное / бренд), оставляет как есть.
 * Убирает мусор вроде "ЖК", "ЗК".
 * @param {string} rawName 
 * @returns {Promise<{ru: string, ua: string} | null>}
 */
export async function translateResidentialComplex(rawName) {
  const name = String(rawName || '').trim();
  if (!name || name.length < 2) return null;

  const prompt = `Ты — эксперт по недвижимости в Украине. Твоя задача локализовать названия жилых комплексов (ЖК) на два языка: русский и украинский.
Обязательно учитывай брендирование: некоторые слова переводятся (например, "Жемчужина" -> "Перлина", "Радужный" -> "Райдужний"), а некоторые являются именами собственными и просто транслитерируются или остаются без перевода (например, "Акварель", "Kadorr", "Greenwood").
Убери префиксы типа "ЖК" или "ЗК", верни только само название.

Входное название: "${name}"

Верни строго валидный JSON в формате:
{
  "ru": "русское название",
  "ua": "украинское название"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: "json_object" }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    
    // Fallback if AI fails to return both keys
    const ru = String(parsed?.ru || name).trim();
    const ua = String(parsed?.ua || name).trim();

    return { ru, ua };
  } catch (error) {
    console.error(`[localizationService] Error translating "${name}":`, error.message);
    return null; // Silent failure -> fallback to default string matching
  }
}
