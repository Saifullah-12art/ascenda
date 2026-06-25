"use client";

import { useEffect, useState } from "react";

// The editable fields of a task. `time` is "HH:MM" or "" (empty = no time).
export type TaskFormValues = {
  name: string;
  time: string;
  section: "morning" | "afternoon" | "evening";
};

// Section pills, in display order.
const SECTIONS: { key: TaskFormValues["section"]; label: string }[] = [
  { key: "morning", label: "Morning" },
  { key: "afternoon", label: "Afternoon" },
  { key: "evening", label: "Evening" },
];

const EMPTY: TaskFormValues = { name: "", time: "", section: "morning" };

// Hour options 00–23 and minute options in 5-minute steps. These are fixed
// strings, so the control always reads 24-hour regardless of OS/browser locale.
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0"),
);

// Split a stored "HH:MM" (or "") into [hour, minute] parts for the selects.
function splitTime(value: string): [string, string] {
  if (!value) return ["", ""];
  const [h, m] = value.split(":");
  return [h ?? "", m ?? ""];
}

type Props = {
  open: boolean;
  // Values to pre-fill when editing; null/undefined opens an empty "add" form.
  initial?: TaskFormValues | null;
  onClose: () => void;
  onSave: (values: TaskFormValues) => Promise<void> | void;
  // Only provided when editing — when omitted, the Delete action is hidden.
  onDelete?: () => Promise<void> | void;
};

/**
 * A mobile bottom sheet for adding or editing a task. Slides up from the bottom
 * over a dimmed backdrop. Editing shows a Delete action; adding hides it.
 * Closes on save, on delete, or on tapping the backdrop.
 */
export default function TaskEditSheet({
  open,
  initial,
  onClose,
  onSave,
  onDelete,
}: Props) {
  // Local form state.
  const [name, setName] = useState("");
  // Time is held as separate hour/minute parts; "" on either means "no time".
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [section, setSection] = useState<TaskFormValues["section"]>("morning");
  const [busy, setBusy] = useState(false);

  // `render` keeps the sheet mounted long enough to play its slide-out;
  // `shown` drives the slide-in/out transform.
  const [render, setRender] = useState(false);
  const [shown, setShown] = useState(false);

  // Reset the form to the incoming values each time the sheet opens.
  useEffect(() => {
    if (open) {
      const v = initial ?? EMPTY;
      const [h, m] = splitTime(v.time);
      setName(v.name);
      setHour(h);
      setMinute(m);
      setSection(v.section);
      setBusy(false);
    }
  }, [open, initial]);

  // Mount/unmount with a transition so open and close both animate.
  useEffect(() => {
    if (open) {
      setRender(true);
      // Next frame: flip to the shown position so the transform animates.
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    setShown(false);
    const id = setTimeout(() => setRender(false), 250);
    return () => clearTimeout(id);
  }, [open]);

  if (!render) return null;

  const isEdit = Boolean(onDelete);
  const canSave = name.trim().length > 0 && !busy;

  // 5-minute steps, but keep any off-grid stored minute (e.g. "03") selectable.
  const minuteOptions =
    minute && !MINUTES.includes(minute)
      ? [...MINUTES, minute].sort()
      : MINUTES;

  // Recompose the zero-padded 24-hour "HH:MM" string the rest of the app uses.
  // No hour selected → no time (""). A selected hour with no minute defaults to
  // ":00", matching how on-the-hour times are stored (e.g. "08:00").
  const time = hour ? `${hour}:${minute || "00"}` : "";

  async function handleSave() {
    if (!canSave) return;
    setBusy(true);
    await onSave({ name: name.trim(), time, section });
    // Parent closes the sheet; no need to flip busy back here.
  }

  async function handleDelete() {
    if (!onDelete || busy) return;
    setBusy(true);
    await onDelete();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Dimmed backdrop — tap to close. */}
      <div
        onClick={busy ? undefined : onClose}
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          shown ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* The sheet itself. */}
      <div
        className={`relative w-full max-w-[420px] rounded-t-2xl bg-white px-6 pb-8 pt-3 transition-transform duration-200 ease-out ${
          shown ? "translate-y-0" : "translate-y-full"
        }`}
      >
        {/* Grab handle */}
        <div className="mx-auto mb-5 h-1 w-9 rounded-full bg-gray-200" />

        <h2 className="text-[15px] font-medium text-gray-900">
          {isEdit ? "Edit task" : "Add task"}
        </h2>

        {/* Name */}
        <label className="mt-5 block text-[11px] uppercase tracking-wide text-gray-400">
          Task
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Morning walk"
          autoFocus={!isEdit}
          className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-[14px] text-gray-900 outline-none focus:border-[#534AB7]"
        />

        {/* Time */}
        <label className="mt-4 block text-[11px] uppercase tracking-wide text-gray-400">
          Time
        </label>
        {/*
          Custom 24-hour control: two selects whose options are fixed
          zero-padded strings, so it always displays 00–23 / 00–59 regardless of
          the user's OS/browser locale. Empty hour = no time. handleSave joins
          them back into the same "HH:MM" string the rest of the app stores.
        */}
        <div className="mt-2 flex items-center gap-2">
          <select
            value={hour}
            onChange={(e) => {
              const h = e.target.value;
              setHour(h);
              // Picking an hour fills minutes to "00"; clearing it unsets both.
              if (h && !minute) setMinute("00");
              if (!h) setMinute("");
            }}
            aria-label="Hour"
            className="flex-1 appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none focus:border-[#534AB7]"
          >
            <option value="">--</option>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>

          <span className="text-[14px] font-medium text-gray-400">:</span>

          <select
            value={minute}
            onChange={(e) => setMinute(e.target.value)}
            disabled={!hour}
            aria-label="Minute"
            className="flex-1 appearance-none rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-[14px] text-gray-900 outline-none focus:border-[#534AB7] disabled:opacity-50"
          >
            <option value="">--</option>
            {minuteOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {/* Section pills */}
        <label className="mt-4 block text-[11px] uppercase tracking-wide text-gray-400">
          Section
        </label>
        <div className="mt-2 flex gap-2">
          {SECTIONS.map(({ key, label }) => {
            const selected = section === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSection(key)}
                className={`flex-1 rounded-full py-2.5 text-[13px] font-medium transition-colors ${
                  selected
                    ? "bg-[#534AB7] text-white"
                    : "bg-[#EEEDFE] text-[#534AB7]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Save */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!canSave}
          className="mt-7 w-full rounded-lg bg-[#534AB7] py-3 text-[14px] font-medium text-white transition active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>

        {/* Delete — only when editing. */}
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="mt-3 w-full py-2 text-center text-[13px] font-medium text-[#C0524B] transition active:scale-[0.99] disabled:opacity-50"
          >
            Delete task
          </button>
        )}
      </div>
    </div>
  );
}
