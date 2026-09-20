"use client";

import { useEffect, useRef, useState } from "react";
import { useProfile } from "../../components/shell/AppShell";
import { useTheme, type ThemePref } from "../../components/shell/ThemeProvider";
import {
  useCalendarViewPref,
  type CalendarViewPref,
} from "../../components/shell/CalendarViewPrefProvider";
import {
  useCalendarDisplayPref,
  calendarSlotOptions,
  calendarSlotOptionLabel,
  type CalendarSlotOption,
} from "../../components/shell/CalendarDisplayPrefProvider";
import {
  useEventResultsPref,
  type EventResultsViewMode,
} from "../../components/shell/EventResultsPrefProvider";
import { createClient } from "../../lib/supabase/client";
import { isPushSupported, urlBase64ToUint8Array } from "../../lib/push";
import {
  MemberRoleEditSection,
  NewMemberRegistrationSection,
} from "../../components/MemberManagementSection";
import CollapsibleSection from "../../components/shell/CollapsibleSection";
import ScheduleEditForm, {
  type ScheduleDayPrefill,
} from "../../components/ScheduleEditForm";
import ScheduleOverviewCalendar from "../../components/ScheduleOverviewCalendar";
import { Location, locationLabel, locations } from "../../lib/types";

const themeOptions: { value: ThemePref; label: string }[] = [
  { value: "system", label: "端末設定に合わせる" },
  { value: "light", label: "ライトモード" },
  { value: "dark", label: "ダークモード" },
];

const calendarViewOptions: { value: CalendarViewPref; label: string }[] = [
  { value: "month", label: "月表示" },
  { value: "week", label: "週表示" },
];

function CalendarViewSection() {
  const { defaultCalendarView, setDefaultCalendarView } = useCalendarViewPref();
  return (
    <>
      <div className="flex flex-col gap-1.5 rounded-lg border border-border-color bg-surface-2 p-1">
        {calendarViewOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setDefaultCalendarView(opt.value)}
            className={`rounded-md px-3 py-2.5 text-left text-sm font-medium ${
              defaultCalendarView === opt.value
                ? "bg-red-600 text-white shadow"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        マイページ・チームページ・練習予定表のカレンダーを開いたときに、月表示と週表示のどちらを最初に表示するか選べます。
      </p>
    </>
  );
}

function CalendarSlotSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CalendarSlotOption;
  onChange: (v: CalendarSlotOption) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] text-neutral-500 dark:text-neutral-400">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as CalendarSlotOption)}
        className="rounded-lg border border-border-color bg-surface-2 px-3 py-2.5 text-sm text-foreground"
      >
        {calendarSlotOptions.map((opt) => (
          <option key={opt} value={opt}>
            {calendarSlotOptionLabel[opt]}
          </option>
        ))}
      </select>
    </label>
  );
}

function MyPageCalendarDisplaySection() {
  const { pref, setPref } = useCalendarDisplayPref();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <CalendarSlotSelect
          label="スロット1"
          value={pref.slot1}
          onChange={(v) => setPref({ ...pref, slot1: v })}
        />
        <CalendarSlotSelect
          label="スロット2"
          value={pref.slot2}
          onChange={(v) => setPref({ ...pref, slot2: v })}
        />
      </div>
      <label className="flex items-center justify-between gap-2 rounded-lg border border-border-color bg-surface-2 px-3 py-2.5">
        <span className="text-sm font-medium text-foreground">
          試合日を強調表示する
        </span>
        <input
          type="checkbox"
          checked={pref.highlightMatch}
          onChange={(e) =>
            setPref({ ...pref, highlightMatch: e.target.checked })
          }
          className="h-5 w-5 accent-red-600"
        />
      </label>
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        マイページのカレンダーのマス目は小さいため、直接表示できる項目は最大2つ（スロット1・スロット2）です。行った種目の内容や一言メモの全文など、詳しい情報は日付をタップした下の欄でいつでも確認できます。一言メモは自分だけが閲覧・編集できます（20文字まで）。
      </p>
    </div>
  );
}

const eventResultsViewOptions: { value: EventResultsViewMode; label: string }[] = [
  { value: "self", label: "自分の数値のみ" },
  { value: "all", label: "全員の数値" },
];

function EventResultsSection() {
  const { pref, setPref } = useEventResultsPref();
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-lg border border-border-color bg-surface-2 p-1">
        {eventResultsViewOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setPref({ ...pref, viewMode: opt.value })}
            className={`rounded-md px-3 py-2.5 text-left text-sm font-medium ${
              pref.viewMode === opt.value
                ? "bg-red-600 text-white shadow"
                : "text-neutral-500 dark:text-neutral-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {pref.viewMode === "all" && (
        <label className="flex items-center justify-between gap-2 rounded-lg border border-border-color bg-surface-2 px-3 py-2.5">
          <span className="text-sm font-medium text-foreground">
            学年ごとに折りたたんで表示する
          </span>
          <input
            type="checkbox"
            checked={pref.collapseByGrade}
            onChange={(e) =>
              setPref({ ...pref, collapseByGrade: e.target.checked })
            }
            className="h-5 w-5 accent-red-600"
          />
        </label>
      )}
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        ウェイトMAX・体組成のイベントを開いた時に、自分の数値だけを見るか、チーム全員の数値を見られるようにするかを選べます。「全員の数値」を選ぶと、一番上に自分、その下は学年が上の人から（同学年内は多摩→大塚の順）で並びます。「学年ごとに折りたたんで表示する」をオンにすると、学年をタップするまで詳細が隠れます。
      </p>
    </div>
  );
}

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border-color bg-surface-2 p-1">
      {themeOptions.map((opt) => (
        <button
          key={opt.value}
          onClick={() => setTheme(opt.value)}
          className={`rounded-md px-3 py-2.5 text-left text-sm font-medium ${
            theme === opt.value
              ? "bg-red-600 text-white shadow"
              : "text-neutral-500 dark:text-neutral-400"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

type MatchRow = {
  id: string;
  name: string;
  date: string;
};

function formatMonthDay(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function daysUntil(dateStr: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${dateStr}T00:00:00`);
  const diffMs = target.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function NextMatchSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const [nextMatch, setNextMatch] = useState<MatchRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadNextMatch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadNextMatch() {
    setLoading(true);
    const todayStr = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    const { data, error } = await supabase
      .from("matches")
      .select("id, name, date")
      .eq("team_id", profile.team_id)
      .eq("member_id", profile.id)
      .gte("date", todayStr)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      setErrorMsg(error.message);
    } else {
      setNextMatch((data as MatchRow | null) ?? null);
    }
    setLoading(false);
  }

  async function handleAddMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newDate) return;
    const { error } = await supabase.from("matches").insert({
      team_id: profile.team_id,
      name: newName.trim(),
      date: newDate,
      created_by: profile.id,
      member_id: profile.id,
    });
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setNewName("");
    setNewDate("");
    setShowForm(false);
    await loadNextMatch();
  }

  function startEditing() {
    if (!nextMatch) return;
    setEditDate(nextMatch.date);
    setEditing(true);
  }

  async function handleUpdateDate(e: React.FormEvent) {
    e.preventDefault();
    if (!nextMatch || !editDate) return;
    const { data, error } = await supabase
      .from("matches")
      .update({ date: editDate })
      .eq("id", nextMatch.id)
      .select("id");
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMsg(
        "試合日を更新できませんでした。データベース側の権限設定（matches_update_selfポリシー）が未反映の可能性があります。"
      );
      return;
    }
    setEditing(false);
    await loadNextMatch();
  }

  async function handleDelete() {
    if (!nextMatch) return;
    const { error } = await supabase.from("matches").delete().eq("id", nextMatch.id);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setEditing(false);
    await loadNextMatch();
  }

  const matchDays = nextMatch ? daysUntil(nextMatch.date) : null;

  return (
    <>
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : nextMatch ? (
        <div className="relative rounded-lg border border-red-900/60 bg-red-950/40 p-4 text-center">
          <p className="text-xs text-red-400">次の試合【{nextMatch.name}】まで</p>
          <p className="text-3xl font-bold text-red-500">あと{matchDays}日</p>
          <p className="text-[11px] text-red-500">{formatMonthDay(nextMatch.date)}</p>

          {editing ? (
            <form
              onSubmit={handleUpdateDate}
              className="mt-3 flex flex-col items-center gap-2"
            >
              <input
                type="date"
                value={editDate}
                onChange={(e) => setEditDate(e.target.value)}
                className="rounded-lg border border-red-800 bg-neutral-900 px-3 py-2 text-sm"
                required
              />
              <div className="flex gap-2">
                <button
                  type="submit"
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700"
                >
                  日付を更新
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="rounded-lg border border-red-800 px-3 py-1.5 text-xs text-red-400 active:bg-red-900/40"
                >
                  削除する
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300 active:bg-neutral-800"
                >
                  閉じる
                </button>
              </div>
            </form>
          ) : (
            <button
              onClick={startEditing}
              className="absolute bottom-2 right-2 rounded border border-red-900/60 bg-neutral-900 px-2 py-1 text-[10px] text-red-500 active:bg-red-900/40"
            >
              編集
            </button>
          )}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-700 p-4 text-center text-xs text-neutral-500">
          次の試合はまだ登録されていません。
        </p>
      )}

      <button
        onClick={() => setShowForm((v) => !v)}
        className="self-start text-[11px] font-medium text-red-400 active:text-red-900"
      >
        {showForm ? "キャンセル" : "＋ 試合を登録する"}
      </button>
      {showForm && (
        <form
          onSubmit={handleAddMatch}
          className="flex flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900 p-3"
        >
          <input
            type="text"
            placeholder="試合名（例：全日本学生選手権）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            required
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
            required
          />
          <button
            type="submit"
            className="rounded-lg bg-red-600 py-2 text-sm font-medium text-white active:bg-red-700"
          >
            登録する
          </button>
        </form>
      )}

      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">{errorMsg}</p>
      )}
    </>
  );
}

function NotificationSection() {
  const [supported] = useState(() => isPushSupported());
  const [subscribed, setSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration(
          "/sw.js"
        );
        const existing = await registration?.pushManager.getSubscription();
        setSubscribed(!!existing);
      } catch {
        setSubscribed(false);
      } finally {
        setChecked(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleEnable() {
    setLoading(true);
    setErrorMsg(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setErrorMsg(
          "通知が許可されませんでした。端末の設定から通知を許可してください。"
        );
        setLoading(false);
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidPublicKey) {
        setErrorMsg("通知の設定が未完了です(コーチ・管理者に連絡してください)。");
        setLoading(false);
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      const json = subscription.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          author_id: (await supabase.auth.getUser()).data.user?.id,
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh,
          auth: json.keys!.auth,
        },
        { onConflict: "endpoint" }
      );
      if (error) {
        setErrorMsg(error.message);
      } else {
        setSubscribed(true);
      }
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "通知の設定中にエラーが発生しました。"
      );
    }
    setLoading(false);
  }

  async function handleDisable() {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration(
        "/sw.js"
      );
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe();
        await supabase.from("push_subscriptions").delete().eq(
          "endpoint",
          endpoint
        );
      }
      setSubscribed(false);
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "通知の解除中にエラーが発生しました。"
      );
    }
    setLoading(false);
  }

  if (!supported) return null;

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border-color bg-surface-2 p-3 text-xs">
        <span className="text-neutral-600 dark:text-neutral-300">
          {!checked
            ? "確認中…"
            : subscribed
              ? "未完了のタスクがある日、夜に通知が届きます。"
              : "通知はオフになっています。"}
        </span>
        {subscribed ? (
          <button
            onClick={handleDisable}
            disabled={loading}
            className="shrink-0 rounded-lg border border-neutral-400 px-3 py-1.5 text-xs font-medium text-neutral-600 active:bg-neutral-200 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            {loading ? "処理中…" : "通知をオフにする"}
          </button>
        ) : (
          <button
            onClick={handleEnable}
            disabled={loading}
            className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
          >
            {loading ? "設定中…" : "通知を有効にする"}
          </button>
        )}
      </div>
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}
    </>
  );
}

function IconSection() {
  const { profile } = useProfile();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [iconUrl, setIconUrl] = useState(profile.icon_url);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${profile.id}/icon.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) {
        setErrorMsg(
          `アップロードに失敗しました: ${uploadError.message}（Supabase側でavatarsバケットの作成がまだの可能性があります）`
        );
        setUploading(false);
        return;
      }
      const { data: publicUrlData } = supabase.storage
        .from("avatars")
        .getPublicUrl(path);
      const url = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ icon_url: url })
        .eq("id", profile.id);
      if (updateError) {
        setErrorMsg(updateError.message);
        setUploading(false);
        return;
      }
      setIconUrl(url);
    } catch (e) {
      setErrorMsg(
        e instanceof Error ? e.message : "アップロード中にエラーが発生しました。"
      );
    }
    setUploading(false);
  }

  return (
    <>
      <div className="flex items-center gap-3 rounded-lg border border-border-color bg-surface-2 p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconUrl || "/icons/nav-default-avatar.png"}
          alt="プロフィールアイコン"
          className="h-16 w-16 shrink-0 rounded-full border border-border-color object-cover"
        />
        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {profile.display_name}
          </p>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="self-start rounded-lg border border-neutral-400 px-3 py-1.5 text-xs font-medium text-neutral-600 active:bg-neutral-200 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
          >
            {uploading ? "アップロード中…" : "画像を変更する（320×320推奨）"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>
      </div>
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-xs text-red-400">
          {errorMsg}
        </p>
      )}
    </>
  );
}

// 拠点タブを選んでから、その期間の時間割をまとめて登録できる管理者向けの欄
// （旧・マット掲示板の「期間でまとめて設定する」をこちらに集約した）
function formatMonthDaySettings(dateStr: string) {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

function SectionRegistrationSection({
  profile,
}: {
  profile: { team_id: string; id: string };
}) {
  const supabase = createClient();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [location, setLocation] = useState<Location>("tama");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [existingDay, setExistingDay] = useState<
    ScheduleDayPrefill | null | undefined
  >(undefined);
  const [resetKey, setResetKey] = useState(0);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  useEffect(() => {
    if (!selectedDate) {
      setExistingDay(undefined);
      return;
    }
    let cancelled = false;
    setExistingDay(undefined);
    (async () => {
      const { data } = await supabase
        .from("schedule_days")
        .select(
          "is_off, day_type, event_name, sessions:schedule_sessions(session_type, start_time, is_joint, joint_location, location_note)"
        )
        .eq("team_id", profile.team_id)
        .eq("location", location)
        .eq("date", selectedDate)
        .maybeSingle();
      if (!cancelled) {
        setExistingDay((data as ScheduleDayPrefill | null) ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, location, profile.team_id]);

  function handleSelectDate(loc: Location, dateStr: string) {
    setLocation(loc);
    setSelectedDate((prev) => (prev === dateStr && location === loc ? null : dateStr));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        カレンダーの日付をタップすると、その日を単日で編集できます。日付を選ばず「期間でまとめて設定」から、オフ・合宿・試合・出稽古をまとめて登録することもできます。
      </p>

      <div className="flex gap-2">
        {locations.map((loc) => (
          <button
            key={loc}
            onClick={() => setLocation(loc)}
            className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium ${
              location === loc
                ? "border-red-600 bg-red-600 text-white"
                : "border-neutral-700 text-neutral-400 active:bg-neutral-800"
            }`}
          >
            {locationLabel[loc]}
          </button>
        ))}
      </div>

      <ScheduleOverviewCalendar
        key={`${location}-${calendarRefreshKey}`}
        teamId={profile.team_id}
        location={location}
        cursor={cursor}
        onCursorChange={setCursor}
        selectedDate={selectedDate}
        onSelectDate={(d) => handleSelectDate(location, d)}
      />

      {selectedDate && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-foreground">
            {locationLabel[location]}・{formatMonthDaySettings(selectedDate)}を編集
          </p>
          <button
            onClick={() => setSelectedDate(null)}
            className="shrink-0 text-[11px] font-medium text-neutral-400 underline"
          >
            日付選択を解除
          </button>
        </div>
      )}

      {selectedDate && existingDay === undefined ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : (
        <ScheduleEditForm
          key={`${location}-${selectedDate ?? "range"}-${resetKey}`}
          teamId={profile.team_id}
          authorId={profile.id}
          location={location}
          mode={selectedDate ? "single" : "range"}
          allowModeToggle
          date={selectedDate ?? todayStr}
          existingDay={selectedDate ? existingDay ?? null : null}
          onCancel={() => {
            setSelectedDate(null);
            setResetKey((k) => k + 1);
          }}
          onSaved={() => {
            setResetKey((k) => k + 1);
            setCalendarRefreshKey((k) => k + 1);
          }}
        />
      )}
    </div>
  );
}

// 設定ページの大分類。アイコン＋タイトルを常に表示するヘッダーの下に、
// その分類に属する設定項目（CollapsibleSection）をまとめる。
// childrenを渡さない場合は「表示だけ」の分類として、準備中である旨を表示する。
function SettingsGroup({
  icon,
  iconAlt,
  title,
  children,
  placeholder,
}: {
  icon: string;
  iconAlt: string;
  title: string;
  children?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-border-color bg-surface p-3 shadow-sm">
      <div className="flex items-center gap-2 px-0.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={icon}
          alt={iconAlt}
          className="h-6 w-6 shrink-0 rounded-md object-cover"
        />
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      {children ? (
        <div className="flex flex-col gap-2">{children}</div>
      ) : (
        <p className="rounded-lg border border-dashed border-neutral-400 px-3 py-3 text-center text-[11px] text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
          {placeholder ?? "設定できる項目は準備中です。"}
        </p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { profile, signOut } = useProfile();
  const isCoach = profile.role === "coach";
  const pushSupported = isPushSupported();
  const myPageIcon = profile.icon_url || "/icons/nav-default-avatar.png";

  return (
    <div className="mx-auto flex w-full flex-col gap-4 p-4 sm:p-5">
      {isCoach ? (
        <>
          <SettingsGroup icon="/icons/nav-settings.png" iconAlt="通常" title="通常">
            {pushSupported && (
              <CollapsibleSection title="通知設定">
                <NotificationSection />
              </CollapsibleSection>
            )}
            <CollapsibleSection title="デザイン設定">
              <ThemeSection />
            </CollapsibleSection>
            <CollapsibleSection title="カレンダー表示設定">
              <CalendarViewSection />
            </CollapsibleSection>
            <CollapsibleSection title="プロフィールアイコンの設定">
              <IconSection />
            </CollapsibleSection>
          </SettingsGroup>

          <SettingsGroup icon="/icons/nav-admin.png" iconAlt="管理設定" title="管理設定">
            <CollapsibleSection title="メンバー情報の編集">
              <MemberRoleEditSection profile={profile} />
            </CollapsibleSection>
            <CollapsibleSection title="新規メンバー登録">
              <NewMemberRegistrationSection profile={profile} />
            </CollapsibleSection>
          </SettingsGroup>

          <SettingsGroup icon="/icons/nav-board.png" iconAlt="練習予定表" title="練習予定表">
            <CollapsibleSection title="セクション登録">
              <SectionRegistrationSection profile={profile} />
            </CollapsibleSection>
          </SettingsGroup>

          <SettingsGroup icon="/icons/nav-events.png" iconAlt="イベント" title="イベント">
            <p className="rounded-lg border border-border-color bg-surface-2 px-3 py-2.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              管理者にはウェイトMAX・体組成のイベント結果を常に「全員の数値」で、学年ごとに折りたたんで表示します。
            </p>
          </SettingsGroup>
        </>
      ) : (
        <>
          <SettingsGroup icon="/icons/nav-settings.png" iconAlt="一般" title="一般">
            {pushSupported && (
              <CollapsibleSection title="通知設定">
                <NotificationSection />
              </CollapsibleSection>
            )}
            <CollapsibleSection title="デザイン設定">
              <ThemeSection />
            </CollapsibleSection>
            <CollapsibleSection title="カレンダー表示設定">
              <CalendarViewSection />
            </CollapsibleSection>
          </SettingsGroup>

          <SettingsGroup icon={myPageIcon} iconAlt="マイページ" title="マイページ">
            <CollapsibleSection title="プロフィールアイコンの設定">
              <IconSection />
            </CollapsibleSection>
            <CollapsibleSection title="次の試合">
              <NextMatchSection />
            </CollapsibleSection>
            <CollapsibleSection title="マイページカレンダーの表示設定">
              <MyPageCalendarDisplaySection />
            </CollapsibleSection>
          </SettingsGroup>

          <SettingsGroup
            icon="/icons/nav-team-chuo.png"
            iconAlt="チームページ"
            title="チームページ"
          />

          <SettingsGroup
            icon="/icons/nav-board.png"
            iconAlt="練習予定表"
            title="練習予定表"
          />

          <SettingsGroup icon="/icons/nav-events.png" iconAlt="イベント" title="イベント">
            <CollapsibleSection title="結果の表示">
              <EventResultsSection />
            </CollapsibleSection>
          </SettingsGroup>
        </>
      )}

      <div className="pt-2">
        <button
          onClick={signOut}
          className="w-full rounded-lg border border-neutral-400 py-3 text-sm font-medium text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
        >
          ログアウト
        </button>
      </div>
    </div>
  );
}
