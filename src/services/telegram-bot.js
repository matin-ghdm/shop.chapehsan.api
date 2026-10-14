const { query } = require("../db");

const API_BASE = "https://api.telegram.org/bot";
const MENU = {
  keyboard: [
    [{ text: "ثبت سفارش خاص" }, { text: "پرسش‌های پرتکرار" }],
    [{ text: "ارتباط با پشتیبانی" }],
  ],
  resize_keyboard: true,
};
const FAQ_MENU = {
  keyboard: [
    [{ text: "ساعت کاری" }, { text: "ثبت سفارش در سایت" }],
    [{ text: "هزینه و زمان ارسال" }, { text: "بازگشت به منو" }],
  ],
  resize_keyboard: true,
};
const CONTACT_MENU = {
  keyboard: [
    [{ text: "ارسال شماره تماس", request_contact: true }],
    [{ text: "ثبت بدون شماره" }, { text: "لغو" }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function configuredAdminIds() {
  return [...new Set(
    String(process.env.TELEGRAM_ADMIN_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^-?\d+$/.test(value)),
  )];
}

function tehranDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function isBusinessHours(date = new Date()) {
  const parts = tehranDateParts(date);
  if (parts.weekday === "Fri") return false;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return (minutes >= 9 * 60 && minutes < 14 * 60) ||
    (minutes >= 15 * 60 && minutes < 21 * 60);
}

function afterHoursMessage() {
  return "سلام! پیام شما دریافت شد. ساعت پاسخ‌گویی ما شنبه تا پنجشنبه، ۹ تا ۱۴ و ۱۵ تا ۲۱ است؛ جمعه‌ها تعطیل هستیم. در اولین ساعت کاری پاسخ می‌دهیم. اگر درخواست سفارش دارید، از دکمهٔ «ثبت سفارش خاص» استفاده کنید.";
}

function faqAnswer(question) {
  const answers = {
    "ساعت کاری": "شنبه تا پنجشنبه، ۹ تا ۱۴ و ۱۵ تا ۲۱ پاسخ‌گو هستیم. جمعه‌ها تعطیل هستیم.",
    "ثبت سفارش در سایت": "اگر سفارش شما در سایت قابل ثبت نیست، گزینهٔ «ثبت سفارش خاص» را بزنید تا درخواستتان برای پشتیبانی ارسال شود.",
    "هزینه و زمان ارسال": "هزینه و زمان ارسال به نوع سفارش و مقصد بستگی دارد. درخواستتان را برای پشتیبانی بفرستید تا پس از بررسی دقیق اطلاع بدهیم.",
  };
  return answers[question] || "پاسخ این پرسش را هنوز به فهرست اضافه نکرده‌ایم. از «ارتباط با پشتیبانی» استفاده کنید تا همکاران راهنمایی‌تان کنند.";
}

async function telegram(method, payload) {
  const response = await fetch(`${API_BASE}${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) {
    throw new Error(body.description || `Telegram ${method} failed (${response.status})`);
  }
  return body.result;
}

async function sendMessage(chatId, text, options = {}) {
  return telegram("sendMessage", {
    chat_id: chatId,
    text,
    ...options,
  });
}

async function notifyLaserRequest(request) {
  const admins = configuredAdminIds();
  if (!admins.length) {
    console.warn("Laser order request saved, but TELEGRAM_ADMIN_IDS is empty");
    return;
  }
  const text = [
    `درخواست جدید حکاکی لیزری #${request.id}`,
    `خدمت: ${request.service === "fiber" ? "حکاکی فایبر" : "برش و حکاکی CO2"}`,
    `نام: ${request.customer_name}`,
    `تماس: ${request.phone}`,
    `جنس: ${request.material}`,
    `شرح محصول/کار: ${request.item_description}`,
    `تعداد: ${request.quantity}`,
    `ابعاد: ${request.dimensions || "اعلام نشده"}`,
    `تأمین متریال: ${{ customer: "مشتری", business: "چاپ احسان", unsure: "نیازمند مشاوره" }[request.material_provided_by] || "نامشخص"}`,
    `زمان موردنیاز: ${request.needed_by || "اعلام نشده"}`,
    `فایل و توضیحات طرح: ${request.artwork_note || "اعلام نشده"}`,
  ].join("\n");
  for (const adminId of admins) {
    try {
      await sendMessage(adminId, text);
    } catch (error) {
      console.error(`Telegram laser request notification failed for ${adminId}:`, error.message);
    }
  }
}

async function notifyServiceRequest(request) {
  const admins = configuredAdminIds();
  if (!admins.length) {
    console.warn("Service request saved, but TELEGRAM_ADMIN_IDS is empty");
    return;
  }
  const text = [
    `درخواست جدید خدمات #${request.id}`,
    `خدمت: ${request.service_label}`,
    `نام: ${request.customer_name}`,
    `تماس: ${request.phone}`,
    `شرح درخواست: ${request.item_description}`,
    `تعداد: ${request.quantity}`,
    `توضیحات تکمیلی: ${request.details || "اعلام نشده"}`,
  ].join("\n");
  for (const adminId of admins) {
    try { await sendMessage(adminId, text); }
    catch (error) { console.error(`Service request notification failed for ${adminId}:`, error.message); }
  }
}

async function upsertUser(message) {
  const chatId = String(message.chat.id);
  await query(
    `INSERT INTO telegram_bot_users (chat_id, username, first_name, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       updated_at = NOW()`,
    [chatId, message.from?.username || null, message.from?.first_name || null],
  );
  return chatId;
}

async function getSession(chatId) {
  const result = await query(
    "SELECT step, request_kind, description, media_file_id FROM telegram_bot_sessions WHERE chat_id = $1",
    [chatId],
  );
  return result.rows[0] || null;
}

async function clearSession(chatId) {
  await query("DELETE FROM telegram_bot_sessions WHERE chat_id = $1", [chatId]);
}

async function beginRequest(chatId, kind) {
  await query(
    `INSERT INTO telegram_bot_sessions (chat_id, step, request_kind, updated_at)
     VALUES ($1, 'description', $2, NOW())
     ON CONFLICT (chat_id) DO UPDATE SET
       step = 'description', request_kind = EXCLUDED.request_kind,
       description = NULL, updated_at = NOW()`,
    [chatId, kind],
  );
  const prompt = kind === "custom_order"
    ? "لطفاً جزئیات سفارش را بنویسید؛ مثل نوع محصول، تعداد، اندازه، متن یا طرح دلخواه. اگر لازم است، عکس را هم بعد از توضیحات بفرستید."
    : "لطفاً پرسش یا موضوعی را که می‌خواهید پشتیبانی پیگیری کند بنویسید.";
  await sendMessage(chatId, prompt, { reply_markup: { force_reply: true } });
}

async function notifyAdmins(requestId, request, user) {
  const admins = configuredAdminIds();
  if (!admins.length) {
    console.warn("Telegram request saved, but TELEGRAM_ADMIN_IDS is empty");
    return;
  }
  const kind = request.request_kind === "custom_order" ? "سفارش خاص" : "پشتیبانی";
  const username = user.username ? `@${user.username}` : "ندارد";
  const text = [
    `درخواست جدید #${requestId} (${kind})`,
    `نام تلگرام: ${user.first_name || "نامشخص"}`,
    `نام کاربری: ${username}`,
    `شناسهٔ گفتگو: ${request.chat_id}`,
    `شماره تماس: ${request.phone || "ثبت نشده"}`,
    "شرح درخواست:",
    request.description,
    "",
    `برای پاسخ: /reply ${requestId} متن پاسخ`,
    `برای بستن: /done ${requestId}`,
  ].join("\n");
  for (const adminId of admins) {
    try {
      await sendMessage(adminId, text);
      if (request.media_file_id) {
        await telegram("sendPhoto", {
          chat_id: adminId,
          photo: request.media_file_id,
          caption: `عکس پیوست درخواست #${requestId}`,
        });
      }
    } catch (error) {
      console.error(`Telegram admin notification failed for ${adminId}:`, error.message);
    }
  }
}

async function saveRequest(chatId, session, phone) {
  const inserted = await query(
    `INSERT INTO telegram_bot_requests (chat_id, request_kind, description, media_file_id, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, chat_id, request_kind, description, media_file_id, phone`,
    [chatId, session.request_kind, session.description, session.media_file_id || null, phone],
  );
  if (phone) {
    await query(
      "UPDATE telegram_bot_users SET phone = $2, updated_at = NOW() WHERE chat_id = $1",
      [chatId, phone],
    );
  }
  await clearSession(chatId);
  const request = inserted.rows[0];
  const userResult = await query(
    "SELECT username, first_name FROM telegram_bot_users WHERE chat_id = $1",
    [chatId],
  );
  await notifyAdmins(request.id, request, userResult.rows[0] || {});
  await sendMessage(
    chatId,
    `درخواست شما با شمارهٔ ${request.id} ثبت شد. همکاران در اولین فرصت بررسی می‌کنند.`,
    { reply_markup: MENU },
  );
}

async function handleAdminCommand(chatId, text) {
  if (!configuredAdminIds().includes(String(chatId))) return false;

  const replyMatch = text.match(/^\/reply\s+(\d+)\s+([\s\S]+)$/);
  if (replyMatch) {
    const [, id, answer] = replyMatch;
    const result = await query(
      "SELECT chat_id FROM telegram_bot_requests WHERE id = $1",
      [id],
    );
    if (!result.rows[0]) {
      await sendMessage(chatId, `درخواست شمارهٔ ${id} پیدا نشد.`);
      return true;
    }
    await sendMessage(result.rows[0].chat_id, `پاسخ پشتیبانی به درخواست ${id}:\n${answer}`, { reply_markup: MENU });
    await query(
      "UPDATE telegram_bot_requests SET status = 'answered', updated_at = NOW() WHERE id = $1",
      [id],
    );
    await sendMessage(chatId, `پاسخ درخواست ${id} ارسال شد.`);
    return true;
  }

  const doneMatch = text.match(/^\/done\s+(\d+)$/);
  if (doneMatch) {
    const result = await query(
      "UPDATE telegram_bot_requests SET status = 'closed', updated_at = NOW() WHERE id = $1 RETURNING id",
      [doneMatch[1]],
    );
    await sendMessage(chatId, result.rowCount ? `درخواست ${doneMatch[1]} بسته شد.` : "درخواستی با این شماره پیدا نشد.");
    return true;
  }

  if (text === "/requests") {
    const result = await query(
      `SELECT id, request_kind, created_at FROM telegram_bot_requests
       WHERE status = 'new' ORDER BY created_at DESC LIMIT 20`,
    );
    const summary = result.rows.map((row) =>
      `#${row.id} — ${row.request_kind === "custom_order" ? "سفارش خاص" : "پشتیبانی"} — ${new Date(row.created_at).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" })}`,
    );
    await sendMessage(chatId, summary.length ? `درخواست‌های باز:\n${summary.join("\n")}` : "درخواست بازی ندارید.");
    return true;
  }
  return false;
}

async function maybeSendAfterHoursNotice(chatId) {
  if (isBusinessHours()) return;
  const parts = tehranDateParts();
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const result = await query(
    `UPDATE telegram_bot_users SET last_after_hours_notice_on = $2::date, updated_at = NOW()
     WHERE chat_id = $1 AND last_after_hours_notice_on IS DISTINCT FROM $2::date
     RETURNING chat_id`,
    [chatId, localDate],
  );
  if (result.rowCount) await sendMessage(chatId, afterHoursMessage(), { reply_markup: MENU });
}

async function handleMessage(message) {
  if (!message?.chat || message.chat.type !== "private") return;
  const chatId = await upsertUser(message);
  const text = String(message.text || "").trim();

  if (message.contact?.phone_number) {
    const session = await getSession(chatId);
    if (session?.step === "contact") {
      const phone = message.contact.phone_number;
      await saveRequest(chatId, session, phone);
      return;
    }
  }

  if (text === "/id") {
    await sendMessage(chatId, `شناسهٔ تلگرام شما: ${chatId}`);
    return;
  }

  if (await handleAdminCommand(chatId, text)) return;

  if (text === "/start") {
    await clearSession(chatId);
    await sendMessage(chatId, `سلام ${message.from?.first_name || ""}! به پشتیبانی چاپ احسان خوش آمدید. چطور می‌توانیم کمک کنیم؟`, { reply_markup: MENU });
    await maybeSendAfterHoursNotice(chatId);
    return;
  }

  if (text === "/cancel" || text === "لغو") {
    await clearSession(chatId);
    await sendMessage(chatId, "درخواست لغو شد. هر زمان خواستید می‌توانید دوباره شروع کنید.", { reply_markup: MENU });
    await maybeSendAfterHoursNotice(chatId);
    return;
  }

  if (text === "ثبت سفارش خاص") {
    await beginRequest(chatId, "custom_order");
    await maybeSendAfterHoursNotice(chatId);
    return;
  }
  if (text === "ارتباط با پشتیبانی") {
    await beginRequest(chatId, "support");
    await maybeSendAfterHoursNotice(chatId);
    return;
  }
  if (text === "پرسش‌های پرتکرار") {
    await sendMessage(chatId, "موضوع پرسشتان را انتخاب کنید:", { reply_markup: FAQ_MENU });
    return;
  }
  if (text === "بازگشت به منو") {
    await sendMessage(chatId, "منوی اصلی:", { reply_markup: MENU });
    return;
  }
  if (["ساعت کاری", "ثبت سفارش در سایت", "هزینه و زمان ارسال"].includes(text)) {
    await sendMessage(chatId, faqAnswer(text), { reply_markup: MENU });
    return;
  }

  const session = await getSession(chatId);
  if (session?.step === "description") {
    const description = text || message.caption || (message.photo ? "عکس سفارش پیوست شده است." : "");
    if (!description) {
      await sendMessage(chatId, "لطفاً توضیحات سفارش یا پرسشتان را به صورت متن یا عکس بفرستید.");
      return;
    }
    await query(
      `UPDATE telegram_bot_sessions
       SET step = 'contact', description = $2, media_file_id = $3, updated_at = NOW()
       WHERE chat_id = $1`,
      [chatId, description, message.photo?.at(-1)?.file_id || null],
    );
    await sendMessage(chatId, "اگر مایلید شماره تماس هم برای پیگیری بفرستید؛ در غیر این صورت «ثبت بدون شماره» را بزنید.", { reply_markup: CONTACT_MENU });
    await maybeSendAfterHoursNotice(chatId);
    return;
  }
  if (session?.step === "contact") {
    if (message.photo) {
      await query(
        `UPDATE telegram_bot_sessions
         SET media_file_id = $2, description = CASE WHEN $3 = '' THEN description ELSE CONCAT(description, E'\\n', $3) END,
             updated_at = NOW()
         WHERE chat_id = $1`,
        [chatId, message.photo.at(-1).file_id, message.caption || ""],
      );
      await sendMessage(chatId, "عکس به درخواستتان پیوست شد. شماره تماس را بفرستید یا «ثبت بدون شماره» را انتخاب کنید.", { reply_markup: CONTACT_MENU });
      return;
    }
    if (text === "ثبت بدون شماره") {
      await saveRequest(chatId, session, null);
      return;
    }
    if (text) {
      await saveRequest(chatId, session, text);
      return;
    }
    await sendMessage(chatId, "برای ادامه، شماره تماس را بفرستید یا «ثبت بدون شماره» را انتخاب کنید.", { reply_markup: CONTACT_MENU });
    return;
  }

  await sendMessage(chatId, "پیامتان را دریافت کردم. برای ثبت سفارش از «ثبت سفارش خاص» و برای راهنمایی از «ارتباط با پشتیبانی» استفاده کنید.", { reply_markup: MENU });
  await maybeSendAfterHoursNotice(chatId);
}

async function getOffset() {
  const result = await query("SELECT value FROM telegram_bot_state WHERE key = 'update_offset'");
  return result.rows[0] ? Number(result.rows[0].value) : undefined;
}

async function saveOffset(offset) {
  await query(
    `INSERT INTO telegram_bot_state (key, value, updated_at)
     VALUES ('update_offset', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [String(offset)],
  );
}

async function poll() {
  let offset = await getOffset();
  console.log("Telegram bot polling started");
  while (true) {
    try {
      const updates = await telegram("getUpdates", {
        ...(offset === undefined ? {} : { offset }),
        timeout: 25,
        allowed_updates: ["message"],
      });
      for (const update of updates) {
        try {
          await handleMessage(update.message);
        } catch (error) {
          console.error(`Telegram update ${update.update_id} failed:`, error.message);
        }
        offset = update.update_id + 1;
        await saveOffset(offset);
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

function startTelegramBot() {
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.log("Telegram bot is disabled; set TELEGRAM_BOT_TOKEN to enable it");
    return;
  }
  if (!configuredAdminIds().length) {
    console.warn("TELEGRAM_ADMIN_IDS is empty; requests will be saved without admin notifications");
  }
  poll().catch((error) => console.error("Telegram bot failed to start:", error.message));
}

module.exports = { startTelegramBot, isBusinessHours, afterHoursMessage, notifyLaserRequest, notifyServiceRequest };
