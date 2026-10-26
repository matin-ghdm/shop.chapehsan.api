const SMSIR_BASE = "https://api.sms.ir/v1";

function httpError(message, status = 400, code = "SMS_FAILED") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function apiKey() {
  const key = String(process.env.SMSIR_API_KEY || "").trim();
  if (!key) {
    throw httpError(
      "SMSIR_API_KEY در تنظیمات سرور تعریف نشده است",
      500,
      "SMS_CONFIG",
    );
  }
  return key;
}

function templateId() {
  const id = Number(process.env.SMSIR_OTP_TEMPLATE_ID || 0);
  if (!id) {
    throw httpError(
      "SMSIR_OTP_TEMPLATE_ID در تنظیمات سرور تعریف نشده است",
      500,
      "SMS_CONFIG",
    );
  }
  return id;
}

function otpParamName() {
  return String(process.env.SMSIR_OTP_PARAM || "CODE").trim() || "CODE";
}

/**
 * Send OTP via sms.ir Verify API.
 * @param {string} mobile - 09xxxxxxxxx
 * @param {string} code - numeric OTP
 */
async function sendOtp(mobile, code) {
  return sendTemplate(mobile, templateId(), [
    { name: otpParamName(), value: String(code) },
  ]);
}

/** Send a configured sms.ir Verify template without changing OTP settings. */
async function sendTemplate(mobile, id, parameters) {
  const normalizedMobile = String(mobile || "").trim();
  const normalizedTemplateId = Number(id);
  if (!/^09\d{9}$/.test(normalizedMobile)) {
    throw httpError("شمارهٔ مقصد پیامک معتبر نیست", 400, "SMS_INVALID_MOBILE");
  }
  if (!Number.isSafeInteger(normalizedTemplateId) || normalizedTemplateId < 1) {
    throw httpError("شناسهٔ قالب پیامک معتبر نیست", 400, "SMS_CONFIG");
  }
  const safeParameters = (Array.isArray(parameters) ? parameters : [])
    .slice(0, 10)
    .map((item) => ({
      name: String(item?.name || "").trim().slice(0, 50),
      value: String(item?.value ?? "").slice(0, 500),
    }))
    .filter((item) => /^[A-Za-z0-9_]+$/.test(item.name));
  if (!safeParameters.length) {
    throw httpError("پارامترهای قالب پیامک معتبر نیستند", 400, "SMS_CONFIG");
  }

  const response = await fetch(`${SMSIR_BASE}/send/verify`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
    },
    body: JSON.stringify({
      mobile: normalizedMobile,
      templateId: normalizedTemplateId,
      parameters: safeParameters,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    console.error("sms.ir HTTP error:", response.status, data);
    throw httpError("ارسال پیامک ناموفق بود", 502, "SMS_HTTP_ERROR");
  }

  const status = Number(data.status);
  if (status !== 1) {
    console.error("sms.ir API error:", data);
    const message =
      data?.message ||
      (Array.isArray(data?.messages) && data.messages[0]) ||
      "ارسال پیامک ناموفق بود";
    throw httpError(String(message), 502, "SMS_API_ERROR");
  }

  return data;
}

module.exports = {
  sendOtp,
  sendTemplate,
};
