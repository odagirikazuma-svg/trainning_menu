"use client";

import { useEffect, useRef, useState } from "react";
import { useProfile } from "../../components/shell/AppShell";
import { useTheme, type ThemePref } from "../../components/shell/ThemeProvider";
import {
  useCalendarViewPref,
  type CalendarViewPref,
} from "../../components/shell/CalendarViewPrefProvider";
import { createClient } from "../../lib/supabase/client";
import { isPushSupported, urlBase64ToUint8Array } from "../../lib/push";
import {
  MemberRoleEditSection,
  NewMemberRegistrationSection,
} from "../../components/MemberManagementSection";
import CollapsibleSection from "../../components/shell/CollapsibleSection";
import ScheduleEditForm from "../../components/ScheduleEditForm";
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
        マイページ・チームページ・マット掲示板のカレンダーを開いたときに、月表示と週表示のどちらを最初に表示するか選べます。
      </p>
    </>
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
function SectionRegistrationSection({
  profile,
}: {
  profile: { team_id: string; id: string };
}) {
  const [location, setLocation] = useState<Location>("tama");
  const [resetKey, setResetKey] = useState(0);
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
        練習・オフ・合宿・試合・出稽古などの時間割を、単日または期間でまとめて登録できます。
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
      <ScheduleEditForm
        key={`${location}-${resetKey}`}
        teamId={profile.team_id}
        authorId={profile.id}
        location={location}
        mode="range"
        allowModeToggle
        date={todayStr}
        onCancel={() => setResetKey((k) => k + 1)}
        onSaved={() => {}}
      />
    </div>
  );
}

export default function SettingsPage() {
  const { profile, signOut } = useProfile();
  const isCoach = profile.role === "coach";
  const pushSupported = isPushSupported();

  return (
    <div className="mx-auto flex w-full flex-col divide-y divide-border-color p-4 sm:p-5">
      <div className="pb-3">
        <CollapsibleSection title="表示モード">
          <ThemeSection />
        </CollapsibleSection>
      </div>
      <div className="py-3">
        <CollapsibleSection title="カレンダーの初期表示">
          <CalendarViewSection />
        </CollapsibleSection>
      </div>
      <div className="py-3">
        <CollapsibleSection title="プロフィールアイコン">
          <IconSection />
        </CollapsibleSection>
      </div>
      {!isCoach && (
        <div className="py-3">
          <CollapsibleSection title="次の試合">
            <NextMatchSection />
          </CollapsibleSection>
        </div>
      )}
      {pushSupported && (
        <div className="py-3">
          <CollapsibleSection title="通知設定">
            <NotificationSection />
          </CollapsibleSection>
        </div>
      )}
      {isCoach && (
        <>
          <div className="py-3">
            <CollapsibleSection title="メンバー情報の編集">
              <MemberRoleEditSection profile={profile} />
            </CollapsibleSection>
          </div>
          <div className="py-3">
            <CollapsibleSection title="新規メンバー登録">
              <NewMemberRegistrationSection profile={profile} />
            </CollapsibleSection>
          </div>
          <div className="py-3">
            <CollapsibleSection title="セクション登録">
              <SectionRegistrationSection profile={profile} />
            </CollapsibleSection>
          </div>
        </>
      )}

      <div className="pt-4">
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
