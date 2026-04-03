/**
 * Анализ реальных OLX attribute codes из последних записей properties.raw.
 *
 * Запуск (из корня backend):
 *   DATABASE_URL="postgres://..." node scripts/analyzeOlxRawAttributes.js
 * Или:
 *   npm run analyze:olx-attributes
 *
 * Результат:
 *   - stdout: полный отчёт
 *   - файл OLX_ATTRIBUTE_CODES_SNAPSHOT.md (в корне backend) — для вставки в DOCS_DATA_MAPPING.md
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LIMIT = 20;

function parseRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object') return raw;
  return null;
}

function getAdvert(root) {
  if (!root || typeof root !== 'object') return null;
  if (root.advert && typeof root.advert === 'object') return root.advert;
  return root;
}

function getAttributes(advert) {
  const list = advert?.attributes;
  return Array.isArray(list) ? list : [];
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function matches(code, patterns) {
  return patterns.some((p) => p.test(code));
}

/** Лучший код по частоте среди кандидатов */
function bestByCount(candidates, codeStats) {
  let best = null;
  let bestN = -1;
  for (const c of candidates) {
    const n = codeStats.get(c)?.count ?? 0;
    if (n > bestN) {
      bestN = n;
      best = c;
    }
  }
  return bestN > 0 ? { code: best, count: bestN } : null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Нет DATABASE_URL. Пример: DATABASE_URL="postgresql://..." npm run analyze:olx-attributes');
    process.exit(1);
  }

  const pool = new Pool({ connectionString, max: 2 });
  try {
    const { rows } = await pool.query(
      `
      SELECT external_id, raw, created_at
      FROM properties
      WHERE external_id ILIKE 'OLX_%'
      ORDER BY COALESCE(created_at, 'epoch'::timestamptz) DESC, id DESC
      LIMIT $1
      `,
      [LIMIT]
    );

    if (!rows.length) {
      console.log(JSON.stringify({ message: 'Нет строк с external_id ILIKE OLX_%', limit: LIMIT }));
      process.exit(0);
    }

    /** @type {Map<string, { count: number, samples: Set<string>, hasValue: boolean, hasValues: boolean }>} */
    const codeStats = new Map();

    for (const row of rows) {
      const root = parseRaw(row.raw);
      const advert = getAdvert(root);
      const attrs = getAttributes(advert);
      for (const a of attrs) {
        const code = norm(a?.code);
        if (!code) continue;
        if (!codeStats.has(code)) {
          codeStats.set(code, {
            count: 0,
            samples: new Set(),
            hasValue: false,
            hasValues: false
          });
        }
        const st = codeStats.get(code);
        st.count += 1;
        if (a.value != null && String(a.value).trim()) {
          st.hasValue = true;
          const v = String(a.value).trim();
          if (st.samples.size < 12) st.samples.add(v.length > 200 ? `${v.slice(0, 200)}…` : v);
        }
        if (Array.isArray(a.values) && a.values.length) {
          st.hasValues = true;
          for (const v of a.values) {
            const sv = String(v || '').trim();
            if (sv && st.samples.size < 24) st.samples.add(`values:${sv}`);
          }
        }
      }
    }

    const codes = [...codeStats.keys()].sort();
    const sorted = [...codeStats.entries()].sort((a, b) => b[1].count - a[1].count);

    const patterns = {
      rooms: [/^number_of_rooms$/, /^rooms$/, /bedroom/, /^room$/],
      total_area: [/^total_area$/, /^area$/, /^m2$/, /living.*area/, / загальн|общей|загальна|ploshch/i],
      kitchen_area: [/kitchen/, /kitchen_area/],
      floor: [/^floor$/],
      total_floors: [/total_floors/, /floors_total/, /building_floors/, /number_of_floors/, /storeys/, /поверховіст/],
      heating: [/^heating$/, /heat/, /опален/, /opplen/],
      repair: [/^repair$/, /renovat/, /стан ремо|ремонт/, /стан квартир/],
      wall_type: [/wall/, /стін/, /стен/, /wall_type/],
      comfort: [/^comfort$/, /udobstva/, /amenities/, /зручност/, /комфорт/]
    };

    const candidates = {};
    for (const [key, pats] of Object.entries(patterns)) {
      candidates[key] = codes.filter((c) => matches(c, pats));
    }

    const mapping = {};
    for (const key of Object.keys(patterns)) {
      const b = bestByCount(candidates[key], codeStats);
      mapping[key] = b;
    }

    // comfort: показать все значения, связанные с типичными кодами comfort
    const comfortCodes = candidates.comfort.length
      ? candidates.comfort
      : sorted
          .filter(([code, st]) =>
            [...st.samples].some((s) =>
              /balcon|lodg|terr|parking|garage|лодж|балкон|терас|паркін|парковк|gar/i.test(s)
            )
          )
          .map(([c]) => c);

    const comfortSamples = {};
    for (const cc of comfortCodes.slice(0, 5)) {
      const st = codeStats.get(cc);
      if (st) comfortSamples[cc] = [...st.samples];
    }

    const out = [];
    out.push('# Снимок кодов OLX `attributes` (автогенерация)');
    out.push('');
    out.push(`Сгенерировано: ${new Date().toISOString()}`);
    out.push(`Строк в выборке: **${rows.length}** (последние по \`created_at\`, \`external_id\` ILIKE \`OLX_%\`)`);
    out.push('');
    out.push('## Частота всех `code`');
    out.push('');
    out.push('| code | вхождений (сумма по объявлениям) | пример value/values |');
    out.push('|------|-----------------------------------|----------------------|');
    for (const [code, st] of sorted) {
      const samp = [...st.samples].slice(0, 3).join(' · ').replace(/\|/g, '\\|');
      out.push(`| \`${code}\` | ${st.count} | ${samp || '—'} |`);
    }
    out.push('');
    out.push('## Предлагаемый маппинг (по эвристике + частоте в этой выборке)');
    out.push('');
    out.push('| Логика (манифест) | Предлагаемый `attributes[].code` | вхождений |');
    out.push('|--------------------|-----------------------------------|-----------|');
    const rowsMd = [
      ['Количество комнат', mapping.rooms],
      ['Общая площадь', mapping.total_area],
      ['Площадь кухни', mapping.kitchen_area],
      ['Этаж', mapping.floor],
      ['Этажность дома', mapping.total_floors],
      ['Отопление', mapping.heating],
      ['Ремонт', mapping.repair],
      ['Тип стен', mapping.wall_type]
    ];
    for (const [label, m] of rowsMd) {
      const cell = m ? `\`${m.code}\`` : '*(не найдено в выборке)*';
      const cnt = m ? String(m.count) : '—';
      out.push(`| ${label} | ${cell} | ${cnt} |`);
    }
    out.push('');
    out.push('### Comfort (балкон / паркинг и др.)');
    out.push('');
    out.push('Проверьте вручную столбец **пример** в таблице выше для кода `comfort` (или см. ниже).');
    out.push('');
    out.push('```json');
    out.push(JSON.stringify(comfortSamples, null, 2));
    out.push('```');
    out.push('');
    out.push('### Кандидаты по шаблону (если маппинг пустой)');
    out.push('');
    for (const [k, arr] of Object.entries(candidates)) {
      if (!mapping[k] && arr.length) {
        out.push(`- **${k}**: ${arr.map((c) => `\`${c}\``).join(', ')}`);
      }
    }

    const md = out.join('\n');
    const snapshotPath = path.join(ROOT, 'OLX_ATTRIBUTE_CODES_SNAPSHOT.md');
    fs.writeFileSync(snapshotPath, md, 'utf8');
    console.log(`Wrote ${snapshotPath}\n`);

    console.log(md);

    console.log('\n--- JSON (для отладки) ---\n');
    console.log(
      JSON.stringify(
        {
          external_ids: rows.map((r) => r.external_id),
          mapping,
          comfortSamples,
          allCodes: sorted.map(([c, st]) => ({ code: c, count: st.count }))
        },
        null,
        2
      )
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
