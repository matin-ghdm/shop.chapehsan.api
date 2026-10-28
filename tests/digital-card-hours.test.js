const test = require("node:test");
const assert = require("node:assert/strict");
const { formatWorkSchedule, workScheduleError } = require("../src/lib/digital-card-hours");
const { planSnapshot, publicCardData, validateCardDataShape } = require("../src/services/digital-card-entitlements");
const first = { day: "شنبه", enabled: true, open: "09:00", close: "13:00" };
const split = { ...first, open2: "17:00", close2: "21:00" };

test("single-shift cards retain their hours and split shifts are included in contact notes", () => {
  assert.equal(formatWorkSchedule([first]), "شنبه: 09:00 تا 13:00");
  assert.equal(formatWorkSchedule([split]), "شنبه: 09:00 تا 13:00 و 17:00 تا 21:00");
  assert.equal(formatWorkSchedule([{ ...split, enabled: false }]), "");
  assert.equal(formatWorkSchedule([{ ...first, open: "21:00", close: "01:00" }]), "شنبه: 21:00 تا 01:00");
});

test("incomplete second shifts are rejected for active days without blocking disabled days", () => {
  assert.equal(workScheduleError([split]), false);
  assert.equal(workScheduleError([{ ...split, close2: "" }]), true);
  assert.equal(workScheduleError([{ ...split, open2: "25:00" }]), true);
  assert.equal(workScheduleError([{ ...split, close2: "", enabled: false }]), false);
  assert.equal(validateCardDataShape({ hoursSchedule: [split] }).length, 0);
  assert.ok(validateCardDataShape({ hoursSchedule: [{ ...split, close2: "" }] }).some((error) => error.field === "hoursSchedule"));
});

test("both shifts survive JSON storage and public projection on all plans", () => {
  const data = JSON.parse(JSON.stringify({ hoursSchedule: [split] }));
  for (const tier of ["bronze", "silver", "gold"]) assert.deepEqual(publicCardData(data, planSnapshot({}, tier)).hoursSchedule, [split]);
  assert.deepEqual(data.hoursSchedule, [split]);
});
