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
  const response = await fetch(`${SMSIR_BASE}/send/verify`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-api-key": apiKey(),
    },
    body: JSON.stringify({
      mobile,
      templateId: templateId(),
      parameters: [{ name: otpParamName(), value: String(code) }],
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
};
