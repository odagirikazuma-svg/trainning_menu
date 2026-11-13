"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "../../components/shell/AppShell";
import { createClient } from "../../lib/supabase/client";
import { currentGrade, locationLabel, roleLabel } from "../../lib/types";
import WeightClassSection from "../../components/WeightClassSection";
import NextMatchSection from "../../components/NextMatchSection";
import GoalsSettingsSection from "../../components/GoalsSettingsSection";
import EmailLoginSection from "../../components/EmailLoginSection";

// はじめての設定（LINEで登録した部員が最初に通る画面）。
// 1 名簿の確認 → 2 階級 → 3 次の試合・目標 → 4 パソコンから使う（任意）→ 5 使い方
// 最後まで進むと profiles.onboarded_at が入り、次からは出ない。途中の入力は設定からいつでも直せる。
const STEPS = ["確認", "階級", "試合・目標", "パソコン", "使い方"] as const;

export default function WelcomePage() {
  const { profile } = useProfile();
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState(0);
  const [wrongInfo, setWrongInfo] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function finish() {
    setFinishing(true);
    const { error: e } = await supabase
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (e) {
      setError(e.message);
      setFinishing(false);
      return;
    }
    router.replace("/mypage");
  }

  const next = () => {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    window.scrollTo({ top: 0 });
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const card = "flex flex-col gap-3 rounded-xl border border-border-color bg-surface p-4";
  const primary =
    "min-h-11 w-full rounded-lg bg-accent px-3 py-3 text-base font-bold text-white active:brightness-90 disabled:opacity-50";
  const ghost = "text-sm text-neutral-500 underline decoration-dotted";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-foreground">はじめての設定</h1>
        <p className="text-xs text-neutral-500">あと少しで使いはじめられます。あとから設定でいつでも直せます。</p>
      </div>

      {/* 進み具合 */}
      <ol className="flex gap-1">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 flex-col items-center gap-1">
            <span className={`h-1.5 w-full rounded-full ${i <= step ? "bg-accent" : "bg-neutral-300 dark:bg-neutral-700"}`} />
            <span className={`text-[length:calc(10px+var(--fs-add))] ${i === step ? "font-bold text-foreground" : "text-neutral-500"}`}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className={card}>
          <h2 className="text-base font-bold text-foreground">あなたの情報を確認してください</h2>
          <dl className="grid grid-cols-[5rem_1fr] gap-y-2 text-sm">
            <dt className="text-neutral-500">名前</dt>
            <dd className="font-semibold text-foreground">{profile.display_name}</dd>
            <dt className="text-neutral-500">拠点</dt>
            <dd className="text-foreground">{profile.home_location ? locationLabel[profile.home_location] : "未設定"}</dd>
            <dt className="text-neutral-500">学年</dt>
            <dd className="text-foreground">{profile.entry_year ? `${currentGrade(profile.entry_year)}年` : "未設定"}</dd>
            <dt className="text-neutral-500">役割</dt>
            <dd className="text-foreground">{roleLabel[profile.role]}</dd>
          </dl>
          {wrongInfo ? (
            <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              違っているところは、監督に伝えて直してもらってください。このまま次に進んで大丈夫です。
            </p>
          ) : null}
          <button type="button" onClick={next} className={primary}>
            {wrongInfo ? "次へ" : "合っています"}
          </button>
          {!wrongInfo && (
            <button type="button" onClick={() => setWrongInfo(true)} className={ghost}>
              違うところがある
            </button>
          )}
        </section>
      )}

      {step === 1 && (
        <section className={card}>
          <h2 className="text-base font-bold text-foreground">試合に出る階級</h2>
          <p className="text-xs text-neutral-500">選んで「この階級で保存」を押してください。疲労度の計算やイベントの表示に使います。</p>
          <WeightClassSection />
          <button type="button" onClick={next} className={primary}>
            次へ
          </button>
          <button type="button" onClick={next} className={ghost}>
            あとで決める（設定に「やること」として残ります）
          </button>
        </section>
      )}

      {step === 2 && (
        <section className={card}>
          <h2 className="text-base font-bold text-foreground">次の試合と目標</h2>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">次の試合</span>
            <NextMatchSection />
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border-color pt-3">
            <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">目標</span>
            <GoalsSettingsSection />
          </div>
          <button type="button" onClick={next} className={primary}>
            次へ
          </button>
          <button type="button" onClick={next} className={ghost}>
            あとで入れる
          </button>
        </section>
      )}

      {step === 3 && (
        <section className={card}>
          <h2 className="text-base font-bold text-foreground">パソコンからも使う（任意）</h2>
          <p className="text-xs text-neutral-500">
            ふだんはLINEからそのまま開けます。パソコンなどLINEのない端末でも使いたい人は、メールアドレスとパスワードを登録してください。
          </p>
          <EmailLoginSection />
          <button type="button" onClick={next} className={primary}>
            次へ
          </button>
          <button type="button" onClick={next} className={ghost}>
            スマホのLINEだけで使う
          </button>
        </section>
      )}

      {step === 4 && (
        <section className={card}>
          <h2 className="text-base font-bold text-foreground">毎日やること</h2>
          <ul className="flex flex-col gap-2.5">
            {[
              ["📝", "練習のあとに日報を出す", "公式LINEのメニュー「日報を書く」から。マット練習の振り返りと、ウェイト・ランの記録、今日の疲労度を入れます。"],
              ["🙋", "休むときは前もって申請", "マイページの「申請」から。休むセクションと、休むあいだ休養するか代替メニューをやるかを選びます。"],
              ["📈", "振り返りで記録を見る", "マイページの「振り返り」で、提出状況や種目ごとの記録の伸びが見られます。"],
              ["🔔", "やることは赤い数字で", "下のメニューの赤い数字が、まだ出していない日報などの数です。"],
            ].map(([icon, title, body]) => (
              <li key={title} className="flex gap-3 rounded-lg bg-surface-2 p-3">
                <span className="text-xl leading-none">{icon}</span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-foreground">{title}</span>
                  <span className="text-xs text-neutral-600 dark:text-neutral-400">{body}</span>
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="button" onClick={finish} disabled={finishing} className={primary}>
            {finishing ? "準備しています…" : "はじめる"}
          </button>
        </section>
      )}

      {step > 0 && (
        <button type="button" onClick={back} className="self-start text-xs text-neutral-500">
          ‹ もどる
        </button>
      )}
    </div>
  );
}
