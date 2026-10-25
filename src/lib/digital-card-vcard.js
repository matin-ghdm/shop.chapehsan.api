const SOCIAL_HOSTS = {
  whatsapp: "https://wa.me/",
  telegram: "https://t.me/",
  instagram: "https://instagram.com/",
  eitaa: "https://eitaa.com/",
  rubika: "https://rubika.ir/",
  bale: "https://ble.ir/",
  soroush: "https://splus.ir/",
  igap: "https://igap.net/",
  gap: "https://gap.im/",
  shad: "https://shad.ir/",
  x: "https://x.com/",
  twitter: "https://x.com/",
  linkedin: "https://linkedin.com/in/",
  aparat: "https://aparat.com/",
  facebook: "https://facebook.com/",
  youtube: "https://youtube.com/",
  tiktok: "https://tiktok.com/@",
  snapchat: "https://snapchat.com/add/",
};

function clean(value, max = 2000) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function escape(value) {
  return clean(value).replace(/\r\n?/g, "\n").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function normalizeUrl(value, platform = "") {
  const text = clean(value, 1000);
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  const host = SOCIAL_HOSTS[platform];
  if (host) return `${host}${encodeURIComponent(text.replace(/^@/, ""))}`;
  if (/^(www\.)?[\w-]+\.[a-z]{2,}(\/|$)/i.test(text)) return `https://${text}`;
  return "";
}

function foldLine(line) {
  const parts = [];
  let part = "";
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > 75) {
      parts.push(part);
      part = " ";
      bytes = 1;
    }
    part += character;
    bytes += size;
  }
  parts.push(part);
  return parts.join("\r\n");
}

function buildDigitalCardVCard(card) {
  const data = card?.data && typeof card.data === "object" ? card.data : {};
  const firstName = clean(data.firstName, 120);
  const lastName = clean(data.lastName, 120);
  const fullName = [firstName, lastName].filter(Boolean).join(" ") || clean(card?.title, 120) || "کارت دیجیتال";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN;CHARSET=UTF-8:${escape(fullName)}`,
    `N;CHARSET=UTF-8:${escape(lastName)};${escape(firstName)};;;`,
  ];
  if (data.company) lines.push(`ORG;CHARSET=UTF-8:${escape(data.company)}`);
  if (data.job) lines.push(`TITLE;CHARSET=UTF-8:${escape(data.job)}`);

  const phones = Array.isArray(data.phones) ? data.phones.filter((phone) => phone?.value && phone.visible !== false) : [];
  for (const phone of phones) {
    const number = phone.kind === "landline" && phone.cityCode ? `${phone.cityCode}${phone.value}` : phone.value;
    const type = phone.kind === "fax" ? "WORK,FAX" : phone.kind === "landline" ? "WORK,VOICE" : "CELL";
    lines.push(`TEL;TYPE=${type}:${escape(number)}`);
  }
  if (data.fax) lines.push(`TEL;TYPE=WORK,FAX:${escape(data.fax)}`);
  if (data.email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${escape(data.email)}`);

  const notes = [];
  if (data.bio) notes.push(`معرفی: ${clean(data.bio, 500)}`);
  const urls = new Set();
  const addUrl = (value, platform = "") => {
    const url = normalizeUrl(value, platform);
    if (url) urls.add(url);
    return url;
  };
  for (const [label, value] of [["وب‌سایت", data.website], ["فروشگاه", data.shopLink], ["کاتالوگ", data.catalog]]) {
    const url = addUrl(value);
    if (url) notes.push(`${label}: ${url}`);
  }

  const addresses = Array.isArray(data.addresses)
    ? data.addresses.filter((address) => address?.value && address.visible !== false)
    : data.address ? [{ label: "دفتر مرکزی", value: data.address, postalCode: data.postalCode, map: data.map }] : [];
  for (const address of addresses) {
    lines.push(`ADR;TYPE=WORK;CHARSET=UTF-8:;;${escape(address.value)};;;${escape(address.postalCode || "")};`);
    notes.push(`${clean(address.label || "نشانی", 80)}: ${clean(address.value, 500)}`);
    const map = addUrl(address.map);
    if (map) notes.push(`نقشه: ${map}`);
  }

  const socials = Array.isArray(data.socialLinks)
    ? data.socialLinks.filter((social) => social?.value && social.visible !== false)
    : Object.entries(SOCIAL_HOSTS).filter(([platform]) => data[platform]).map(([platform]) => ({ platform, label: platform, value: data[platform] }));
  for (const social of socials) {
    const url = addUrl(social.value, social.platform);
    notes.push(`${clean(social.label || social.platform, 80)}: ${url || clean(social.value, 500)}`);
  }
  for (const item of [...(Array.isArray(data.customLinks) ? data.customLinks : []), ...(Array.isArray(data.portfolio) ? data.portfolio : [])]) {
    if (!item?.url || item.visible === false) continue;
    const url = addUrl(item.url);
    notes.push(`${clean(item.label || "پیوند", 80)}: ${url || clean(item.url, 500)}`);
  }
  for (const url of urls) lines.push(`URL:${escape(url)}`);

  const schedule = Array.isArray(data.hoursSchedule) ? data.hoursSchedule.filter((day) => day?.enabled && day.day && day.open && day.close) : [];
  if (schedule.length) notes.push(`ساعات کاری: ${schedule.map((day) => `${clean(day.day, 20)} ${clean(day.open, 5)} تا ${clean(day.close, 5)}`).join("، ")}`);
  else if (data.hours) notes.push(`ساعات کاری: ${clean(data.hours, 300)}`);

  const accounts = Array.isArray(data.paymentAccounts) ? data.paymentAccounts : [];
  for (const account of accounts) {
    const details = [account.bankName, account.ownerName, account.cardNumber && `کارت ${account.cardNumber}`, account.accountNumber && `حساب ${account.accountNumber}`, account.iban && `شبا ${account.iban}`].filter(Boolean);
    if (details.length) notes.push(`اطلاعات پرداخت: ${details.map((part) => clean(part, 120)).join(" · ")}`);
  }
  if (notes.length) lines.push(`NOTE;CHARSET=UTF-8:${escape(notes.join("\n")).slice(0, 12000)}`);
  lines.push("END:VCARD");
  return lines.map(foldLine).join("\r\n");
}

module.exports = { buildDigitalCardVCard };
