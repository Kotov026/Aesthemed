# LOTOS — WhatsApp-рассылка на семинар

Простой бот: рассылает приглашение на семинар LOTOS United по базе номеров
(40 в день, 10:00–19:00 по Алматы), принимает ответы и отправляет заявки
менеджеру в Telegram.

- Supabase-проект: `lotos` (`fxtyhmulnvkwwffzwmmf`)
- Функция: `supabase/functions/lotos/index.ts`
- WhatsApp: Green API, уведомления: Telegram-бот

## Как работает

1. Номера лежат в таблице `contacts` со статусом `new`.
2. pg_cron каждые 2 минуты вызывает функцию; она отправляет одно приглашение,
   если с прошлого прошло не меньше `min_gap_minutes` (11), — то есть ~раз в 12 минут
   (RU + KZ), пока за день не наберётся `daily_limit`.
3. Ответы клиентов:
   - `1` — бот спрашивает город (Алматы/Шымкент), затем заявка уходит в Telegram;
   - `2` — бот просит написать вопрос, менеджер получает уведомление;
   - `СТОП` — номер больше не получает сообщений;
   - любой другой текст пересылается менеджеру.
4. Менеджер отвечает клиенту вручную в WhatsApp с номера бота.

## Мониторинг (Telegram-бот заявок)

- Отчёты в 13:00 и 19:05 по Алматы (pg_cron `lotos-report-midday`, `lotos-report-evening`).
- Тревога и автопауза после 3 ошибок отправки подряд; статус WhatsApp в каждом отчёте.
- Команды менеджера: `/stats`, `/pause`, `/resume`.

## Секреты (Supabase → Edge Functions → Secrets или строки в таблице `settings`)

| Имя | Значение |
|---|---|
| `GREEN_API_URL` | apiUrl инстанса, например `https://7103.api.greenapi.com` |
| `GREEN_ID` | idInstance |
| `GREEN_TOKEN` | apiTokenInstance |
| `TG_BOT_TOKEN` | токен бота от @BotFather |

## Таблица `settings`

| key | что это |
|---|---|
| `paused` | `true` — рассылка остановлена |
| `daily_limit` | сообщений в день (по умолчанию 40) |
| `send_from_hour` / `send_to_hour` | окно отправки по Алматы |
| `tg_chat_id` | чат менеджера (определяется сам после /start в Telegram-боте) |
| `access_key` | ключ для вызова функции |

## Полезные запросы

```sql
-- статистика
select status, count(*) from contacts group by status;
-- заявки
select phone, name, city, replied_at from contacts where status = 'lead' order by replied_at;
-- остановить / запустить рассылку
update settings set value = 'true'  where key = 'paused';
update settings set value = 'false' where key = 'paused';
```
