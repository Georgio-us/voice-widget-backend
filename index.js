// index.js
import dotenv from 'dotenv';
dotenv.config(); // 👈 просто так — и всё заработает!

import express from 'express';
import cors from 'cors';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

import audioRouter from './routes/audioRoute.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

console.log('🔑 API KEY:', process.env.OPENAI_API_KEY); // проверка

app.use(cors());
app.use(express.json());
app.use('/api/audio', audioRouter);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`);
});