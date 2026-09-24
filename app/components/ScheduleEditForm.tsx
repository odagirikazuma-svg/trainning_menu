"use client";

import { useState } from "react";
import { createClient } from "../lib/supabase/client";
import {
  DayType,
  Location,
  locationLabel,
  locations,
  SessionType,
} from "../lib/types";

// TeamPage.tsx（コーチ向け「/team」ページ）の練習セクション登録・編集フォームを、
// マット掲示板（TrainingBoardSupabase.tsx）からも使えるように切り出した共通コンポーネント。
// ・単日編集（mode="single"）: 1日分の区分（オフ・練習・合宿・試合・出稽古）とセッションを設定する
// ・期間一括編集（mode="range"）: 期間中の全日に同じ区分・セッションをまとめて設定する
//   （オフ・合宿・試合・出稽古のみ。通常の「練習」は期間一括では扱わない＝TeamPage.tsxの仕様を踏襲）
// 保存ロジック（schedule_days / schedule_sessions への保存、「両拠点に反映する」の伝播処理）は
// 元のTeamPage.tsxのsaveScheduleForDate / propagateDayType / propagateJointSessionをそのまま移植している。

export type SessionDraft = {
  type: SessionType;
  time: string;
  isFlexibleTime: boolean;
  isJoint: boolean;
  jointLocation: Location;
  locationNote: string;
};

// TeamPage.tsxのScheduleDayRow・TrainingBoardSupabase.tsxのviewDateScheduleの
// どちらからも渡せるよう、必要最小限のフィールドだけを要求する（idは不要）。
export type ScheduleDayPrefill = {
  is_off: boolean;
  day_type: DayType;
  event_name: string | null;
  sessions: {
    session_type: SessionType;
    start_time: string | null;
    is_joint: boolean;
    joint_location: Location | null;
    location_note: string | null;
  }[];
};

export type ScheduleEditFormMode = "single" | "range";
export type ScheduleCategory = "off" | DayType;

export type ScheduleEditFormProps = {
  teamId: string;
  authorId: string;
  // 編集対象の拠点（TeamPageのscheduleLocation・掲示板のactiveLocationに相当）
  location: Location;
  mode: ScheduleEditFormMode;
  // trueの場合、フォーム内に「単日／期間」の切り替えを表示する（掲示板側で使用）。
  // falseの場合は呼び出し側が渡したmode固定で、TeamPage.tsxの既存の2つの入口
  // （単日編集ポップアップ／期間一括パネル）とまったく同じ挙動になる。
  allowModeToggle?: boolean;
  // 単日モードの対象日（期間モードでは開始日の初期値としても使う）
  date: string;
  // 単日モードでの初期値。undefined=まだ読み込み中、null=その日の予定なし
  existingDay?: ScheduleDayPrefill | null;
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
};

// "YYYY-MM-DD" -> "7月24日"
function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${Number(m)}月${Number(d)}日`;
}

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultSessions(location: Location): SessionDraft[] {
  return [
    {
      type: "mat",
      time: "10:00",
      isFlexibleTime: false,
      isJoint: false,
      jointLocation: location,
      locationNote: "",
    },
  ];
}

function sessionsFromExisting(
  existingDay: ScheduleDayPrefill,
  location: Location
): SessionDraft[] {
  if (existingDay.sessions.length === 0) return defaultSessions(location);
  return existingDay.sessions.map((s) => ({
    type: s.session_type,
    time: s.start_time ? s.start_time.slice(0, 5) : "",
    isFlexibleTime: !s.start_time,
    isJoint: s.is_joint,
    jointLocation: s.joint_location ?? location,
    locationNote: s.location_note ?? "",
  }));
}

export default function ScheduleEditForm({
  teamId,
  authorId,
  location,
  mode: initialMode,
  allowModeToggle = false,
  date,
  existingDay = null,
  onCancel,
  onSaved,
}: ScheduleEditFormProps) {
  const supabase = createClient();

  const [mode, setMode] = useState<ScheduleEditFormMode>(initialMode);

  // ---- 単日モード用の状態 ----
  const singleInitialCategory: ScheduleCategory = existingDay?.is_off
    ? "off"
    : (existingDay?.day_type ?? "practice");

  const [category, setCategory] = useState<ScheduleCategory>(
    initialMode === "single" ? singleInitialCategory : "off"
  );
  const [eventName, setEventName] = useState(existingDay?.event_name ?? "");
  const [offBothLocations, setOffBothLocations] = useState(false);
  const [shareBothLocations, setShareBothLocations] = useState(true);
  const [includeSessions, setIncludeSessions] = useState(
    initialMode === "single"
      ? singleInitialCategory === "practice" ||
          (existingDay?.sessions.length ?? 0) > 0
      : false
  );
  const [sessions, setSessions] = useState<SessionDraft[]>(
    initialMode === "single" && existingDay
      ? sessionsFromExisting(existingDay, location)
      : defaultSessions(location)
  );

  // ---- 期間モード用の状態 ----
  const [rangeStartDate, setRangeStartDate] = useState(date);
  const [rangeEndDate, setRangeEndDate] = useState(date);

  // ---- 単日モード「他の日にもコピー」機能 ----
  const [showCopyToDates, setShowCopyToDates] = useState(false);
  const [copyTargetDates, setCopyTargetDates] = useState<string[]>([]);
  const [copyDateInput, setCopyDateInput] = useState("");
  const [savingCopyToDates, setSavingCopyToDates] = useState(false);

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rangeResult, setRangeResult] = useState<string | null>(null);

  function handleModeChange(next: ScheduleEditFormMode) {
    setMode(next);
    setErrorMsg(null);
    setRangeResult(null);
    if (next === "single") {
      setCategory(singleInitialCategory);
      setEventName(existingDay?.event_name ?? "");
      setIncludeSessions(
        singleInitialCategory === "practice" ||
          (existingDay?.sessions.length ?? 0) > 0
      );
      setSessions(
        existingDay
          ? sessionsFromExisting(existingDay, location)
          : defaultSessions(location)
      );
    } else {
      setCategory("off");
      setEventName("");
      setIncludeSessions(false);
      setSessions(defaultSessions(location));
      setRangeStartDate(date);
      setRangeEndDate(date);
    }
    setOffBothLocations(false);
    setShareBothLocations(true);
  }

  function updateSession(idx: number, patch: Partial<SessionDraft>) {
    setSessions((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s))
    );
  }

  function addSession() {
    setSessions((prev) =>
      prev.length >= 2
        ? prev
        : [
            ...prev,
            {
              type: "weight",
              time: "17:00",
              isFlexibleTime: false,
              isJoint: false,
              jointLocation: location,
              locationNote: "",
            },
          ]
    );
  }

  function removeSession(idx: number) {
    setSessions((prev) =>
      mode === "single"
        ? prev.filter((_, i) => i !== idx)
        : prev.length <= 1
          ? prev
          : prev.filter((_, i) => i !== idx)
    );
  }

  // 1日分の時間割を保存する共通処理（元TeamPage.tsxのsaveScheduleForDateを移植）
  async function saveScheduleForDate(
    dateStr: string,
    cat: ScheduleCategory,
    sessionDrafts: SessionDraft[],
    includeSessionsFlag: boolean,
    eventNameValue: string,
    offBoth: boolean,
    shareBoth: boolean
  ): Promise<string | null> {
    const isOff = cat === "off";
    const dayType: DayType = isOff ? "practice" : (cat as DayType);
    const includeSessionsResolved = isOff
      ? false
      : dayType === "practice"
        ? true
        : includeSessionsFlag;
    const isAwayLike = dayType === "camp" || dayType === "away";
    const trimmedEventName =
      dayType === "camp" || dayType === "match" || dayType === "away"
        ? eventNameValue.trim() || null
        : null;

    const { data: dayRow, error: dayError } = await supabase
      .from("schedule_days")
      .upsert(
        {
          team_id: teamId,
          location,
          date: dateStr,
          is_off: isOff,
          day_type: dayType,
          event_name: trimmedEventName,
          created_by: authorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_id,location,date" }
      )
      .select("id")
      .single();

    if (dayError || !dayRow) {
      return dayError?.message ?? "時間割の保存に失敗しました。";
    }

    const dayId = (dayRow as { id: string }).id;

    const { error: delError } = await supabase
      .from("schedule_sessions")
      .delete()
      .eq("schedule_day_id", dayId);

    if (delError) return delError.message;

    if (!isOff && includeSessionsResolved && sessionDrafts.length > 0) {
      const rows = sessionDrafts.map((s, idx) => {
        // 合宿・出稽古は「両拠点に反映する」がオンの時だけ全体練習として扱う
        const isJoint = isAwayLike ? shareBoth : s.isJoint;
        return {
          schedule_day_id: dayId,
          session_no: idx + 1,
          session_type: s.type,
          start_time: s.isFlexibleTime ? null : s.time,
          is_joint: isJoint,
          joint_location: isJoint ? s.jointLocation : null,
          location_note: isAwayLike ? s.locationNote.trim() || null : null,
        };
      });
      const { error: insError } = await supabase
        .from("schedule_sessions")
        .insert(rows);
      if (insError) return insError.message;

      if (
        !(
          (dayType === "camp" || dayType === "match" || dayType === "away") &&
          !shareBoth
        )
      ) {
        for (const s of sessionDrafts) {
          const isJoint = isAwayLike ? shareBoth : s.isJoint;
          if (isJoint) {
            const propagateError = await propagateJointSession(dateStr, s.jointLocation, {
              type: s.type,
              time: s.time,
              isFlexibleTime: s.isFlexibleTime,
              locationNote: isAwayLike ? s.locationNote.trim() || null : null,
            });
            if (propagateError) return propagateError;
          }
        }
      }
    }

    if (
      !isOff &&
      (dayType === "camp" || dayType === "match" || dayType === "away") &&
      shareBoth
    ) {
      await propagateDayType(dateStr, dayType, trimmedEventName);
    }

    if (isOff && offBoth) {
      const otherLocation: Location = location === "tama" ? "otsuka" : "tama";
      const { data: otherDay } = await supabase
        .from("schedule_days")
        .upsert(
          {
            team_id: teamId,
            location: otherLocation,
            date: dateStr,
            is_off: true,
            day_type: "practice",
            event_name: null,
            created_by: authorId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "team_id,location,date" }
        )
        .select("id")
        .single();
      if (otherDay) {
        await supabase
          .from("schedule_sessions")
          .delete()
          .eq("schedule_day_id", (otherDay as { id: string }).id);
      }
    }

    return null;
  }

  async function propagateDayType(
    dateStr: string,
    dayType: DayType,
    eventNameValue: string | null
  ) {
    const otherLocation: Location = location === "tama" ? "otsuka" : "tama";

    await supabase.from("schedule_days").upsert(
      {
        team_id: teamId,
        location: otherLocation,
        date: dateStr,
        is_off: false,
        day_type: dayType,
        event_name: eventNameValue,
        created_by: authorId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "team_id,location,date", ignoreDuplicates: false }
    );
  }

  // 全体練習のセッションを、もう一方の拠点のカレンダーにも自動で反映する
  // （既に同じ内容の通知セッションがあれば時刻だけ更新し、無ければ空いている
  //   セッション枠に追加する。すでに2セッション埋まっている場合は反映できない）
  async function propagateJointSession(
    dateStr: string,
    hostLocation: Location,
    session: {
      type: SessionType;
      time: string;
      isFlexibleTime?: boolean;
      locationNote?: string | null;
    }
  ): Promise<string | null> {
    const otherLocation: Location = location === "tama" ? "otsuka" : "tama";
    const newStartTime = session.isFlexibleTime ? null : session.time;

    const { data: existingDayRow } = await supabase
      .from("schedule_days")
      .select(
        "id, sessions:schedule_sessions(id, session_no, session_type, start_time, is_joint, joint_location, location_note)"
      )
      .eq("team_id", teamId)
      .eq("location", otherLocation)
      .eq("date", dateStr)
      .maybeSingle();

    const { data: dayRow, error: dayError } = await supabase
      .from("schedule_days")
      .upsert(
        {
          team_id: teamId,
          location: otherLocation,
          date: dateStr,
          is_off: false,
          created_by: authorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "team_id,location,date" }
      )
      .select("id")
      .single();

    if (dayError || !dayRow) {
      return (
        dayError?.message ?? `${locationLabel[otherLocation]}の予定作成に失敗しました。`
      );
    }

    const dayId = (dayRow as { id: string }).id;
    type ExistingSession = {
      id: string;
      session_no: number;
      session_type: SessionType;
      start_time: string | null;
      is_joint: boolean;
      joint_location: Location | null;
      location_note: string | null;
    };
    const existingSessions =
      ((existingDayRow as unknown as { sessions: ExistingSession[] } | null)
        ?.sessions ?? []);

    // 既に同じ種別のセッションがあれば、joint化された内容に上書きする
    // （相手拠点が独自にそのセッションを組んでいた場合も、こちらの内容を優先する）
    const existingSameType = existingSessions.find(
      (s) => s.session_type === session.type
    );

    if (existingSameType) {
      const needsUpdate =
        !existingSameType.is_joint ||
        existingSameType.joint_location !== hostLocation ||
        (existingSameType.start_time
          ? existingSameType.start_time.slice(0, 5)
          : "") !== (newStartTime ?? "") ||
        existingSameType.location_note !== (session.locationNote ?? null);
      if (needsUpdate) {
        await supabase
          .from("schedule_sessions")
          .update({
            start_time: newStartTime,
            is_joint: true,
            joint_location: hostLocation,
            location_note: session.locationNote ?? null,
          })
          .eq("id", existingSameType.id);
      }
      return null;
    }

    const usedNos = new Set(existingSessions.map((s) => s.session_no));
    const sessionNo = !usedNos.has(1) ? 1 : !usedNos.has(2) ? 2 : null;
    if (sessionNo === null) {
      return `${locationLabel[otherLocation]}は既に2セッション分の予定が入っているため、全体練習として反映できませんでした。`;
    }

    await supabase.from("schedule_sessions").insert({
      schedule_day_id: dayId,
      session_no: sessionNo,
      session_type: session.type,
      start_time: newStartTime,
      is_joint: true,
      joint_location: hostLocation,
      location_note: session.locationNote ?? null,
    });
    return null;
  }

  async function handleSaveSingle() {
    setSaving(true);
    setErrorMsg(null);
    const errorMessage = await saveScheduleForDate(
      date,
      category,
      sessions,
      includeSessions,
      eventName,
      offBothLocations,
      shareBothLocations
    );
    setSaving(false);
    if (errorMessage) {
      setErrorMsg(errorMessage);
      return;
    }
    await onSaved();
  }

  async function handleSaveRange() {
    if (!rangeStartDate || !rangeEndDate) return;
    if (rangeEndDate < rangeStartDate) {
      setErrorMsg("終了日は開始日より後の日付にしてください。");
      return;
    }

    setSaving(true);
    setErrorMsg(null);
    setRangeResult(null);

    const dates: string[] = [];
    const cursorDate = new Date(
      Number(rangeStartDate.slice(0, 4)),
      Number(rangeStartDate.slice(5, 7)) - 1,
      Number(rangeStartDate.slice(8, 10))
    );
    const endDateObj = new Date(
      Number(rangeEndDate.slice(0, 4)),
      Number(rangeEndDate.slice(5, 7)) - 1,
      Number(rangeEndDate.slice(8, 10))
    );
    while (cursorDate <= endDateObj) {
      dates.push(toDateKey(cursorDate));
      cursorDate.setDate(cursorDate.getDate() + 1);
    }

    let failCount = 0;
    for (const d of dates) {
      const errorMessage = await saveScheduleForDate(
        d,
        category,
        sessions,
        includeSessions,
        eventName,
        offBothLocations,
        shareBothLocations
      );
      if (errorMessage) failCount++;
    }

    setSaving(false);
    if (failCount > 0) {
      setRangeResult(
        `${dates.length}日中${dates.length - failCount}日を設定しました（${failCount}日は失敗しました）。`
      );
    } else {
      setRangeResult(`${dates.length}日分をまとめて設定しました。`);
    }
    await onSaved();
  }

  function handleAddCopyDate() {
    if (!copyDateInput) return;
    if (copyDateInput === date) {
      setCopyDateInput("");
      return;
    }
    setCopyTargetDates((prev) =>
      prev.includes(copyDateInput) ? prev : [...prev, copyDateInput].sort()
    );
    setCopyDateInput("");
  }

  function handleRemoveCopyDate(dateStr: string) {
    setCopyTargetDates((prev) => prev.filter((d) => d !== dateStr));
  }

  async function handleCopyScheduleToDates() {
    if (copyTargetDates.length === 0) {
      setErrorMsg("コピー先の日付を1つ以上追加してください。");
      return;
    }

    setSavingCopyToDates(true);
    setErrorMsg(null);

    for (const dateStr of copyTargetDates) {
      const errorMessage = await saveScheduleForDate(
        dateStr,
        category,
        sessions,
        includeSessions,
        eventName,
        offBothLocations,
        shareBothLocations
      );
      if (errorMessage) {
        setErrorMsg(`${formatMonthDay(dateStr)}の保存に失敗しました: ${errorMessage}`);
        setSavingCopyToDates(false);
        return;
      }
    }

    setShowCopyToDates(false);
    setCopyTargetDates([]);
    setCopyDateInput("");
    setSavingCopyToDates(false);
  }

  const showSessionsEditor =
    mode === "single"
      ? category !== "off" && (category === "practice" || includeSessions)
      : category !== "off" && includeSessions;

  return (
    <div className="flex flex-col gap-3">
      {allowModeToggle && (
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-neutral-800 p-1 text-xs">
          {(
            [
              { v: "single", label: "単日で設定" },
              { v: "range", label: "期間でまとめて設定" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => handleModeChange(opt.v)}
              className={`rounded-md py-2 font-medium ${
                mode === opt.v
                  ? "bg-red-600 text-white shadow"
                  : "text-neutral-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {mode === "range" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col text-[length:calc(11px+var(--fs-add))] text-neutral-400">
            開始日
            <input
              type="date"
              value={rangeStartDate}
              onChange={(e) => setRangeStartDate(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
            />
          </label>
          <label className="flex flex-col text-[length:calc(11px+var(--fs-add))] text-neutral-400">
            終了日
            <input
              type="date"
              value={rangeEndDate}
              onChange={(e) => setRangeEndDate(e.target.value)}
              className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
            />
          </label>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-400">区分</span>
        <div
          className={`grid gap-1 rounded-lg bg-neutral-800 p-1 text-[length:calc(11px+var(--fs-add))] ${
            mode === "single" ? "grid-cols-3" : "grid-cols-4"
          }`}
        >
          {(
            mode === "single"
              ? ([
                  { v: "off", label: "オフ" },
                  { v: "practice", label: "練習" },
                  { v: "camp", label: "合宿" },
                  { v: "match", label: "試合" },
                  { v: "away", label: "出稽古" },
                ] as const)
              : ([
                  { v: "off", label: "オフ" },
                  { v: "camp", label: "合宿" },
                  { v: "match", label: "試合" },
                  { v: "away", label: "出稽古" },
                ] as const)
          ).map((opt) => (
            <button
              key={opt.v}
              type="button"
              onClick={() => setCategory(opt.v)}
              className={`rounded-md py-2 font-medium ${
                category === opt.v
                  ? "bg-red-600 text-white shadow"
                  : "text-neutral-400"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {category === "off" && (
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={offBothLocations}
            onChange={(e) => setOffBothLocations(e.target.checked)}
          />
          両拠点ともオフにする
        </label>
      )}

      {(category === "camp" || category === "match" || category === "away") && (
        <input
          type="text"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          placeholder={
            category === "camp"
              ? "合宿名（例：夏合宿・山梨合宿）"
              : category === "away"
                ? "出稽古先（例：◯◯大学、◯◯高校）"
                : "試合名（例：インカレ・県大会）"
          }
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
        />
      )}

      {(category === "camp" || category === "match" || category === "away") && (
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={shareBothLocations}
            onChange={(e) => setShareBothLocations(e.target.checked)}
          />
          両拠点に反映する（チームで一緒に行く場合）
        </label>
      )}

      {(category === "camp" || category === "match" || category === "away") && (
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input
            type="checkbox"
            checked={includeSessions}
            onChange={(e) => setIncludeSessions(e.target.checked)}
          />
          {mode === "single"
            ? "この日も練習セクションを設定する"
            : "期間中すべての日に同じ練習セクションも設定する"}
        </label>
      )}

      {showSessionsEditor && (
        <div className="flex flex-col gap-3">
          {sessions.map((s, idx) => (
            <div
              key={idx}
              className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-2.5"
            >
              <div className="flex items-center justify-between">
                <span className="text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-400">
                  第{idx + 1}セッション
                </span>
                {(mode === "range" ? sessions.length > 1 : true) && (
                  <button
                    onClick={() => removeSession(idx)}
                    className="text-[length:calc(11px+var(--fs-add))] text-red-500"
                  >
                    削除
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={s.type}
                  onChange={(e) =>
                    updateSession(idx, {
                      type: e.target.value as SessionType,
                      isFlexibleTime:
                        mode === "single"
                          ? e.target.value === "mat"
                            ? false
                            : s.isFlexibleTime
                          : s.isFlexibleTime,
                    })
                  }
                  className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                >
                  <option value="mat">マット</option>
                  <option value="running">ラン</option>
                  <option value="weight">ウェイト</option>
                </select>
                {mode === "single" && s.isFlexibleTime ? (
                  <div className="flex items-center rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-500">
                    時間は各自
                  </div>
                ) : (
                  <ScheduleTimeSelect
                    value={s.time}
                    onChange={(v) => updateSession(idx, { time: v })}
                  />
                )}
              </div>
              {mode === "single" && s.type !== "mat" && (
                <label className="flex items-center gap-2 text-[length:calc(11px+var(--fs-add))] text-neutral-400">
                  <input
                    type="checkbox"
                    checked={s.isFlexibleTime}
                    onChange={(e) =>
                      updateSession(idx, { isFlexibleTime: e.target.checked })
                    }
                  />
                  時間は固定せず「各自」にする（部員がそれぞれ記録時に入力）
                </label>
              )}
              {category === "camp" || category === "away" ? (
                <label className="flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-400">
                  練習場所（任意）
                  <input
                    type="text"
                    value={s.locationNote}
                    onChange={(e) =>
                      updateSession(idx, { locationNote: e.target.value })
                    }
                    placeholder="例：山梨県立武道館、◯◯大学 など"
                    className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                  />
                </label>
              ) : mode === "single" ? (
                <>
                  <label className="flex items-center gap-2 text-[length:calc(11px+var(--fs-add))] text-neutral-400">
                    <input
                      type="checkbox"
                      checked={s.isJoint}
                      onChange={(e) =>
                        updateSession(idx, { isJoint: e.target.checked })
                      }
                    />
                    全体練習（合同）にする
                  </label>
                  {s.isJoint && (
                    <select
                      value={s.jointLocation}
                      onChange={(e) =>
                        updateSession(idx, {
                          jointLocation: e.target.value as Location,
                        })
                      }
                      className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                    >
                      {locations.map((loc) => (
                        <option key={loc} value={loc}>
                          {locationLabel[loc]}で実施
                        </option>
                      ))}
                    </select>
                  )}
                </>
              ) : null}
            </div>
          ))}
          {sessions.length < 2 && (
            <button
              onClick={addSession}
              className="self-start text-xs font-medium text-neutral-300"
            >
              ＋ セッションを追加
            </button>
          )}
        </div>
      )}

      {mode === "single" && (
        <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-2">
          <button
            onClick={() => setShowCopyToDates((v) => !v)}
            className="self-start text-xs font-medium text-neutral-300 underline"
          >
            {showCopyToDates ? "他の日へのコピーを閉じる" : "この内容を他の日にもコピーする"}
          </button>
          {showCopyToDates && (
            <div className="flex flex-col gap-2">
              <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
                下でコピー先の日付を1つずつ追加し、今設定している内容(区分・セッション)をまとめてコピーします。保存する前に、まずこちらを実行してください。
              </p>
              {copyTargetDates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {copyTargetDates.map((d) => (
                    <button
                      key={d}
                      onClick={() => handleRemoveCopyDate(d)}
                      className="flex items-center gap-1 rounded bg-red-950/40 px-2 py-1 text-xs text-red-400"
                    >
                      {formatMonthDay(d)}
                      <span className="text-red-500">✕</span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={copyDateInput}
                  onChange={(e) => setCopyDateInput(e.target.value)}
                  className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                />
                <button
                  onClick={handleAddCopyDate}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                >
                  日付を追加
                </button>
              </div>
              <button
                onClick={handleCopyScheduleToDates}
                disabled={savingCopyToDates}
                className="self-start rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
              >
                {savingCopyToDates
                  ? "コピー中…"
                  : `選んだ${copyTargetDates.length}日にコピーする`}
              </button>
            </div>
          )}
        </div>
      )}

      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-[length:calc(11px+var(--fs-add))] text-red-400">{errorMsg}</p>
      )}
      {rangeResult && (
        <p className="rounded bg-emerald-950/40 p-2 text-[length:calc(11px+var(--fs-add))] text-emerald-400">
          {rangeResult}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={mode === "single" ? handleSaveSingle : handleSaveRange}
          disabled={saving}
          className="flex-1 rounded-lg bg-red-600 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          {saving
            ? "保存中…"
            : mode === "single"
              ? "保存する"
              : "この内容でまとめて設定する"}
        </button>
        <button
          onClick={onCancel}
          className="flex-1 rounded-lg border border-neutral-700 py-2 text-xs text-neutral-300"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

export function ScheduleTimeSelect({
  value,
  onChange,
}: {
  value: string; // "HH:MM"
  onChange: (value: string) => void;
}) {
  const [hour, minute] = value ? value.split(":") : ["10", "00"];
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutes = ["00", "10", "20", "30", "40", "50"];

  return (
    <div className="flex gap-1">
      <select
        value={hour}
        onChange={(e) => onChange(`${e.target.value}:${minute || "00"}`)}
        className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1.5 text-xs text-neutral-100"
      >
        {hours.map((h) => (
          <option key={h} value={h}>
            {h}時
          </option>
        ))}
      </select>
      <select
        value={minute}
        onChange={(e) => onChange(`${hour || "10"}:${e.target.value}`)}
        className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1.5 text-xs text-neutral-100"
      >
        {minutes.map((m) => (
          <option key={m} value={m}>
            {m}分
          </option>
        ))}
      </select>
    </div>
  );
}
