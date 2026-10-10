const ZIBAL_BASE = "https://gateway.zibal.ir";

function httpError(message, status = 400, code = "BAD_REQUEST") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function merchant() {
  return String(process.env.ZIBAL_MERCHANT || "zibal").trim();
}

function callbackUrl() {
  const url = String(process.env.ZIBAL_CALLBACK_URL || "").trim();
  if (!url) {
    throw httpError(
      "ZIBAL_CALLBACK_URL در تنظیمات سرور تعریف نشده است",
      500,
      "PAYMENT_CONFIG",
    );
  }
  return url;
}

/** قیمت فروشگاه به تومان است؛ زیبال مبلغ را به ریال می‌گیرد. */
function tomanToRial(toman) {
  const amount = Math.round(Number(toman) || 0) * 10;
  if (amount < 1000) {
    throw httpError(
      "مبلغ پرداخت باید حداقل ۱۰۰ تومان باشد",
      400,
      "AMOUNT_TOO_LOW",
    );
  }
  return amount;
}

async function zibalPost(path, body) {
  const response = await fetch(`${ZIBAL_BASE}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!data) {
    throw httpError("پاسخ نامعتبر از زیبال", 502, "ZIBAL_INVALID_RESPONSE");
  }
  return data;
}

async function requestPayment({
  amountToman,
  orderId,
  description,
  mobile,
}) {
  const payload = {
    merchant: merchant(),
    amount: tomanToRial(amountToman),
    callbackUrl: callbackUrl(),
    orderId: String(orderId),
    description: description || `سفارش ${orderId}`,
  };

  if (mobile && /^09\d{9}$/.test(mobile)) {
    payload.mobile = mobile;
  }

  const data = await zibalPost("/v1/request", payload);

  if (Number(data.result) !== 100 || !data.trackId) {
    if (Number(data.result) === 115) {
      console.error("Zibal server IP rejected:", data.message);
      throw httpError("اتصال به درگاه پرداخت ممکن نشد. لطفاً با پشتیبانی سایت تماس بگیرید.", 503, "PAYMENT_CONFIG");
    }
    throw httpError(
      data.message || `خطا در ایجاد پرداخت (${data.result || "?"})`,
      400,
      "ZIBAL_REQUEST_FAILED",
    );
  }

  return {
    trackId: data.trackId,
    result: data.result,
    message: data.message,
    paymentUrl: `${ZIBAL_BASE}/start/${data.trackId}`,
  };
}

async function verifyPayment(trackId) {
  const data = await zibalPost("/v1/verify", {
    merchant: merchant(),
    trackId: Number(trackId),
  });

  return data;
}

async function inquiryPayment(trackId) {
  const data = await zibalPost("/v1/inquiry", {
    merchant: merchant(),
    trackId: Number(trackId),
  });
  return data;
}

const REQUEST_RESULT_FA = {
  100: "با موفقیت انجام شد",
  102: "merchant یافت نشد",
  103: "merchant غیرفعال است",
  104: "merchant نامعتبر است",
  105: "مبلغ باید بزرگ‌تر از ۱٬۰۰۰ ریال باشد",
  106: "callbackUrl نامعتبر است",
  115: "IP سرور در پنل زیبال ثبت نشده است",
};

const VERIFY_RESULT_FA = {
  100: "پرداخت با موفقیت تایید شد",
  201: "این پرداخت قبلاً تایید شده است",
  202: "سفارش پرداخت نشده یا ناموفق بوده است",
  203: "trackId نامعتبر است",
};

module.exports = {
  requestPayment,
  verifyPayment,
  inquiryPayment,
  tomanToRial,
  REQUEST_RESULT_FA,
  VERIFY_RESULT_FA,
};
