const validTime = (value) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

function workDayRanges(day) {
  return [[day.open, day.close], [day.open2, day.close2]]
    .filter(([open, close]) => validTime(open) && validTime(close))
    .map(([open, close]) => `${open} تا ${close}`);
}

function formatWorkSchedule(schedule) {
  return (Array.isArray(schedule) ? schedule : []).filter((day) => day?.enabled && typeof day.day === "string").flatMap((day) => {
    const ranges = workDayRanges(day);
    return ranges.length ? [`${day.day.trim().slice(0, 20)}: ${ranges.join(" و ")}`] : [];
  }).join(" · ");
}

function workScheduleError(schedule) {
  if (!Array.isArray(schedule)) return false;
  return schedule.some((day) => day?.enabled && (
    !validTime(day.open) || !validTime(day.close) ||
    ((day.open2 || day.close2) && (!validTime(day.open2) || !validTime(day.close2)))
  ));
}

module.exports = { formatWorkSchedule, workScheduleError };
