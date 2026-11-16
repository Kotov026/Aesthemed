// LOTOS United — WhatsApp invite bot (Green API) + Telegram notifications to the manager.
//
// One function, three entry points (all require ?key=<settings.access_key>):
//   POST ?key=...&action=tick   — called by pg_cron; sends at most one invite per call
//   POST ?key=...&action=setup  — points the Green API instance webhook at this function
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
let GREEN_URL = "", GREEN_ID = "", GREEN_TOKEN = "", TG_TOKEN = "";
async function loadConfig() {
  const { data } = await db.from("settings").select("key,value")
    .in("key", ["GREEN_API_URL", "GREEN_ID", "GREEN_TOKEN", "TG_BOT_TOKEN"]);
  const s = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  const get = (k: string) => (Deno.env.get(k) || s[k] || "").trim();
  GREEN_URL = get("GREEN_API_URL").replace(/\/$/, "");
  GREEN_ID = get("GREEN_ID");
  GREEN_TOKEN = get("GREEN_TOKEN");
  TG_TOKEN = get("TG_BOT_TOKEN");
}

// ---------------------------------------------------------------- texts

const GREETINGS = ["Здравствуйте!", "Добрый день!", "Приветствуем!"];
const GREETINGS_KZ = ["Сәлеметсіз бе!", "Қайырлы күн!"];
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function inviteText(): string {
  return `${pick(GREETINGS)} 🌸
*LOTOS United* приглашает косметологов на практический семинар *«Современные препараты в арсенале косметолога»*
📍 Алматы — 25 ноября · Шымкент — 30 ноября

*1* — Подробнее
*2* — Записаться

———

${pick(GREETINGS_KZ)} 🌸
*LOTOS United* косметологтарды *«Косметолог арсеналындағы заманауи препараттар»* практикалық семинарына шақырады
📍 Алматы — 25 қараша · Шымкент — 30 қараша

*1* — Толығырақ
*2* — Жазылу

Не получать сообщения / Хабарлама алмау: *СТОП*`;
}

const POSTER_URL = "https://raw.githubusercontent.com/Kotov026/Aesthemed/claude/laughing-fermat-8qvjuv/lotos/assets/poster-almaty.jpg";
const POSTER_CAPTION = "LOTOS United · Алматы 25.11 · Шымкент 30.11";

const DETAILS = `*Практический семинар для косметологов*
*«Современные препараты в арсенале косметолога»*

Филлеры, PLLA, ГК, PDRN, экзосомы — особенности, преимущества, показания и гибридные протоколы.

*В программе:*
▫️ Теория с подробным разбором новой продукции LOTOS United
▫️ Особенности и преимущества современных препаратов
▫️ Показания к применению и подбор оптимальных решений
▫️ Проверенные протоколы и техники работы
▫️ Гибридные протоколы и сочетание методик

👩‍⚕️ *Спикер:* Рустанбекова Ирина Анатольевна — врач-дерматокосметолог, магистр медицины, руководитель клиники FaceTime (Астана), сертифицированный тренер LOTOS

📍 Алматы — 25 ноября
📍 Шымкент — 30 ноября
💰 Стоимость: *20 000 ₸*
Количество мест ограничено!

———

*Косметологтарға арналған практикалық семинар*
*«Косметолог арсеналындағы заманауи препараттар»*

Филлерлер, PLLA, ГҚ, PDRN, экзосомалар — ерекшеліктері, артықшылықтары, көрсетілімдері және гибридтік хаттамалар.

*Бағдарламада:*
▫️ LOTOS United жаңа өнімдерін толық талдаумен теория
▫️ Заманауи препараттардың ерекшеліктері мен артықшылықтары
▫️ Қолдану көрсетілімдері және оңтайлы шешімдерді таңдау
▫️ Тексерілген хаттамалар мен жұмыс техникалары
▫️ Гибридтік хаттамалар және әдістерді үйлестіру

👩‍⚕️ *Спикер:* Рустанбекова Ирина Анатольевна — дәрігер-дерматокосметолог, медицина магистрі, FaceTime клиникасының басшысы (Астана), LOTOS сертификатталған тренері

📍 Алматы — 25 қараша
📍 Шымкент — 30 қараша
💰 Құны: *20 000 ₸*
Орын саны шектеулі!

———

*2* — Записаться / Жазылу
*3* — Задать вопрос / Сұрақ қою`;

const ASK_CITY = `Отлично! Напишите, в каком городе будете участвовать: *Алматы* (25.11) или *Шымкент* (30.11)?

Тамаша! Қай қалада қатысасыз: *Алматы* (25.11) әлде *Шымкент* (30.11)?`;

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
  const gap = Number(await setting("min_gap_minutes") ?? 11);
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
    return `sent to ${c.phone}`;
  } catch (e) {
    await db.from("contacts").update({ status: "failed", last_text: String(e).slice(0, 300) }).eq("phone", c.phone);
    await log(c.phone, "error", String(e));
    return `error ${c.phone}`;
  }
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
  const raw: string = md.textMessageData?.textMessage ?? md.extendedTextMessageData?.text ??
    md.fileMessageData?.caption ?? `[${md.typeMessage ?? "сообщение"}]`;
  const t = norm(raw);
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

  switch (c.status) {
    case "new":
    case "sent":
    case "failed":
      if (isDetails(t)) {
        await db.from("contacts").update(upd).eq("phone", phone);
        await green("sendFileByUrl", { chatId: `${phone}@c.us`, urlFile: POSTER_URL, fileName: "lotos-seminar.jpg", caption: POSTER_CAPTION })
          .catch((e) => log(phone, "error", "poster: " + String(e)));
        await sendWa(phone, DETAILS);
      } else if (isYes(t)) {
        await db.from("contacts").update({ ...upd, status: "asked_city" }).eq("phone", phone);
        await sendWa(phone, ASK_CITY);
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
      let city: string;
      if (/^1(\D|$)|алмат/.test(t)) city = "Алматы";
      else if (/^2(\D|$)|шымк|чимк/.test(t)) city = "Шымкент";
      else city = raw.slice(0, 60);
      await db.from("contacts").update({ ...upd, status: "lead", city }).eq("phone", phone);
      await sendWa(phone, THANKS);
      const date = city === "Алматы" ? " (25.11)" : city === "Шымкент" ? " (30.11)" : "";
      await notifyManager(`🆕 ЗАЯВКА — семинар LOTOS${date}\n${card({ ...who, city })}\n\nСвяжитесь для подтверждения и оплаты 20 000 ₸.`);
      return;
    }

    default: // lead, question, stop — a human is handling the chat; just forward
      await db.from("contacts").update(upd).eq("phone", phone);
      await notifyManager(`💬 Сообщение от клиента LOTOS\n${card(who)}\n\n«${raw}»`);
  }
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
  if (chat) await notifyManager("✅ Бот LOTOS подключён. Сюда будут приходить заявки.");
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
