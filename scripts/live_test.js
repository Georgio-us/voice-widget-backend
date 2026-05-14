import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const API_URL = 'https://voice-widget-backend-tgdubai-split.up.railway.app/api/audio/upload';

async function sendChat(sessionId, text) {
  return new Promise((resolve, reject) => {
    const boundary = '----WebKitFormBoundary' + crypto.randomBytes(16).toString('hex');
    let postData = '';
    
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="sessionId"\r\n\r\n${sessionId}\r\n`;
    
    postData += `--${boundary}\r\n`;
    postData += `Content-Disposition: form-data; name="text"\r\n\r\n${text}\r\n`;
    
    postData += `--${boundary}--\r\n`;

    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          console.error("Failed to parse JSON:", data);
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function run() {
  const sessionId = `user_${Date.now()}_test`;
  
  const scenarios = [
    "Хочу 2-комнатную квартиру в Аркадии.",
    "Слушай, а давай еще 3-комнатные посмотрим.",
    "Не, 2 и 3 отменяются, хочу только 4 комнаты.",
    "Добавь балкон и цену до 100 тысяч."
  ];

  console.log(`🚀 Начинаем тестирование live-сервера... Session: ${sessionId}\n`);

  for (let i = 0; i < scenarios.length; i++) {
    const text = scenarios[i];
    console.log(`\n==================================================`);
    console.log(`🗣️ Шаг ${i + 1}. ПОЛЬЗОВАТЕЛЬ: "${text}"`);
    console.log(`⏳ Ждем ответа сервера...`);
    
    const start = Date.now();
    const res = await sendChat(sessionId, text);
    const duration = Date.now() - start;

    console.log(`✅ Ответ за ${duration} мс`);
    console.log(`🤖 БОТ: ${res.assistant_text}`);
    console.log(`🧠 INSIGHTS:`);
    console.log(JSON.stringify(res.insights, null, 2));
  }
}

run().catch(console.error);
