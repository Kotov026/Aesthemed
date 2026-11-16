// LOTOS United — WhatsApp invite bot (Green API) + Telegram notifications to the manager.
//
// One function, several entry points (all require ?key=<settings.access_key>):
//   POST ?key=...&action=tick   — called by pg_cron; sends at most one invite per call
//   POST ?key=...&action=setup  — points the Green API instance webhook at this function
//   POST ?key=...&action=report — sends statistics to the manager (pg_cron, twice a day)
//   POST ?key=...&action=tg     — Telegram webhook: /stats, /pause, /resume from the manager
//   POST ?key=...               — Green API webhook (incoming WhatsApp messages)
//
// Credentials (Edge Function secrets or rows in public.settings with the same key):
//   GREEN_API_URL   e.g. https://7103.api.greenapi.com
//   GREEN_ID        idInstance
//   GREEN_TOKEN     apiTokenInstance
//   TG_BOT_TOKEN    token from @BotFather (manager must press Start in that bot)

import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// Credentials: Edge Function secrets, or the same names in the private `settings` table.
let GREEN_URL = "", GREEN_ID = "", GREEN_TOKEN = "", TG_TOKEN = "", OPENAI_KEY = "", OPENAI_MODEL = "";
async function loadConfig() {
  const { data } = await db.from("settings").select("key,value")
    .in("key", ["GREEN_API_URL", "GREEN_ID", "GREEN_TOKEN", "TG_BOT_TOKEN", "OPENAI_API_KEY", "OPENAI_MODEL"]);
  const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  const get = (k: string) => (Deno.env.get(k) || s[k] || "").trim();
  GREEN_URL = get("GREEN_API_URL").replace(/\/$/, "");
  GREEN_ID = get("GREEN_ID");
  GREEN_TOKEN = get("GREEN_TOKEN");
  TG_TOKEN = get("TG_BOT_TOKEN");
  OPENAI_KEY = get("OPENAI_API_KEY");
  OPENAI_MODEL = get("OPENAI_MODEL") || "gpt-4o-mini";
}

// ---------------------------------------------------------------- campaign dates

// Almaty seminar is on 25.11 — from 25.11 00:00 Almaty time it disappears from all texts.
const ALMATY_CLOSES = Date.parse("2026-11-24T19:00:00Z");
// The whole campaign stops on 29.11 at 19:00 Almaty time.
const CAMPAIGN_ENDS = Date.parse("2026-11-29T14:00:00Z");
const almatyOpen = () => Date.now() < ALMATY_CLOSES;

// ---------------------------------------------------------------- texts

const GREETINGS = ["Здравствуйте!", "Добрый день!", "Приветствуем!"];
const GREETINGS_KZ = ["Сәлеметсіз бе!", "Қайырлы күн!"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function inviteText(): string {
  return `${pick(GREETINGS)} 🌸
*LOTOS United* приглашает косметологов на практический семинар *«Современные препараты в арсенале косметолога»*
${almatyOpen() ? "📍 Алматы — 25 ноября · Шымкент — 30 ноября" : "📍 Шымкент — 30 ноября"}

*1* — Подробнее
*2* — Записаться

———

${pick(GREETINGS_KZ)} 🌸
*LOTOS United* косметологтарды *«Косметолог арсеналындағы заманауи препараттар»* практикалық семинарына шақырады
${almatyOpen() ? "📍 Алматы — 25 қараша · Шымкент — 30 қараша" : "📍 Шымкент — 30 қараша"}

*1* — Толығырақ
*2* — Жазылу

Не получать сообщения / Хабарлама алмау: *СТОП*`;
}

const POSTER_BASE = "https://raw.githubusercontent.com/Kotov026/Aesthemed/claude/laughing-fermat-8qvjuv/lotos/assets/";
const POSTERS = [
  { city: "almaty", file: "poster-almaty-v3.jpg", caption: "📍 Алматы — 25 ноября / 25 қараша" },
  { city: "shymkent", file: "poster-shymkent-v2.jpg", caption: "📍 Шымкент — 30 ноября / 30 қараша" },
];

const DETAILS_RU = `*ПРАКТИЧЕСКИЙ СЕМИНАР ДЛЯ КОСМЕТОЛОГОВ*

📍 Алматы — 25 ноября
📍 Шымкент — 30 ноября

Тема: *«Современные препараты в арсенале косметолога»*

Филлеры, PLLA, PDRN, экзосомы — особенности, преимущества, показания и гибридные протоколы применения.

В программе:
▫️ Теоретическая часть с подробным разбором новой продукции LOTOS United
▫️ Особенности и преимущества современных препаратов
▫️ Показания к применению и подбор оптимальных решений
▫️ Проверенные протоколы и техники работы
▫️ Гибридные протоколы и сочетание различных методик

Спикер: Рустанбекова Ирина Анатольевна

Расширьте свои профессиональные знания, познакомьтесь с новыми препаратами и актуальными подходами в косметологии!

Количество мест ограничено!

*2* — Записаться
*3* — Задать вопрос`;

const DETAILS_KZ = `*КОСМЕТОЛОГТАРҒА АРНАЛҒАН ПРАКТИКАЛЫҚ СЕМИНАР*

📍 Алматы — 25 қараша
📍 Шымкент — 30 қараша

Тақырып: *«Косметолог арсеналындағы заманауи препараттар»*

Филлерлер, PLLA, PDRN, экзосомалар — ерекшеліктері, артықшылықтары, көрсетілімдері және қолданудың гибридтік хаттамалары.

Бағдарламада:
▫️ LOTOS United жаңа өнімдерін толық талдаумен теориялық бөлім
▫️ Заманауи препараттардың ерекшеліктері мен артықшылықтары
▫️ Қолдану көрсетілімдері және оңтайлы шешімдерді таңдау
▫️ Тексерілген хаттамалар мен жұмыс техникалары
▫️ Гибридтік хаттамалар және түрлі әдістерді үйлестіру

Спикер: Рустанбекова Ирина Анатольевна

Кәсіби біліміңізді кеңейтіп, жаңа препараттармен және косметологиядағы өзекті тәсілдермен танысыңыз!

Орын саны шектеулі!

*2* — Жазылу
*3* — Сұрақ қою`;

const askCity = () => almatyOpen()
  ? `Отлично! Напишите, в каком городе будете участвовать: *Алматы* (25.11) или *Шымкент* (30.11)?

Тамаша! Қай қалада қатысасыз: *Алматы* (25.11) әлде *Шымкент* (30.11)?`
  : `Отлично! Семинар пройдёт в *Шымкенте* 30 ноября. Напишите, пожалуйста, ваш город.

Тамаша! Семинар 30 қарашада *Шымкентте* өтеді. Қалаңызды жазыңыз.`;

const OTHER_CITY = `Спасибо! Менеджер свяжется с вами и всё подробно расскажет.

Рақмет! Менеджер сізбен хабарласып, бәрін толық айтып береді.`;

const THANKS = `Спасибо, вы в списке участников ✅
Менеджер свяжется с вами в ближайшее время для подтверждения и оплаты.

Рақмет, сіз қатысушылар тізіміндесіз ✅
Менеджер растау және төлем үшін жақын арада сізбен хабарласады.`;

const ASK_QUESTION = `Напишите ваш вопрос — менеджер ответит вам здесь.
Сұрағыңызды жазыңыз — менеджер осы жерде жауап береді.`;

const BYE = `Хорошо, больше не будем вас беспокоить.
Жақсы, енді мазаламаймыз.`;

// ---------------------------------------------------------------- helpers

async function setting(key: string): Promise<string | null> {
  const { data } = await db.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

async function setSetting(key: string, value: string) {
  await db.from("settings").upsert({ key, value });
}

async function log(phone: string | null, direction: string, text: string) {
  await db.from("log").insert({ phone, direction, text: text.slice(0, 2000) });
}

async function green(method: string, body: unknown) {
  const res = await fetch(`${GREEN_URL}/waInstance${GREEN_ID}/${method}/${GREEN_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Green API ${method} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

async function sendWa(phone: string, message: string) {
  await green("sendMessage", { chatId: `${phone}@c.us`, message });
  await log(phone, "out", message);
}

// Manager chat id: taken from the latest /start sent to the Telegram bot, then remembered.
async function managerChat(): Promise<string | null> {
  const saved = await setting("tg_chat_id");
  if (saved) return saved;
  if (!TG_TOKEN) return null;
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/getUpdates`).then((r) => r.json());
  const updates = (r.result ?? []) as any[];
  const last = updates.reverse().find((u) => u.message?.chat?.id);
  if (!last) return null;
  const id = String(last.message.chat.id);
  await setSetting("tg_chat_id", id);
  return id;
}

async function notifyManager(text: string) {
  const chat = await managerChat();
  if (!chat) {
    await log(null, "error", "Telegram: manager chat unknown — press Start in the bot. Msg: " + text);
    return;
  }
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true }),
  });
  await log(null, res.ok ? "tg" : "error", text);
}

const card = (c: { phone: string; name?: string | null; city?: string | null }) =>
  `👤 ${c.name || "—"}\n📞 +${c.phone}\n🏙 ${c.city || "—"}\n💬 https://wa.me/${c.phone}`;

// Almaty is UTC+5 all year.
function almatyNow() {
  const d = new Date(Date.now() + 5 * 3600_000);
  return { hour: d.getUTCHours(), midnightUtc: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 5 * 3600_000) };
}

// ---------------------------------------------------------------- broadcast tick

async function tick() {
  if (Date.now() >= CAMPAIGN_ENDS) return "campaign finished";
  if ((await setting("paused")) === "true") return "paused";
  const { hour, midnightUtc } = almatyNow();
  const from = Number(await setting("send_from_hour") ?? 10);
  const to = Number(await setting("send_to_hour") ?? 19);
  if (hour < from || hour >= to) return "outside hours";

  const limit = Number(await setting("daily_limit") ?? 40);
  const { count } = await db.from("contacts").select("phone", { count: "exact", head: true })
    .gte("sent_at", midnightUtc.toISOString());
  if ((count ?? 0) >= limit) return `daily limit ${limit} reached`;

  // keep a minimum gap between invites (cron fires more often than we send)
  // spread the daily limit over the sending window
  const autoGap = ((to - from) * 60 / Math.max(1, limit)) * 0.85;
  const gap = Math.min(Number(await setting("min_gap_minutes") ?? 11), autoGap);
  const { data: last } = await db.from("contacts").select("sent_at").not("sent_at", "is", null)
    .order("sent_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.sent_at && Date.now() - new Date(last.sent_at).getTime() < gap * 60_000) return "waiting for gap";

  const { data: c } = await db.from("contacts").select("*").eq("status", "new")
    .order("created_at").limit(1).maybeSingle();
  if (!c) return "no contacts left";

  // random pause 0–60 s so messages do not go out on an exact schedule
  // (must stay well under the edge function wall-clock limit)
  await new Promise((r) => setTimeout(r, Math.floor(Math.random() * 60_000)));

  try {
    // checkWhatsapp is not available on every Green API plan — if it fails, just try to send
    const chk = await green("checkWhatsapp", { phoneNumber: Number(c.phone) }).catch(() => ({}));
    if (chk.existsWhatsapp === false) {
      await db.from("contacts").update({ status: "failed", last_text: "no WhatsApp" }).eq("phone", c.phone);
      return `no WhatsApp: ${c.phone}`;
    }
    await sendWa(c.phone, inviteText());
    await db.from("contacts").update({ status: "sent", sent_at: new Date().toISOString() }).eq("phone", c.phone);
    await setSetting("fail_streak", "0");
    return `sent to ${c.phone}`;
  } catch (e) {
    await db.from("contacts").update({ status: "failed", last_text: String(e).slice(0, 300) }).eq("phone", c.phone);
    await log(c.phone, "error", String(e));
    const streak = Number(await setting("fail_streak") ?? 0) + 1;
    await setSetting("fail_streak", String(streak));
    if (streak >= 3) {
      await setSetting("paused", "true");
      const st = await waState();
      await notifyManager(`🚨 Рассылка LOTOS остановлена: ${streak} ошибки отправки подряд.\nWhatsApp: ${st}\nПоследняя ошибка: ${String(e).slice(0, 200)}\n\nПроверьте телефон с номером бота и Green API, затем отправьте /resume`);
    }
    return `error ${c.phone}`;
  }
}

// ---------------------------------------------------------------- AI conversation (OpenAI)
//
// settings.ai_mode: "off" (default) | "test" (only phones in settings.ai_test_phones) | "on" (everyone)
// The model only classifies the message and writes a short reply; all actions (posters,
// lead, hand-off to the manager) are done by this code. If OpenAI fails, the old
// number-based logic is used.

async function aiEnabledFor(phone: string): Promise<boolean> {
  if (!OPENAI_KEY) return false;
  const mode = (await setting("ai_mode")) ?? "off";
  if (mode === "on") return true;
  if (mode === "test") return ((await setting("ai_test_phones")) ?? "").split(/[\s,]+/).includes(phone);
  return false;
}

function aiSystemPrompt(): string {
  const cities = almatyOpen() ? "Алматы — 25 ноября; Шымкент — 30 ноября" : "Шымкент — 30 ноября (семинар в Алматы уже прошёл)";
  return `Ты — вежливый помощник LOTOS United в WhatsApp. Ты записываешь косметологов на семинар.
Отвечай коротко (1–3 предложения), тепло и по-человечески, на языке клиента (русский или казахский).
Используй ТОЛЬКО факты ниже. Ничего не придумывай. Если ответа нет в фактах — передай менеджеру.

ФАКТЫ О СЕМИНАРЕ:
- Практический семинар для косметологов «Современные препараты в арсенале косметолога».
- Филлеры, PLLA, PDRN, экзосомы — особенности, преимущества, показания и гибридные протоколы применения.
- Программа: теоретическая часть с разбором новой продукции LOTOS United; особенности и преимущества современных препаратов; показания и подбор оптимальных решений; проверенные протоколы и техники работы; гибридные протоколы и сочетание методик.
- Спикер: Рустанбекова Ирина Анатольевна — врач-дерматокосметолог, магистр медицины, руководитель клиники FaceTime (Астана), сертифицированный тренер LOTOS.
- Города и даты: ${cities}.
- Стоимость: 20 000 ₸. Количество мест ограничено.
- Оплату, точное место и время, сертификаты, требования к образованию, скидки, рассрочку и всё остальное — уточняет менеджер.

ЧТО НУЖНО ВЕРНУТЬ — строго JSON:
{"intent": "...", "city": "...", "reply": "..."}
intent:
- "details" — человек хочет узнать подробнее / программу / афишу (reply пустой, бот сам пришлёт описание);
- "signup" — хочет записаться/участвовать. Если город уже понятен из переписки, укажи его в "city" ("Алматы", "Шымкент" или другой город как написал клиент). Если город неизвестен — city пустой, а в reply вежливо спроси город;
- "answer" — простой вопрос, на который есть ответ в фактах: ответь в reply и в конце предложи записаться;
- "handoff" — вопрос про образование, сертификат, оплату, место/время, скидки, индивидуальная ситуация, жалоба, непонятное сообщение или ответа нет в фактах. В reply напиши, что менеджер скоро ответит лично;
- "stop" — человек просит больше не писать / не интересно.
Если клиент сообщает только город после вопроса о городе — это "signup" с этим городом.`;
}

async function aiDecide(phone: string, text: string, status: string): Promise<{ intent: string; city?: string; reply?: string } | null> {
  const { data: hist } = await db.from("log").select("direction,text").eq("phone", phone)
    .in("direction", ["in", "out"]).order("id", { ascending: false }).limit(12);
  const history = (hist ?? []).reverse().slice(0, -1) // last "in" is the current message
    .map((h) => ({ role: h.direction === "in" ? "user" : "assistant", content: String(h.text).slice(0, 1200) }));
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: aiSystemPrompt() },
        ...history,
        { role: "user", content: `[состояние: ${status === "asked_city" ? "бот спросил город" : "обычный диалог"}]\n${text}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const out = JSON.parse(j.choices?.[0]?.message?.content ?? "{}");
  return out?.intent ? out : null;
}

async function sendDetails(phone: string) {
  for (const p of POSTERS.filter((x) => x.city !== "almaty" || almatyOpen())) {
    await green("sendFileByUrl", { chatId: `${phone}@c.us`, urlFile: POSTER_BASE + p.file, fileName: p.file, caption: p.caption })
      .catch((e) => log(phone, "error", "poster: " + String(e)));
  }
  const dropAlmaty = (t: string) => almatyOpen() ? t : t.replace(/📍 Алматы — 25 (ноября|қараша)\n/, "");
  await sendWa(phone, dropAlmaty(DETAILS_RU));
  await sendWa(phone, dropAlmaty(DETAILS_KZ));
}

function normCity(city: string): string | null {
  const c = norm(city);
  if (almatyOpen() && /алмат|almaty/.test(c)) return "Алматы";
  if (/шымк|чимк|shymk/.test(c)) return "Шымкент";
  return null;
}

// returns true if the AI handled the message
async function aiHandle(c: any, phone: string, raw: string, upd: Record<string, unknown>, who: any): Promise<boolean> {
  let d;
  try {
    d = await aiDecide(phone, raw, c.status);
  } catch (e) {
    await log(phone, "error", "ai: " + String(e));
    return false;
  }
  if (!d) return false;
  await log(phone, "ai", JSON.stringify(d).slice(0, 500));

  switch (d.intent) {
    case "details":
      await db.from("contacts").update(upd).eq("phone", phone);
      await sendDetails(phone);
      return true;

    case "stop":
      await db.from("contacts").update({ ...upd, status: "stop" }).eq("phone", phone);
      await sendWa(phone, BYE);
      return true;

    case "signup": {
      const cityRaw = (d.city ?? "").trim();
      if (!cityRaw) {
        await db.from("contacts").update({ ...upd, status: "asked_city" }).eq("phone", phone);
        await sendWa(phone, d.reply || askCity());
        return true;
      }
      const city = normCity(cityRaw);
      if (!city) {
        await db.from("contacts").update({ ...upd, status: "question", city: cityRaw.slice(0, 60) }).eq("phone", phone);
        await sendWa(phone, OTHER_CITY);
        await notifyManager(`📍 Другой город — нужен звонок менеджера\n${card({ ...who, city: cityRaw })}\n\nКлиент хочет записаться: «${raw}». Свяжитесь с ним.`);
        return true;
      }
      await db.from("contacts").update({ ...upd, status: "lead", city }).eq("phone", phone);
      await sendWa(phone, THANKS);
      await notifyManager(`🆕 ЗАЯВКА — семинар LOTOS (${city === "Алматы" ? "25.11" : "30.11"})\n${card({ ...who, city })}\n\nСвяжитесь для подтверждения и оплаты 20 000 ₸.`);
      return true;
    }

    case "answer":
      await db.from("contacts").update(upd).eq("phone", phone);
      if (d.reply) await sendWa(phone, d.reply);
      return true;

    default: // handoff
      await db.from("contacts").update({ ...upd, status: "question" }).eq("phone", phone);
      await sendWa(phone, d.reply || "Спасибо за вопрос! Менеджер скоро ответит вам лично.\nРақмет! Менеджер жақын арада өзі жауап береді.");
      await notifyManager(`❓ Вопрос — нужен менеджер (LOTOS)\n${card(who)}\n\n«${raw}»\n\nОтветьте клиенту в WhatsApp.`);
      return true;
  }
}

async function transcribe(url: string): Promise<string> {
  const audio = await fetch(url);
  if (!audio.ok) throw new Error(`download ${audio.status}`);
  const form = new FormData();
  form.append("file", new Blob([await audio.arrayBuffer()], { type: "audio/ogg" }), "voice.ogg");
  form.append("model", "whisper-1");
  form.append("prompt", "Семинар LOTOS для косметологов. Алматы, Шымкент. Филлеры, PLLA, PDRN, экзосомы.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return String((await res.json()).text ?? "").trim();
}

// ---------------------------------------------------------------- incoming messages

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").trim();
const isStop = (t: string) => /^(стоп|stop|тоқтат|токтат|отпис|не пиши|не нужно|жазба)/.test(t);
const isDetails = (t: string) => /^1(\D|$)|подроб|толы[ғг]|инфо/.test(t);
const isYes = (t: string) => /^2(\D|$)|запиш|хочу|^(да|иә|ия)(\s|[!.,)]|$)|жазыл/.test(t);
const isQuestion = (t: string) => /^3(\D|$)|вопрос|сұрақ|сурак/.test(t);

async function incoming(body: any) {
  if (body.typeWebhook !== "incomingMessageReceived") return;
  const chatId: string = body.senderData?.chatId ?? "";
  if (!chatId.endsWith("@c.us")) return; // ignore groups
  const phone = chatId.replace("@c.us", "");
  const name: string | null = body.senderData?.senderName || body.senderData?.chatName || null;
  const md = body.messageData ?? {};
  let raw: string = md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ??
    md.fileMessageData?.caption || `[${md.typeMessage ?? "сообщение"}]`;
  // voice message -> text (OpenAI speech-to-text), then handled like a normal message
  if (md.typeMessage === "audioMessage" && md.fileMessageData?.downloadUrl && OPENAI_KEY) {
    const text = await transcribe(md.fileMessageData.downloadUrl).catch(async (e) => {
      await log(phone, "error", "voice: " + String(e));
      return "";
    });
    if (text) raw = "🎤 " + text;
  }
  const t = norm(raw.replace(/^🎤 /, ""));
  await log(phone, "in", raw);

  let { data: c } = await db.from("contacts").select("*").eq("phone", phone).maybeSingle();
  if (!c) {
    // someone who is not in the list wrote first — treat as if they got the invite
    await db.from("contacts").insert({ phone, name, status: "sent", sent_at: null });
    c = { phone, name, status: "sent", city: null };
  }
  const upd: Record<string, unknown> = { replied_at: new Date().toISOString(), last_text: raw.slice(0, 500) };
  if (name && !c.name) upd.name = name;
  const who = { ...c, name: c.name || name };

  if (isStop(t) && c.status !== "lead") {
    await db.from("contacts").update({ ...upd, status: "stop" }).eq("phone", phone);
    await sendWa(phone, BYE);
    return;
  }

  // stickers, photos, unrecognised voice etc. — nothing for the AI to read
  if (/^\[\w+\]$/.test(raw)) {
    await db.from("contacts").update(upd).eq("phone", phone);
    await notifyManager(`📎 Клиент LOTOS прислал не текст (${raw})\n${card(who)}\n\nПосмотрите в WhatsApp.`);
    return;
  }

  if (["new", "sent", "failed", "asked_city"].includes(c.status) && await aiEnabledFor(phone)) {
    if (await aiHandle(c, phone, raw, upd, who)) return;
  }

  switch (c.status) {
    case "new":
    case "sent":
    case "failed":
      if (isDetails(t)) {
        await db.from("contacts").update(upd).eq("phone", phone);
        for (const p of POSTERS.filter((x) => x.city !== "almaty" || almatyOpen())) {
          await green("sendFileByUrl", { chatId: `${phone}@c.us`, urlFile: POSTER_BASE + p.file, fileName: p.file, caption: p.caption })
            .catch((e) => log(phone, "error", "poster: " + String(e)));
        }
        const dropAlmaty = (t: string) => almatyOpen() ? t : t.replace(/📍 Алматы — 25 (ноября|қараша)\n/, "");
        await sendWa(phone, dropAlmaty(DETAILS_RU));
        await sendWa(phone, dropAlmaty(DETAILS_KZ));
      } else if (isYes(t)) {
        await db.from("contacts").update({ ...upd, status: "asked_city" }).eq("phone", phone);
        await sendWa(phone, askCity());
      } else if (isQuestion(t)) {
        await db.from("contacts").update({ ...upd, status: "question" }).eq("phone", phone);
        await sendWa(phone, ASK_QUESTION);
        await notifyManager(`❓ Вопрос по семинару LOTOS\n${card(who)}\n\nЖдём текст вопроса — он придёт следующим сообщением.`);
      } else if (!c.sent_at && c.status !== "failed") {
        // wrote first and not with 1/2/3 — send the invite so they see the options
        await db.from("contacts").update({ ...upd, sent_at: new Date().toISOString() }).eq("phone", phone);
        await sendWa(phone, inviteText());
      } else {
        await db.from("contacts").update({ ...upd, status: "question" }).eq("phone", phone);
        await notifyManager(`💬 Ответ на рассылку LOTOS\n${card(who)}\n\n«${raw}»\n\nОтветьте клиенту в WhatsApp.`);
      }
      return;

    case "asked_city": {
      let city: string | null = null;
      if (almatyOpen() && /^1(\D|$)|алмат/.test(t)) city = "Алматы";
      else if (/^2(\D|$)|шымк|чимк/.test(t) || (!almatyOpen() && /^1(\D|$)/.test(t))) city = "Шымкент";
      if (!city) {
        // another city (or Almaty after the 24th): hand over to the manager
        await db.from("contacts").update({ ...upd, status: "question", city: raw.slice(0, 60) }).eq("phone", phone);
        await sendWa(phone, OTHER_CITY);
        await notifyManager(`📍 Другой город — нужен звонок менеджера\n${card({ ...who, city: raw.slice(0, 60) })}\n\nКлиент хочет записаться, но указал: «${raw}». Свяжитесь с ним.`);
        return;
      }
      await db.from("contacts").update({ ...upd, status: "lead", city }).eq("phone", phone);
      await sendWa(phone, THANKS);
      const date = city === "Алматы" ? " (25.11)" : " (30.11)";
      await notifyManager(`🆕 ЗАЯВКА — семинар LOTOS${date}\n${card({ ...who, city })}\n\nСвяжитесь для подтверждения и оплаты 20 000 ₸.`);
      return;
    }

    default: // lead, question, stop — a human is handling the chat; just forward
      await db.from("contacts").update(upd).eq("phone", phone);
      await notifyManager(`💬 Сообщение от клиента LOTOS\n${card(who)}\n\n«${raw}»`);
  }
}

// ---------------------------------------------------------------- monitoring

const STATE_RU: Record<string, string> = {
  authorized: "✅ подключён",
  notAuthorized: "❌ НЕ подключён — отсканируйте QR в Green API",
  blocked: "⛔ номер ЗАБЛОКИРОВАН WhatsApp",
  sleepMode: "⚠️ телефон не в сети",
  starting: "⏳ запускается",
  yellowCard: "⚠️ предупреждение WhatsApp (жёлтая карточка) — снизьте лимит",
};

async function waState(): Promise<string> {
  try {
    const r = await fetch(`${GREEN_URL}/waInstance${GREEN_ID}/getStateInstance/${GREEN_TOKEN}`).then((r) => r.json());
    return STATE_RU[r.stateInstance] ?? String(r.stateInstance);
  } catch (e) {
    return "❌ Green API не отвечает: " + String(e).slice(0, 100);
  }
}

async function statsText(title: string): Promise<string> {
  const { midnightUtc } = almatyNow();
  const since = midnightUtc.toISOString();
  const cnt = async (q: any) => (await q).count ?? 0;
  const head = () => db.from("contacts").select("phone", { count: "exact", head: true });
  const sentToday = await cnt(head().gte("sent_at", since));
  const repliedToday = await cnt(head().gte("replied_at", since));
  const leadsToday = await cnt(head().eq("status", "lead").gte("replied_at", since));
  const queue = await cnt(head().eq("status", "new"));
  const sentAll = await cnt(head().not("sent_at", "is", null));
  const leadsAll = await cnt(head().eq("status", "lead"));
  const stops = await cnt(head().eq("status", "stop"));
  const failed = await cnt(head().eq("status", "failed"));
  const errorsToday = (await db.from("log").select("id", { count: "exact", head: true })
    .eq("direction", "error").gte("at", since)).count ?? 0;
  const { data: leads } = await db.from("contacts").select("city").eq("status", "lead");
  const byCity: Record<string, number> = {};
  for (const l of leads ?? []) byCity[l.city || "—"] = (byCity[l.city || "—"] ?? 0) + 1;
  const cities = Object.entries(byCity).map(([c, n]) => `${c}: ${n}`).join(", ") || "—";
  const paused = (await setting("paused")) === "true";
  const limit = await setting("daily_limit") ?? "40";
  const days = Math.ceil(queue / Math.max(1, Number(limit)));
  return `${title}

Сегодня:
📤 Отправлено: ${sentToday} из ${limit}
💬 Ответили: ${repliedToday}
🆕 Записались: ${leadsToday}

Всего:
📤 Отправлено: ${sentAll}
🆕 Заявок: ${leadsAll} (${cities})
🚫 Отписались: ${stops}
⚠️ Не доставлено: ${failed}
📋 В очереди: ${queue} (~${days} дн.)

WhatsApp: ${await waState()}
Рассылка: ${paused ? "⏸ НА ПАУЗЕ (/resume — продолжить)" : "▶️ идёт"}
Ошибок сегодня: ${errorsToday}`;
}

// Telegram commands from the manager chat
async function telegram(update: any) {
  const msg = update.message;
  if (!msg?.text) return;
  const chat = String(msg.chat.id);
  const manager = await managerChat();
  const cmd = msg.text.trim().split(/[\s@]/)[0].toLowerCase();
  if (!manager && cmd === "/start") {
    await setSetting("tg_chat_id", chat); // first /start becomes the manager
  } else if (manager !== chat) {
    return; // ignore strangers
  }
  if (cmd === "/stats" || cmd === "/start") await notifyManager(await statsText("📊 Статистика LOTOS"));
  else if (cmd === "/pause") {
    await setSetting("paused", "true");
    await notifyManager("⏸ Рассылка на паузе. /resume — продолжить.");
  } else if (cmd === "/resume") {
    await setSetting("paused", "false");
    await setSetting("fail_streak", "0");
    await notifyManager(`▶️ Рассылка продолжается.\nWhatsApp: ${await waState()}`);
  } else await notifyManager("Команды:\n/stats — статистика\n/pause — остановить рассылку\n/resume — продолжить");
}

// ---------------------------------------------------------------- setup

async function setup(selfUrl: string) {
  const r = await green("setSettings", {
    webhookUrl: selfUrl,
    incomingWebhook: "yes",
    outgoingWebhook: "no",
    outgoingMessageWebhook: "no",
    outgoingAPIMessageWebhook: "no",
    stateWebhook: "no",
    incomingCallWebhook: "no",
    delaySendMessagesMilliseconds: 15000,
  });
  const chat = await managerChat();
  if (TG_TOKEN) {
    const tgUrl = selfUrl + "&action=tg";
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tgUrl, allowed_updates: ["message"] }),
    });
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/setMyCommands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands: [
        { command: "stats", description: "Статистика рассылки" },
        { command: "pause", description: "Остановить рассылку" },
        { command: "resume", description: "Продолжить рассылку" },
      ] }),
    });
  }
  if (chat) await notifyManager("✅ Бот LOTOS подключён. Сюда будут приходить заявки.\n\nКоманды: /stats, /pause, /resume");
  return { green: r, telegram_manager_chat: chat ? "found" : "not found — press Start in the Telegram bot and run setup again" };
}

// ---------------------------------------------------------------- server

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const key = await setting("access_key");
  if (!key || url.searchParams.get("key") !== key) return new Response("forbidden", { status: 403 });

  const action = url.searchParams.get("action");
  try {
    await loadConfig();
    if (action === "tick") {
      // answer pg_net right away, do the work in the background
      // @ts-ignore EdgeRuntime is provided by Supabase
      EdgeRuntime.waitUntil(tick().then((r) => log(null, "tick", r)).catch((e) => log(null, "error", String(e))));
      return new Response("ok");
    }
    if (action === "report") {
      const st = await waState();
      await notifyManager(await statsText(url.searchParams.get("title") ?? "📊 Отчёт LOTOS"));
      return new Response(st);
    }
    if (action === "tg") {
      const upd = await req.json().catch(() => ({}));
      // @ts-ignore
      EdgeRuntime.waitUntil(telegram(upd).catch((e) => log(null, "error", "tg: " + String(e))));
      return new Response("ok");
    }
    if (action === "setup") {
      const self = `${Deno.env.get("SUPABASE_URL")}/functions/v1/lotos?key=${key}`;
      return Response.json(await setup(self));
    }
    const body = await req.json().catch(() => ({}));
    // @ts-ignore
    EdgeRuntime.waitUntil(incoming(body).catch((e) => log(null, "error", String(e))));
    return new Response("ok");
  } catch (e) {
    await log(null, "error", String(e));
    return new Response(String(e), { status: 500 });
  }
});
