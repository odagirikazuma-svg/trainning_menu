"use client";

import { useEffect, useRef, useState } from "react";
import { useProfile } from "../../components/shell/AppShell";
import { useTheme, type ThemePref } from "../../components/shell/ThemeProvider";
import { createClient } from "../../lib/supabase/client";
import { isPushSupported, urlBase64ToUint8Array } from "../../lib/push";

const themeOptions: { value: ThemePref; label: string }[] = [
  { value: "system", label: "端末設定に合わせる" },
  { value: "light", label: "ライトモード" },
  { value: "dark", label: "ダークモード" },
];

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
        表示モード
      </h2>
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
    </section>
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
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
        通知設定
      </h2>
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
    </section>
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
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
        プロフィールアイコン
      </h2>
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
    </section>
  );
}

function CoachManagementBridgeSection() {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className="inline-block h-3.5 w-1 rounded-full bg-red-600" />
        メンバー管理
      </h2>
      <p className="rounded-lg border border-dashed border-neutral-400 p-3 text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        メンバー情報の編集・新規メンバー登録は、近日中にここへ移設予定です。現在は管理ページからご利用いただけます。
      </p>
      <a
        href="/admin"
        className="self-start rounded-lg border border-neutral-400 px-3 py-1.5 text-xs font-medium text-neutral-600 active:bg-neutral-200 dark:border-neutral-700 dark:text-neutral-300 dark:active:bg-neutral-800"
      >
        管理ページを開く
      </a>
    </section>
  );
}

export default function SettingsPage() {
  const { profile, signOut } = useProfile();

  return (
    <div className="mx-auto flex w-full flex-col gap-6 p-4 sm:p-5">
      <ThemeSection />
      <IconSection />
      <NotificationSection />
      {profile.role === "coach" && <CoachManagementBridgeSection />}

      <div className="border-t border-border-color pt-4">
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
