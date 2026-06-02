"use client";

import { useMemo, useState } from "react";

import { Bi } from "@/components/almanac/Bi";
import { Glyph } from "@/components/almanac/Glyph";
import { Micro } from "@/components/almanac/Micro";
import { extractError } from "@/lib/extract-error";
import { supabaseBrowser } from "@/lib/supabase-browser";

export type MeetingTemplate = {
  id: string;
  project_id: string;
  type: string;
  name: string;
  cadence: string;
  day_of_week: number | null;
  time_of_day: string;
  timezone: string;
  default_attendees: string[];
  active: boolean;
  last_spawned_at: string | null;
  created_at: string;
  created_by: string | null;
};

type Teammate = { id: string; name: string | null; email: string };

type TemplateType = "biweekly_planning" | "weekly_retro" | "daily_ops" | "ad_hoc";
type Cadence = "daily" | "weekly" | "biweekly";

const TEMPLATE_TYPES: { value: TemplateType; cn: string; en: string }[] = [
  { value: "biweekly_planning", cn: "双周规划", en: "Biweekly Planning" },
  { value: "weekly_retro", cn: "周回顾", en: "Weekly Retro" },
  { value: "daily_ops", cn: "每日同步", en: "Daily Ops" },
  { value: "ad_hoc", cn: "临时", en: "Ad-hoc" },
];

const CADENCES: { value: Cadence; cn: string; en: string }[] = [
  { value: "daily", cn: "每天", en: "Daily" },
  { value: "weekly", cn: "每周", en: "Weekly" },
  { value: "biweekly", cn: "每两周", en: "Biweekly" },
];

const DAYS_OF_WEEK: { value: number; cn: string; en: string }[] = [
  { value: 0, cn: "周日", en: "Sunday" },
  { value: 1, cn: "周一", en: "Monday" },
  { value: 2, cn: "周二", en: "Tuesday" },
  { value: 3, cn: "周三", en: "Wednesday" },
  { value: 4, cn: "周四", en: "Thursday" },
  { value: 5, cn: "周五", en: "Friday" },
  { value: 6, cn: "周六", en: "Saturday" },
];

const COMMON_TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/New_York",
  "Asia/Shanghai",
  "Europe/Berlin",
];

type Props = {
  projectId: string;
  existing?: MeetingTemplate;
  workspaceUsers: Teammate[];
  onClose: () => void;
  onSaved: () => void;
};

export function TemplateEditor({
  projectId,
  existing,
  workspaceUsers,
  onClose,
  onSaved,
}: Props) {
  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  const [name, setName] = useState(existing?.name ?? "");
  const [type, setType] = useState<TemplateType>(
    (existing?.type as TemplateType) ?? "weekly_retro",
  );
  const [cadence, setCadence] = useState<Cadence>(
    (existing?.cadence as Cadence) ?? "weekly",
  );
  const [dayOfWeek, setDayOfWeek] = useState<number | null>(
    existing?.day_of_week ?? (existing ? null : 5),
  );
  const [timeOfDay, setTimeOfDay] = useState<string>(
    existing?.time_of_day ? existing.time_of_day.slice(0, 5) : "10:00",
  );
  const [timezone, setTimezone] = useState<string>(
    existing?.timezone ?? browserTz,
  );
  const [attendees, setAttendees] = useState<string[]>(
    existing?.default_attendees ?? [],
  );
  const [active, setActive] = useState<boolean>(existing?.active ?? true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = Boolean(existing);
  const dayRequired = cadence !== "daily";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Name is required / 必须填写名称");
      return;
    }
    if (!timeOfDay) {
      setError("Time of day is required / 必须填写时间");
      return;
    }
    if (dayRequired && (dayOfWeek === null || dayOfWeek === undefined)) {
      setError(
        "Day of week is required for weekly/biweekly cadences / 每周/双周需选择星期",
      );
      return;
    }

    setSubmitting(true);
    try {
      const supabase = supabaseBrowser();
      // Pad seconds for postgres `time` column.
      const timePayload = timeOfDay.length === 5 ? `${timeOfDay}:00` : timeOfDay;
      const payload = {
        project_id: projectId,
        name: name.trim(),
        type,
        cadence,
        day_of_week: cadence === "daily" ? null : dayOfWeek,
        time_of_day: timePayload,
        timezone: timezone.trim() || "UTC",
        default_attendees: attendees,
        active,
      };

      if (isEdit && existing) {
        const { error: updateError } = await supabase
          .from("meeting_templates")
          .update(payload)
          .eq("id", existing.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("meeting_templates")
          .insert(payload);
        if (insertError) throw insertError;
      }

      onSaved();
      onClose();
    } catch (err) {
      console.error("Save template failed:", err);
      setError(extractError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="almanac fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Meeting template editor"
    >
      <div
        className="flex max-h-[90vh] w-full max-w-xl flex-col border border-rule-ink bg-paper"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-rule px-6 py-4">
          <div className="min-w-0 flex-1">
            <Micro style={{ marginBottom: 4 }}>
              <Bi
                cn="周期会议模板"
                en="Recurring template"
                glossSize={0.78}
              />
            </Micro>
            <h2 className="font-sc text-xl font-medium leading-tight text-ink">
              {isEdit ? (
                <Bi cn="编辑模板" en="Edit template" glossSize={0.78} />
              ) : (
                <Bi cn="新建模板" en="New template" glossSize={0.78} />
              )}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 transition hover:text-ink"
          >
            <Glyph name="cross" size={16} />
          </button>
        </header>

        {error && (
          <div className="border-b border-rust-soft bg-rust-soft/40 px-6 py-3 text-sm text-rust-ink">
            {error}
          </div>
        )}

        {/* Body */}
        <form
          id="meeting-template-form"
          onSubmit={onSubmit}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-5"
        >
          {/* Name */}
          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="名称" en="Name" glossSize={0.78} />
              <span className="ml-1 text-rust-ink">*</span>
            </Micro>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="e.g. Weekly Retro / 周回顾"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
          </label>

          {/* Type */}
          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="类型" en="Type" glossSize={0.78} />
            </Micro>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as TemplateType)}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            >
              {TEMPLATE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.cn} / {t.en}
                </option>
              ))}
            </select>
          </label>

          {/* Cadence */}
          <div>
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="频率" en="Cadence" glossSize={0.78} />
            </Micro>
            <div className="flex flex-wrap gap-2">
              {CADENCES.map((c) => {
                const isActive = cadence === c.value;
                return (
                  <label
                    key={c.value}
                    className={`flex cursor-pointer items-center gap-2 border px-3 py-1.5 text-sm transition ${
                      isActive
                        ? "border-clay bg-clay-soft text-clay-ink"
                        : "border-rule bg-paper text-ink-2 hover:bg-paper-3"
                    }`}
                  >
                    <input
                      type="radio"
                      name="cadence"
                      value={c.value}
                      checked={isActive}
                      onChange={() => {
                        setCadence(c.value);
                        if (c.value === "daily") {
                          setDayOfWeek(null);
                        } else if (dayOfWeek === null) {
                          setDayOfWeek(5);
                        }
                      }}
                      className="sr-only"
                    />
                    <Bi cn={c.cn} en={c.en} glossSize={0.78} />
                  </label>
                );
              })}
            </div>
          </div>

          {/* Day of week */}
          <label className="block">
            <Micro
              style={{ marginBottom: 6 }}
              color={dayRequired ? undefined : "var(--ink-4)"}
            >
              <Bi cn="星期" en="Day of week" glossSize={0.78} />
              {dayRequired && <span className="ml-1 text-rust-ink">*</span>}
            </Micro>
            <select
              value={dayOfWeek === null ? "" : String(dayOfWeek)}
              onChange={(e) =>
                setDayOfWeek(e.target.value === "" ? null : Number(e.target.value))
              }
              disabled={!dayRequired}
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink disabled:bg-paper-3 disabled:text-ink-4"
            >
              <option value="">— Select / 选择 —</option>
              {DAYS_OF_WEEK.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.cn} / {d.en}
                </option>
              ))}
            </select>
          </label>

          {/* Time of day */}
          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="时间" en="Time of day" glossSize={0.78} />
              <span className="ml-1 text-rust-ink">*</span>
            </Micro>
            <input
              type="time"
              value={timeOfDay}
              onChange={(e) => setTimeOfDay(e.target.value)}
              required
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
          </label>

          {/* Timezone */}
          <label className="block">
            <Micro style={{ marginBottom: 6 }}>
              <Bi cn="时区" en="Timezone" glossSize={0.78} />
            </Micro>
            <input
              type="text"
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              list="tz-options"
              placeholder="e.g. America/Los_Angeles"
              className="w-full border border-rule bg-paper px-3 py-2 text-sm text-ink outline-none transition focus:border-ink"
            />
            <datalist id="tz-options">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </label>

          {/* Default attendees */}
          <div>
            <Micro style={{ marginBottom: 6 }}>
              <Bi
                cn="默认参会人"
                en="Default attendees"
                glossSize={0.78}
              />
            </Micro>
            <div className="max-h-40 space-y-1 overflow-y-auto border border-rule bg-paper p-2 text-sm text-ink-2">
              {workspaceUsers.length === 0 && (
                <p className="text-ink-3">
                  <Bi
                    cn="暂无成员"
                    en="No users yet"
                    glossSize={0.78}
                  />
                </p>
              )}
              {workspaceUsers.map((u) => (
                <label key={u.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={attendees.includes(u.id)}
                    onChange={(e) =>
                      setAttendees((prev) =>
                        e.target.checked
                          ? [...prev, u.id]
                          : prev.filter((id) => id !== u.id),
                      )
                    }
                  />
                  <span>{u.name || u.email}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Active */}
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            <Bi cn="启用" en="Active" glossSize={0.78} />
          </label>
        </form>

        {/* Footer */}
        <footer className="flex items-center justify-end gap-2 border-t border-rule px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="border border-rule bg-paper px-4 py-2 text-sm text-ink-2 transition hover:bg-paper-3 hover:text-ink"
          >
            <Bi cn="取消" en="Cancel" glossSize={0.78} />
          </button>
          <button
            type="submit"
            form="meeting-template-form"
            disabled={submitting}
            className="bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:bg-clay-deep disabled:opacity-40"
          >
            {submitting ? (
              <Bi cn="保存中…" en="Saving…" glossSize={0.78} />
            ) : isEdit ? (
              <Bi cn="保存" en="Save" glossSize={0.78} />
            ) : (
              <Bi cn="创建" en="Create" glossSize={0.78} />
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
