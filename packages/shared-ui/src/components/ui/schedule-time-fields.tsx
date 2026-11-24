import { useId } from "react";

import {
  CUSTOM_SCHEDULE_OPTION_ID,
  MAX_SCHEDULE_AHEAD_MS,
  formatDateInputValue,
  formatScheduleTime,
  formatScheduleTimeZone,
  isScheduleOptionId,
  listSchedulePresets,
  resolveScheduleOption,
  scheduleTimeText,
  scheduleValidationText,
  type ScheduleLanguage,
  type ScheduleTimeError,
  type CustomScheduleFields,
  type ScheduleOptionId,
} from "../../lib/schedule-time";
import { Input } from "./input.js";
import { Label } from "./label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select.js";

interface ScheduleTimeFieldsProps {
  optionId: ScheduleOptionId;
  custom: CustomScheduleFields;
  now: number;
  disabled: boolean;
  error: ScheduleTimeError | string | null;
  language?: ScheduleLanguage;
  onOptionChange: (optionId: ScheduleOptionId) => void;
  onCustomChange: (custom: CustomScheduleFields) => void;
}

export function ScheduleTimeFields({
  optionId,
  custom,
  now,
  disabled,
  error,
  language = "en",
  onOptionChange,
  onCustomChange,
}: ScheduleTimeFieldsProps) {
  const whenId = useId();
  const customDateId = useId();
  const customTimeId = useId();
  const labels = scheduleTimeText(language);
  const presets = listSchedulePresets(now, language);
  const preview = resolveScheduleOption(optionId, custom, now);
  const visibleError =
    error === null
      ? preview.ok
        ? null
        : scheduleValidationText(preview.message, language)
      : typeof error === "string"
        ? error
        : error.kind === "validation"
          ? scheduleValidationText(error.message, language)
          : error.message;

  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={whenId}>{labels.when}</Label>
        <Select
          disabled={disabled}
          onValueChange={(value) => {
            if (isScheduleOptionId(value)) onOptionChange(value);
          }}
          value={optionId}
        >
          <SelectTrigger aria-label={labels.whenToSend} id={whenId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {presets.map((preset) => (
              <SelectItem key={preset.id} value={preset.id}>
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_SCHEDULE_OPTION_ID}>
              {labels.custom}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {optionId === CUSTOM_SCHEDULE_OPTION_ID ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={customDateId}>{labels.date}</Label>
            <Input
              disabled={disabled}
              id={customDateId}
              max={formatDateInputValue(now + MAX_SCHEDULE_AHEAD_MS)}
              min={formatDateInputValue(now)}
              onChange={(event) =>
                onCustomChange({ ...custom, date: event.target.value })
              }
              type="date"
              value={custom.date}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={customTimeId}>{labels.time}</Label>
            <Input
              disabled={disabled}
              id={customTimeId}
              onChange={(event) =>
                onCustomChange({ ...custom, time: event.target.value })
              }
              type="time"
              value={custom.time}
            />
          </div>
        </div>
      ) : null}

      {preview.ok ? (
        <div aria-live="polite" className="rounded-md bg-muted/50 px-3 py-2">
          <p className="font-medium">
            {labels.sends} {formatScheduleTime(preview.at, now, language)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatScheduleTimeZone(preview.at, language)}
          </p>
        </div>
      ) : null}

      {visibleError === null ? null : (
        <p className="text-destructive" role="alert">
          {visibleError}
        </p>
      )}
    </>
  );
}
