// services/db.js
import pkg from 'pg';

const { Pool } = pkg;

// Берём строку подключения к БД из переменной окружения DATABASE_URL,
// которую ты настроил в Railway для voice-widget-backend
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('⚠️ DATABASE_URL не задана. Проверь переменные окружения в Railway.');
}

// Создаём пул подключений к Postgres.
// Его будем переиспользовать во всех местах, где нужна база.
export const pool = new Pool({
  connectionString,
  max: 5,               // максимум одновременных соединений
  idleTimeoutMillis: 30000, // сколько держать простое соединение
});

// Простая проверка, что соединение с БД работает.
// Вызовем её позже при старте сервера.
export async function testDbConnection() {
  try {
    const res = await pool.query('SELECT NOW() as now');
    console.log('✅ Connected to Postgres, time:', res.rows[0].now);
  } catch (err) {
    console.error('❌ Postgres connection error:', err.message);
  }
}