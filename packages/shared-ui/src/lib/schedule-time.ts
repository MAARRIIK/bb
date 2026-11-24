const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const EVENING_HOUR = 18;
const MORNING_HOUR = 9;

export const MAX_SCHEDULE_AHEAD_MS = 365 * DAY_MS;

export type SchedulePresetId =
  | "in-5-minutes"
  | "in-10-minutes"
  | "in-30-minutes"
  | "in-1-hour"
  | "in-2-hours"
  | "this-evening"
  | "tomorrow-morning";

export type ScheduleLanguage = "en" | "ru";
export type ScheduleValidationMessage =
  | "That option has passed. Choose another time."
  | "Choose a date."
  | "Choose a time."
  | "Choose a real date and time."
  | "Choose a future time."
  | "Pick a time within the next year."
  | "That time has just passed. Pick another.";
export type ScheduleTimeError =
  | { kind: "validation"; message: ScheduleValidationMessage }
  | { kind: "request"; message: string };

const SCHEDULE_TEXT = {
  en: {
    when: "When",
    whenToSend: "When to send",
    custom: "Custom date and time",
    date: "Date",
    time: "Time",
    sends: "Sends",
    sending: "Sending",
    localTime: "Local time",
    changeTitle: "Change send time",
    messageDescription: "Choose when this message should send.",
    remove: "Remove send time",
    cancel: "Cancel",
    close: "Close",
    save: "Save",
    saving: "Saving…",
    removed: "Send time removed",
    failedChange: "Failed to change when the queued message sends",
    laterTitle: "Send later",
    threadDescription:
      "Choose when this thread should start. It will use the model and environment selected in the composer.",
    schedule: "Schedule send",
    scheduling: "Scheduling…",
    presets: {
      "in-5-minutes": "In 5 minutes",
      "in-10-minutes": "In 10 minutes",
      "in-30-minutes": "In 30 minutes",
      "in-1-hour": "In 1 hour",
      "in-2-hours": "In 2 hours",
      "this-evening": "This evening",
      "tomorrow-morning": "Tomorrow morning",
    },
    validation: {
      "That option has passed. Choose another time.":
        "That option has passed. Choose another time.",
      "Choose a date.": "Choose a date.",
      "Choose a time.": "Choose a time.",
      "Choose a real date and time.": "Choose a real date and time.",
      "Choose a future time.": "Choose a future time.",
      "Pick a time within the next year.": "Pick a time within the next year.",
      "That time has just passed. Pick another.":
        "That time has just passed. Pick another.",
    },
  },
  ru: {
    when: "Когда",
    whenToSend: "Когда отправить",
    custom: "Свои дата и время",
    date: "Дата",
    time: "Время",
    sends: "Отправка:",
    sending: "Отправка:",
    localTime: "Местное время",
    changeTitle: "Изменить время отправки",
    messageDescription: "Выбери, когда отправить это сообщение.",
    remove: "Убрать время отправки",
    cancel: "Отмена",
    close: "Закрыть",
    save: "Сохранить",
    saving: "Сохранение…",
    removed: "Время отправки убрано",
    failedChange: "Не удалось изменить время отправки сообщения из очереди",
    laterTitle: "Отправить позже",
    threadDescription:
      "Выбери, когда начать этот диалог. Он использует модель и рабочую папку, выбранные в редакторе.",
    schedule: "Запланировать отправку",
    scheduling: "Планирование…",
    presets: {
      "in-5-minutes": "Через 5 минут",
      "in-10-minutes": "Через 10 минут",
      "in-30-minutes": "Через 30 минут",
      "in-1-hour": "Через час",
      "in-2-hours": "Через 2 часа",
      "this-evening": "Сегодня вечером",
      "tomorrow-morning": "Завтра утром",
    },
    validation: {
      "That option has passed. Choose another time.":
        "Это время уже прошло. Выбери другое.",
      "Choose a date.": "Выбери дату.",
      "Choose a time.": "Выбери время.",
      "Choose a real date and time.": "Выбери существующие дату и время.",
      "Choose a future time.": "Выбери время в будущем.",
      "Pick a time within the next year.":
        "Выбери время в пределах следующего года.",
      "That time has just passed. Pick another.":
        "Это время только что прошло. Выбери другое.",
    },
  },
};

export function scheduleTimeText(language: ScheduleLanguage) {
  return SCHEDULE_TEXT[language];
}

export function scheduleValidationText(
  message: ScheduleValidationMessage,
  language: ScheduleLanguage,
): string {
  return SCHEDULE_TEXT[language].validation[message];
}

export const DEFAULT_SCHEDULE_PRESET_ID: SchedulePresetId = "in-1-hour";

export interface SchedulePreset {
  id: SchedulePresetId;
  label: string;
  at: number;
}

export function isSchedulePresetId(value: string): value is SchedulePresetId {
  switch (value) {
    case "in-5-minutes":
    case "in-10-minutes":
    case "in-30-minutes":
    case "in-1-hour":
    case "in-2-hours":
    case "this-evening":
    case "tomorrow-morning":
      return true;
    default:
      return false;
  }
}

export function listSchedulePresets(
  now: number,
  language: ScheduleLanguage = "en",
): SchedulePreset[] {
  const candidates: Omit<SchedulePreset, "label">[] = [
    { id: "in-5-minutes", at: now + 5 * MINUTE_MS },
    { id: "in-10-minutes", at: now + 10 * MINUTE_MS },
    {
      id: "in-30-minutes",
      at: now + 30 * MINUTE_MS,
    },
    { id: "in-1-hour", at: now + HOUR_MS },
    { id: "in-2-hours", at: now + 2 * HOUR_MS },
    {
      id: "this-evening",
      at: atLocalTime(now, 0, EVENING_HOUR, 0),
    },
    {
      id: "tomorrow-morning",
      at: atLocalTime(now, 1, MORNING_HOUR, 0),
    },
  ];
  return candidates
    .filter((preset) => preset.at > now)
    .map((preset) => ({
      ...preset,
      label: scheduleTimeText(language).presets[preset.id],
    }));
}

function atLocalTime(
  now: number,
  dayOffset: number,
  hour: number,
  minute: number,
): number {
  const date = new Date(now);
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

export type ScheduleTimeParse =
  | { ok: true; at: number }
  | { ok: false; message: ScheduleValidationMessage };

export interface CustomScheduleFields {
  date: string;
  time: string;
}

export function defaultCustomSchedule(now: number): CustomScheduleFields {
  return {
    date: formatDateInputValue(atLocalTime(now, 1, MORNING_HOUR, 0)),
    time: "09:00",
  };
}

export function customScheduleAt(at: number): CustomScheduleFields {
  const date = new Date(at);
  return {
    date: formatDateInputValue(at),
    time: [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
    ].join(":"),
  };
}

export const CUSTOM_SCHEDULE_OPTION_ID = "custom";
export type ScheduleOptionId =
  | SchedulePresetId
  | typeof CUSTOM_SCHEDULE_OPTION_ID;

export function isScheduleOptionId(value: string): value is ScheduleOptionId {
  return value === CUSTOM_SCHEDULE_OPTION_ID || isSchedulePresetId(value);
}

export function resolveScheduleOption(
  optionId: ScheduleOptionId,
  custom: CustomScheduleFields,
  now: number,
): ScheduleTimeParse {
  if (optionId === CUSTOM_SCHEDULE_OPTION_ID) {
    return parseCustomScheduleTime(custom, now);
  }
  const preset = listSchedulePresets(now).find(
    (candidate) => candidate.id === optionId,
  );
  return preset === undefined
    ? { ok: false, message: "That option has passed. Choose another time." }
    : { ok: true, at: preset.at };
}

export function formatDateInputValue(at: number): string {
  const date = new Date(at);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_INPUT_PATTERN = /^(\d{2}):(\d{2})$/;

export function parseCustomScheduleTime(
  fields: CustomScheduleFields,
  now: number,
): ScheduleTimeParse {
  const dateMatch = DATE_INPUT_PATTERN.exec(fields.date);
  if (dateMatch === null) return { ok: false, message: "Choose a date." };

  const timeMatch = TIME_INPUT_PATTERN.exec(fields.time);
  if (timeMatch === null) return { ok: false, message: "Choose a time." };

  const year = Number.parseInt(dateMatch[1], 10);
  const month = Number.parseInt(dateMatch[2], 10);
  const day = Number.parseInt(dateMatch[3], 10);
  const hour = Number.parseInt(timeMatch[1], 10);
  const minute = Number.parseInt(timeMatch[2], 10);
  const scheduled = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    scheduled.getFullYear() !== year ||
    scheduled.getMonth() !== month - 1 ||
    scheduled.getDate() !== day ||
    scheduled.getHours() !== hour ||
    scheduled.getMinutes() !== minute
  ) {
    return { ok: false, message: "Choose a real date and time." };
  }

  const at = scheduled.getTime();
  if (at <= now) return { ok: false, message: "Choose a future time." };
  if (at > now + MAX_SCHEDULE_AHEAD_MS) {
    return { ok: false, message: "Pick a time within the next year." };
  }
  return { ok: true, at };
}

export function formatScheduleTime(
  at: number,
  now: number,
  language: ScheduleLanguage = "en",
): string {
  const time = new Date(at).toLocaleTimeString(language, {
    hour: "numeric",
    minute: "2-digit",
  });
  const days = calendarDaysBetween(now, at);
  if (days === 0)
    return language === "ru" ? `сегодня в ${time}` : `today at ${time}`;
  if (days === 1)
    return language === "ru" ? `завтра в ${time}` : `tomorrow at ${time}`;
  if (days === -1)
    return language === "ru" ? `вчера в ${time}` : `yesterday at ${time}`;
  const date = new Date(at).toLocaleDateString(language, {
    month: "short",
    day: "numeric",
    year:
      new Date(at).getFullYear() === new Date(now).getFullYear()
        ? undefined
        : "numeric",
  });
  return language === "ru" ? `${date} в ${time}` : `${date} at ${time}`;
}

export function formatScheduleTimeZone(
  at: number,
  language: ScheduleLanguage = "en",
): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const timeZoneName = new Intl.DateTimeFormat(language, {
    timeZoneName: "short",
  })
    .formatToParts(new Date(at))
    .find((part) => part.type === "timeZoneName")?.value;
  return timeZoneName === undefined || timeZoneName === timeZone
    ? `${scheduleTimeText(language).localTime} · ${timeZone}`
    : `${scheduleTimeText(language).localTime} · ${timeZone} (${timeZoneName})`;
}

function calendarDaysBetween(now: number, at: number): number {
  const startOfNow = new Date(now);
  startOfNow.setHours(0, 0, 0, 0);
  const startOfAt = new Date(at);
  startOfAt.setHours(0, 0, 0, 0);
  return Math.round((startOfAt.getTime() - startOfNow.getTime()) / DAY_MS);
}
