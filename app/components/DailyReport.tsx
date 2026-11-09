"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../lib/supabase/client";
import { isExemptOn, loadExemptions } from "../lib/exemptions";
import {
  commentKindLabel,
  Location,
  locationLabel,
  roleLabel,
  SessionType,
  sessionTypeLabel,
  TitleColor,
  TrainingType,
  trainingTypeLabel,
} from "../lib/types";
import type { Profile } from "./AuthGate";
import ReactionBar, { loadReactions, type ReactionRow } from "./ReactionBar";
import { RecentTypeLogs, TrainingCommentThread } from "./TrainingShared";
import SetLogger, {
  blocksHaveData,
  blocksSummaryText,
  loadSetsForLog,
  saveSetsForLog,
  SetSummary,
  type ExerciseBlock,
} from "./SetLogger";
import { notifyTasksChanged } from "./shell/taskRefreshBus";

/**
 * マイページの「日報」。
 * その日の「マット練習の報告（実施／未実施）」と「トレーニングの報告（トレ報）」を
 * 1ページにまとめて、ボタン1つで提出できるようにしたもの。
 *
 * - マット練習：時間割（またはリーダーのメニュー）から作られたその日のメニューごとに、
 *   開始時刻を過ぎたら「実施した／実施できなかった」を選んで書く。
 *   保存先はこれまで通り comments（kind = report / absent）なので、
 *   練習予定表・管理ページの提出状況はそのまま使える。
 * - トレーニング：その日の時間割にラン・ウェイトなどが入っていれば必須、無ければ任意。
 *   保存先はこれまで通り weight_logs（1日1件）。
 */

type DayMenu = {
  id: string;
  date: string;
  title: string;
  content: string;
  location: Location;
  start_time: string | null;
  is_joint: boolean;
};

type MyReport = {
  id: string;
  menu_id: string;
  kind: "report" | "absent";
  text: string;
  alt_type: TrainingType | null;
  created_at: string;
};

type ReplyRow = {
  id: string;
  parent_id: string;
  text: string;
  created_at: string;
  author: { display_name: string; role: Profile["role"] } | null;
};

type TrainingLog = {
  id: string;
  date: string;
  content: string;
  type: TrainingType;
  title: string | null;
  start_time: string | null;
};

type DaySession = {
  session_type: SessionType;
  start_time: string | null;
};

type MatDraft = {
  mode: "report" | "absent" | null;
  text: string;
  reason: string;
  altType: TrainingType | null;
  alt: string;
};

type TrainingDraft = {
  type: TrainingType | null;
  startTime: string;
  title: string;
  content: string;
};

const emptyMatDraft: MatDraft = {
  mode: null,
  text: "",
  reason: "",
  altType: null,
  alt: "",
};

const emptyTrainingDraft: TrainingDraft = {
  type: null,
  startTime: "",
  title: "",
  content: "",
};

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function shiftDate(dateStr: string, days: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return toDateKey(new Date(y, m - 1, d + days));
}

// "YYYY-MM-DD" -> "11月9日(月)"
export function formatMonthDayWeek(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const w = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return `${m}月${d}日(${w})`;
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isMenuOpen(m: { date: string; start_time: string | null }) {
  if (!m.start_time) return true;
  return new Date() >= new Date(`${m.date}T${m.start_time}`);
}

function absentText(reason: string, altType: TrainingType, alt: string) {
  return `理由: ${reason.trim()}\n代替メニュー: ${trainingTypeLabel[altType]}\n詳細: ${alt.trim()}`;
}

// 保存済みの未実施報告の本文（「理由: …\n代替メニュー: …\n詳細: …」）を入力欄に戻す
function parseAbsentText(text: string): { reason: string; alt: string } {
  const reasonMatch = text.match(/^理由: ?(.*)$/m);
  const detailIndex = text.indexOf("詳細:");
  return {
    reason: reasonMatch ? reasonMatch[1] : "",
    alt:
      detailIndex >= 0
        ? text.slice(detailIndex + "詳細:".length).replace(/^ /, "")
        : text,
  };
}

function menuHeading(m: DayMenu) {
  const time = m.start_time ? `${m.start_time.slice(0, 5)}〜 ` : "";
  const place = m.is_joint
    ? `全体練習・${locationLabel[m.location]}`
    : locationLabel[m.location];
  return `${time}マット練習（${place}）`;
}

export default function DailyReport({
  profile,
  date,
  onDateChange,
  variant = "page",
  refreshKey = 0,
  pendingDates = [],
  titleOptions,
  titleColors,
  onSubmitted,
  onTitlesChanged,
}: {
  profile: Profile;
  date: string;
  // 日付を切り替えられるようにする場合に渡す（ポップアップ内では渡さない）
  onDateChange?: (date: string) => void;
  variant?: "page" | "popup";
  refreshKey?: number;
  // 未提出の日（ページ上部に「未提出の日」として並べ、押すとその日へ移動）
  pendingDates?: string[];
  titleOptions: Record<TrainingType, string[]>;
  titleColors: Record<TrainingType, Map<string, TitleColor>>;
  onSubmitted?: () => void | Promise<void>;
  // タイトル候補を整理したあとに、候補を読み直す（入力中の内容は消さない）
  onTitlesChanged?: () => void | Promise<void>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const todayStr = toDateKey(new Date());
  const isPopup = variant === "popup";
  const homeLocation: Location | null =
    profile.role === "manager" ? "tama" : profile.home_location;

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menus, setMenus] = useState<DayMenu[]>([]);
  const [myReports, setMyReports] = useState<MyReport[]>([]);
  const [replies, setReplies] = useState<ReplyRow[]>([]);
  const [reactions, setReactions] = useState<ReactionRow[]>([]);
  const [sessions, setSessions] = useState<DaySession[]>([]);
  const [isOffDay, setIsOffDay] = useState(false);
  const [exempt, setExempt] = useState(false);
  const [log, setLog] = useState<TrainingLog | null>(null);
  const [memoId, setMemoId] = useState<string | null>(null);
  const [memoSaved, setMemoSaved] = useState("");

  const [matDrafts, setMatDrafts] = useState<Record<string, MatDraft>>({});
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [training, setTraining] = useState<TrainingDraft>(emptyTrainingDraft);
  // 種目ごとのセット記録（重量・回数・時間）
  const [blocks, setBlocks] = useState<ExerciseBlock[]>([]);
  const [savedBlocks, setSavedBlocks] = useState<ExerciseBlock[]>([]);
  const [editingTraining, setEditingTraining] = useState(false);
  const [memo, setMemo] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  // タイムラインのカードの開閉（押して切り替えた分だけ覚える）
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // 週の帯の「●提出済み」用：その週に自分が何か提出した日
  const [weekSubmitted, setWeekSubmitted] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [copying, setCopying] = useState(false);
  // タイトル候補の整理（間違えて付けたタイトルを候補から消す）
  const [titleEditMode, setTitleEditMode] = useState(false);
  const [removingTitle, setRemovingTitle] = useState<string | null>(null);
  const submitLock = useRef(false);
  // 日付を素早く切り替えたときに、古い日の読み込み結果で上書きしないための番号
  const loadSeq = useRef(0);

  useEffect(() => {
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, refreshKey]);

  // 週の帯の●（その週に提出したことがある日）
  const weekKey = (() => {
    const [y, m, d] = date.split("-").map(Number);
    return shiftDate(date, -((new Date(y, m - 1, d).getDay() + 6) % 7));
  })();
  useEffect(() => {
    if (isPopup) return;
    let cancelled = false;
    (async () => {
      const from = weekKey;
      const to = shiftDate(weekKey, 6);
      const [reports, logs] = await Promise.all([
        supabase
          .from("comments")
          .select("menu:menus!inner(date)")
          .eq("author_id", profile.id)
          .in("kind", ["report", "absent"])
          .is("parent_id", null)
          .gte("menu.date", from)
          .lte("menu.date", to),
        supabase
          .from("weight_logs")
          .select("date")
          .eq("author_id", profile.id)
          .gte("date", from)
          .lte("date", to),
      ]);
      if (cancelled) return;
      const set = new Set<string>();
      for (const r of (reports.data ?? []) as unknown as { menu: { date: string } | null }[]) {
        if (r.menu) set.add(r.menu.date);
      }
      for (const l of (logs.data ?? []) as { date: string }[]) set.add(l.date);
      setWeekSubmitted(set);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekKey, refreshKey, profile.id]);

  async function load(resetDrafts: boolean) {
    const seq = ++loadSeq.current;
    setLoading(true);
    setErrorMsg(null);
    if (resetDrafts) {
      setMatDrafts({});
      setEditingReportId(null);
      setEditingTraining(false);
      setMissing([]);
      setNotice(null);
      setExpanded({});
    }

    // 1) その日のマットメニュー（所属拠点のもの＋全体練習）
    let dayMenus: DayMenu[] = [];
    if (homeLocation) {
      const cols = "id, date, title, content, location, start_time, is_joint";
      const [own, joint] = await Promise.all([
        supabase
          .from("menus")
          .select(cols)
          .eq("team_id", profile.team_id)
          .eq("location", homeLocation)
          .eq("is_off", false)
          .eq("date", date),
        supabase
          .from("menus")
          .select(cols)
          .eq("team_id", profile.team_id)
          .eq("is_joint", true)
          .eq("is_off", false)
          .eq("date", date),
      ]);
      if (own.error || joint.error) {
        setErrorMsg((own.error ?? joint.error)!.message);
      }
      const map = new Map<string, DayMenu>();
      for (const m of [...(own.data ?? []), ...(joint.data ?? [])] as DayMenu[]) {
        map.set(m.id, m);
      }
      dayMenus = Array.from(map.values()).sort((a, b) =>
        (a.start_time ?? "00:00").localeCompare(b.start_time ?? "00:00")
      );
    }

    // 2) 自分の報告と、それに付いたコメント・リアクション
    let reports: MyReport[] = [];
    let replyRows: ReplyRow[] = [];
    let reactionRows: ReactionRow[] = [];
    if (dayMenus.length > 0) {
      const { data, error } = await supabase
        .from("comments")
        .select("id, menu_id, kind, text, alt_type, created_at")
        .eq("author_id", profile.id)
        .in(
          "menu_id",
          dayMenus.map((m) => m.id)
        )
        .in("kind", ["report", "absent"])
        .is("parent_id", null);
      if (error) setErrorMsg(error.message);
      reports = (data ?? []) as MyReport[];
      if (reports.length > 0) {
        const ids = reports.map((r) => r.id);
        const { data: replyData } = await supabase
          .from("comments")
          .select(
            "id, parent_id, text, created_at, author:profiles!comments_author_id_fkey(display_name, role)"
          )
          .in("parent_id", ids)
          .order("created_at", { ascending: true });
        replyRows = (replyData ?? []) as unknown as ReplyRow[];
        reactionRows = await loadReactions(supabase, ids);
      }
    }

    // 3) その日の時間割（ラン・ウェイトがあればトレ報が必須）
    let daySessions: DaySession[] = [];
    let offDay = false;
    if (homeLocation) {
      const { data } = await supabase
        .from("schedule_days")
        .select("is_off, sessions:schedule_sessions(session_type, start_time)")
        .eq("team_id", profile.team_id)
        .eq("location", homeLocation)
        .eq("date", date)
        .maybeSingle();
      const row = data as unknown as {
        is_off: boolean;
        sessions: DaySession[];
      } | null;
      offDay = !!row?.is_off;
      daySessions = offDay
        ? []
        : (row?.sessions ?? [])
            .slice()
            .sort((a, b) =>
              (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99")
            );
    }

    // 4) 免除期間・トレ報・一言メモ
    const [exemptions, logRes, memoRes] = await Promise.all([
      loadExemptions(supabase, profile.team_id, date, date, profile.id),
      supabase
        .from("weight_logs")
        .select("id, date, content, type, title, start_time")
        .eq("author_id", profile.id)
        .eq("date", date)
        .maybeSingle(),
      supabase
        .from("personal_memos")
        .select("id, content")
        .eq("author_id", profile.id)
        .eq("date", date)
        .maybeSingle(),
    ]);

    if (seq !== loadSeq.current) return;

    setMenus(dayMenus);
    setMyReports(reports);
    setReplies(replyRows);
    setReactions(reactionRows);
    setSessions(daySessions);
    setIsOffDay(offDay);
    setExempt(isExemptOn(exemptions, profile.id, date));
    const logRow = (logRes.data as TrainingLog | null) ?? null;
    const logBlocks = logRow ? await loadSetsForLog(supabase, logRow.id) : [];
    if (seq !== loadSeq.current) return;
    setLog(logRow);
    setSavedBlocks(logBlocks);
    if (resetDrafts) setBlocks(logBlocks);
    if (resetDrafts) {
      setTraining(
        logRow
          ? {
              type: logRow.type,
              startTime: logRow.start_time ? logRow.start_time.slice(0, 5) : "",
              title: logRow.title ?? "",
              content:
                logRow.content === blocksSummaryText(logBlocks) ? "" : logRow.content,
            }
          : emptyTrainingDraft
      );
    }
    const memoRow = (memoRes.data as { id: string; content: string } | null) ?? null;
    setMemoId(memoRow?.id ?? null);
    setMemoSaved(memoRow?.content ?? "");
    if (resetDrafts) setMemo(memoRow?.content ?? "");
    setLoading(false);
  }

  async function reloadReactions() {
    const ids = myReports.map((r) => r.id);
    setReactions(await loadReactions(supabase, ids));
  }

  const reportByMenu = new Map(myReports.map((r) => [r.menu_id, r]));
  const openMenus = menus.filter((m) => isMenuOpen(m));
  const pendingMenus = openMenus.filter((m) => !reportByMenu.has(m.id));
  const nonMatSessions = sessions.filter((s) => s.session_type !== "mat");
  const trainingRequired = !exempt && nonMatSessions.length > 0;
  const isFuture = date > todayStr;

  function draftOf(menuId: string): MatDraft {
    return matDrafts[menuId] ?? emptyMatDraft;
  }
  function updateDraft(menuId: string, patch: Partial<MatDraft>) {
    setMatDrafts((prev) => ({
      ...prev,
      [menuId]: { ...(prev[menuId] ?? emptyMatDraft), ...patch },
    }));
    setMissing([]);
  }
  function updateTraining(patch: Partial<TrainingDraft>) {
    setTraining((prev) => ({ ...prev, ...patch }));
    setMissing([]);
  }

  // 提出前のチェック。足りないものを日本語で返す（空なら提出できる）
  function validate(): string[] {
    const problems: string[] = [];
    for (const m of pendingMenus) {
      const d = draftOf(m.id);
      const label = menuHeading(m);
      if (!d.mode) {
        if (!exempt) problems.push(`${label}：「実施した」か「実施できなかった」を選んでください`);
        continue;
      }
      if (d.mode === "report" && !d.text.trim()) {
        problems.push(`${label}：実施した内容・振り返りを書いてください`);
      }
      if (
        d.mode === "absent" &&
        (!d.reason.trim() || !d.altType || !d.alt.trim())
      ) {
        problems.push(`${label}：理由・代替メニューの種類・詳細をすべて書いてください`);
      }
    }
    const touched =
      !!training.type ||
      training.content.trim() !== "" ||
      training.title.trim() !== "" ||
      blocks.length > 0;
    if (!log && (trainingRequired || touched)) {
      if (!training.type) problems.push("トレーニング：ラン／ウェイト／その他を選んでください");
      if (!training.content.trim() && !blocksHaveData(blocks))
        problems.push("トレーニング：種目の記録か、実施した内容のどちらかを書いてください");
    }
    if (training.startTime && training.startTime < "06:00") {
      problems.push("トレーニング：開始時間はその日の6時以降で入力してください");
    }
    return problems;
  }

  async function handleSubmit() {
    if (submitLock.current) return;
    const problems = validate();
    if (problems.length > 0) {
      setMissing(problems);
      return;
    }
    const matToSend = pendingMenus.filter((m) => draftOf(m.id).mode);
    const sendTraining =
      !log && !!training.type && (training.content.trim() !== "" || blocksHaveData(blocks));
    const sendMemo = memo.slice(0, 20) !== memoSaved;
    if (matToSend.length === 0 && !sendTraining && !sendMemo) {
      setMissing(["提出する内容がまだありません。"]);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      for (const m of matToSend) {
        const d = draftOf(m.id);
        // 連打・通信の遅れで同じ報告が2件入らないよう、送る直前にもう一度確認する
        const { data: existing } = await supabase
          .from("comments")
          .select("id")
          .eq("menu_id", m.id)
          .eq("author_id", profile.id)
          .in("kind", ["report", "absent"])
          .is("parent_id", null)
          .limit(1);
        if (existing && existing.length > 0) continue;
        const row =
          d.mode === "report"
            ? { kind: "report", text: d.text.trim(), alt_type: null }
            : {
                kind: "absent",
                text: absentText(d.reason, d.altType!, d.alt),
                alt_type: d.altType,
              };
        const { error } = await supabase.from("comments").insert({
          menu_id: m.id,
          author_id: profile.id,
          parent_id: null,
          ...row,
        });
        if (error && error.code !== "23505") throw new Error(error.message);
      }

      if (sendTraining) {
        const title = training.title.trim();
        const { data: saved, error } = await supabase.from("weight_logs").upsert(
          {
            team_id: profile.team_id,
            author_id: profile.id,
            date,
            content: training.content.trim() || blocksSummaryText(blocks),
            type: training.type,
            title: title || null,
            start_time: training.startTime || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "author_id,date" }
        ).select("id").single();
        if (error) throw new Error(error.message);
        const setError = await saveSetsForLog(supabase, {
          teamId: profile.team_id,
          authorId: profile.id,
          logId: (saved as { id: string }).id,
          date,
          blocks,
        });
        if (setError) throw new Error(setError);
      }

      if (sendMemo) await saveMemo();

      await load(true);
      setNotice("日報を提出しました。おつかれさまでした！");
      notifyTasksChanged();
      await onSubmitted?.();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "提出に失敗しました。");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  async function saveMemo() {
    const { error } = await supabase.from("personal_memos").upsert(
      {
        id: memoId ?? undefined,
        team_id: profile.team_id,
        author_id: profile.id,
        date,
        content: memo.slice(0, 20),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "author_id,date" }
    );
    if (error) throw new Error(error.message);
  }

  // 提出済みのマット報告を直す（実施⇔未実施の切り替えもできる）
  async function handleUpdateReport(r: MyReport) {
    const d = draftOf(r.menu_id);
    if (d.mode === "report" && !d.text.trim()) return;
    if (d.mode === "absent" && (!d.reason.trim() || !d.altType || !d.alt.trim()))
      return;
    setSubmitting(true);
    const payload =
      d.mode === "report"
        ? { kind: "report", text: d.text.trim(), alt_type: null }
        : {
            kind: "absent",
            text: absentText(d.reason, d.altType!, d.alt),
            alt_type: d.altType,
          };
    const { error } = await supabase
      .from("comments")
      .update(payload)
      .eq("id", r.id);
    setSubmitting(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    await load(true);
    setNotice("報告を修正しました。");
    notifyTasksChanged();
    await onSubmitted?.();
  }

  function startEditReport(r: MyReport) {
    const parsed = r.kind === "absent" ? parseAbsentText(r.text) : null;
    setMatDrafts((prev) => ({
      ...prev,
      [r.menu_id]: {
        mode: r.kind,
        text: r.kind === "report" ? r.text : "",
        reason: parsed?.reason ?? "",
        altType: r.alt_type,
        alt: parsed?.alt ?? "",
      },
    }));
    setEditingReportId(r.id);
  }

  async function handleUpdateTraining() {
    if (!training.type || (!training.content.trim() && !blocksHaveData(blocks))) {
      setMissing(["トレーニング：種類と、種目の記録か内容を入力してください"]);
      return;
    }
    if (training.startTime && training.startTime < "06:00") {
      setMissing(["トレーニング：開始時間はその日の6時以降で入力してください"]);
      return;
    }
    setSubmitting(true);
    const title = training.title.trim();
    const { error } = await supabase
      .from("weight_logs")
      .update({
        content: training.content.trim() || blocksSummaryText(blocks),
        type: training.type,
        title: title || null,
        start_time: training.startTime || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", log!.id);
    const setError = error
      ? null
      : await saveSetsForLog(supabase, {
          teamId: profile.team_id,
          authorId: profile.id,
          logId: log!.id,
          date,
          blocks,
        });
    setSubmitting(false);
    if (error || setError) {
      setErrorMsg(error?.message ?? setError);
      return;
    }
    await load(true);
    setNotice("トレーニングの報告を修正しました。");
    await onSubmitted?.();
  }

  // タイトル候補から消す：自分の記録に付いているそのタイトルを外す（記録そのものは残る）
  async function handleRemoveTitle(type: TrainingType, title: string) {
    setSubmitting(true);
    const { error } = await supabase
      .from("weight_logs")
      .update({ title: null })
      .eq("author_id", profile.id)
      .eq("type", type)
      .eq("title", title);
    setSubmitting(false);
    setRemovingTitle(null);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (training.title.trim() === title) updateTraining({ title: "" });
    await onTitlesChanged?.();
  }

  // 前回の同じ種類（タイトルを選んでいれば同じタイトル）の記録を本文にコピーする
  async function handleCopyPrevious() {
    if (!training.type) return;
    setCopying(true);
    let query = supabase
      .from("weight_logs")
      .select("id, content, title, date")
      .eq("author_id", profile.id)
      .eq("type", training.type)
      .lt("date", date)
      .order("date", { ascending: false })
      .limit(1);
    if (training.title.trim()) query = query.eq("title", training.title.trim());
    const { data } = await query;
    setCopying(false);
    const prev = (data ?? [])[0] as
      | { id: string; content: string; title: string | null; date: string }
      | undefined;
    if (!prev) {
      setMissing(["コピーできる前回の記録がありません。"]);
      return;
    }
    const prevBlocks = await loadSetsForLog(supabase, prev.id);
    if (prevBlocks.length > 0) setBlocks(prevBlocks);
    updateTraining({
      content: prev.content === blocksSummaryText(prevBlocks) ? "" : prev.content,
      title: training.title.trim() ? training.title : (prev.title ?? ""),
    });
  }

  function jumpToBoard(m: DayMenu) {
    try {
      sessionStorage.setItem(
        "jumpTo",
        JSON.stringify({
          location: m.location,
          date: m.date,
          startTime: m.start_time,
        })
      );
    } catch {
      // 保存できなくても、練習予定表を開くだけにする
    }
    router.push("/board");
  }

  // ---- 表示 ----

  const dayComplete =
    !loading &&
    pendingMenus.length === 0 &&
    (!trainingRequired || !!log) &&
    (openMenus.length > 0 || !!log);
  const trainingTouched =
    !log &&
    (!!training.type ||
      training.content.trim() !== "" ||
      training.title.trim() !== "" ||
      blocks.length > 0);
  const hasOptionalToSubmit = trainingTouched || memo.slice(0, 20) !== memoSaved;

  const inputCls =
    "rounded border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-2 py-1.5 text-sm text-neutral-900 dark:text-neutral-100";
  const labelCls =
    "flex flex-col gap-1 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400";

  function renderMatForm(menuId: string, editingReport?: MyReport) {
    const d = draftOf(menuId);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => updateDraft(menuId, { mode: "report" })}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ${
              d.mode === "report"
                ? "bg-emerald-600 text-white"
                : "border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
            }`}
          >
            実施した
          </button>
          <button
            type="button"
            onClick={() => updateDraft(menuId, { mode: "absent" })}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-medium ${
              d.mode === "absent"
                ? "bg-neutral-600 text-white"
                : "border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
            }`}
          >
            実施できなかった
          </button>
        </div>
        {d.mode === "report" && (
          <textarea
            value={d.text}
            onChange={(e) => updateDraft(menuId, { text: e.target.value })}
            placeholder="今日の練習の振り返り（できたこと・課題・気づきなど）"
            rows={4}
            className="rounded-lg border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100"
          />
        )}
        {d.mode === "absent" && (
          <>
            <label className={labelCls}>
              理由
              <input
                type="text"
                value={d.reason}
                onChange={(e) => updateDraft(menuId, { reason: e.target.value })}
                placeholder="例：授業・病院・出稽古など"
                className={inputCls}
              />
            </label>
            <div className={labelCls}>
              代替メニューの種類
              <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 text-xs">
                {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => updateDraft(menuId, { altType: t })}
                    className={`flex-1 rounded-md py-2 font-medium ${
                      d.altType === t
                        ? "bg-red-600 text-white shadow"
                        : "text-neutral-600 dark:text-neutral-400"
                    }`}
                  >
                    {trainingTypeLabel[t]}
                  </button>
                ))}
              </div>
            </div>
            <label className={labelCls}>
              代替メニューの詳細
              <textarea
                value={d.alt}
                onChange={(e) => updateDraft(menuId, { alt: e.target.value })}
                rows={3}
                className={inputCls}
              />
            </label>
          </>
        )}
        {editingReport && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleUpdateReport(editingReport)}
              disabled={submitting || !d.mode}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
            >
              修正を保存する
            </button>
            <button
              type="button"
              onClick={() => setEditingReportId(null)}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300"
            >
              やめる
            </button>
          </div>
        )}
      </div>
    );
  }

  function renderSubmittedReport(m: DayMenu, r: MyReport) {
    const myReplies = replies.filter((c) => c.parent_id === r.id);
    if (editingReportId === r.id) return renderMatForm(m.id, r);
    return (
      <div className="flex flex-col gap-2">
        <div
          className={`rounded-lg border p-3 ${
            r.kind === "report"
              ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30"
              : "border-neutral-300 dark:border-neutral-700 bg-neutral-100 dark:bg-neutral-800"
          }`}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span
              className={`rounded px-1.5 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold text-white ${
                r.kind === "report" ? "bg-emerald-600" : "bg-neutral-600"
              }`}
            >
              {commentKindLabel[r.kind]}・提出済み
            </span>
            <button
              type="button"
              onClick={() => startEditReport(r)}
              className="text-[length:calc(11px+var(--fs-add))] font-medium text-neutral-600 dark:text-neutral-400 active:text-neutral-800 dark:active:text-neutral-200"
            >
              修正する
            </button>
          </div>
          <p className="whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100">{r.text}</p>
        </div>
        <ReactionBar
          commentId={r.id}
          reactions={reactions}
          profileId={profile.id}
          teamId={profile.team_id}
          supabase={supabase}
          onChanged={reloadReactions}
          readOnly
        />
        {myReplies.length > 0 && (
          <ul className="flex flex-col gap-1.5 border-l-2 border-neutral-300 dark:border-neutral-700 pl-3">
            {myReplies.map((c) => (
              <li key={c.id} className="rounded-lg bg-neutral-50 dark:bg-neutral-900 p-2">
                <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                  {c.author ? `${roleLabel[c.author.role]}・${c.author.display_name}` : "不明"}
                  　{formatDateTime(c.created_at)}
                </p>
                <p className="whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100">{c.text}</p>
              </li>
            ))}
          </ul>
        )}
        {!isPopup && (
          <button
            type="button"
            onClick={() => jumpToBoard(m)}
            className="self-start text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline decoration-dotted"
          >
            練習予定表でみんなの日報を見る ›
          </button>
        )}
      </div>
    );
  }

  function renderTrainingForm() {
    const type = training.type;
    const activeColor = type ? titleColors[type].get(training.title.trim()) : undefined;
    return (
      <div className="flex flex-col gap-2">
        <div className="flex gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-1 text-xs">
          {(Object.keys(trainingTypeLabel) as TrainingType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => updateTraining({ type: t })}
              className={`flex-1 rounded-md py-2 font-medium ${
                type === t ? "bg-red-600 text-white shadow" : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {trainingTypeLabel[t]}
            </button>
          ))}
        </div>
        {type && (
          <>
            <div className="flex gap-2">
              <label className={`${labelCls} w-28 shrink-0`}>
                開始時間
                <input
                  type="time"
                  min="06:00"
                  max="23:59"
                  value={training.startTime}
                  onChange={(e) => updateTraining({ startTime: e.target.value })}
                  className={inputCls}
                />
              </label>
              <label className={`${labelCls} min-w-0 flex-1`}>
                タイトル
                <input
                  type="text"
                  list={`${variant}-${type}-title-options`}
                  value={training.title}
                  onChange={(e) => updateTraining({ title: e.target.value })}
                  placeholder="例：BIG3、インターバル走"
                  className={inputCls}
                />
                <datalist id={`${variant}-${type}-title-options`}>
                  {titleOptions[type].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
            </div>
            {titleOptions[type].length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {titleOptions[type].map((t) => {
                  const c = titleColors[type].get(t);
                  const selected = training.title.trim() === t;
                  if (titleEditMode) {
                    return removingTitle === t ? (
                      <span
                        key={t}
                        className="flex items-center gap-1.5 rounded-full border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-red-800 dark:text-red-200"
                      >
                        「{t}」を候補から消す？
                        <button
                          type="button"
                          disabled={submitting}
                          onClick={() => handleRemoveTitle(type, t)}
                          className="font-bold text-red-700 dark:text-red-400"
                        >
                          消す
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemovingTitle(null)}
                          className="text-neutral-600 dark:text-neutral-400"
                        >
                          やめる
                        </button>
                      </span>
                    ) : (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setRemovingTitle(t)}
                        className="flex items-center gap-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-600 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300"
                      >
                        {t}
                        <span className="text-red-700 dark:text-red-400">✕</span>
                      </button>
                    );
                  }
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => updateTraining({ title: t })}
                      className={`rounded-full border px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] font-medium ${
                        selected
                          ? `${c?.border ?? "border-neutral-300 dark:border-neutral-600"} ${c?.fill ?? "bg-neutral-100 dark:bg-neutral-800"} ${c?.text ?? "text-neutral-800 dark:text-neutral-200"}`
                          : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 active:bg-neutral-100 dark:active:bg-neutral-800"
                      }`}
                    >
                      {c && (
                        <span
                          className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${c.dot}`}
                        />
                      )}
                      {t}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setTitleEditMode((v) => !v);
                    setRemovingTitle(null);
                  }}
                  className="text-[length:calc(10px+var(--fs-add))] text-neutral-500 underline decoration-dotted"
                >
                  {titleEditMode ? "整理を終える" : "候補を整理"}
                </button>
              </div>
            )}
            {titleEditMode && (
              <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                ✕を押すと、そのタイトルを候補から消します（過去の記録の中身は消えず、タイトルだけ外れます）。
              </p>
            )}
          </>
        )}
        {type && (
          <SetLogger
            supabase={supabase}
            profile={profile}
            date={date}
            blocks={blocks}
            onChange={(next) => {
              setBlocks(next);
              setMissing([]);
            }}
          />
        )}
        {type && (
          <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
            メモ・その他の内容{blocksHaveData(blocks) ? "（任意）" : ""}
          </span>
        )}
        <textarea
          value={training.content}
          onChange={(e) => updateTraining({ content: e.target.value })}
          placeholder={
            "例：\nBP\n60・80・90・100\n110kg×7、3\n\nトレーニングしながら、その場でメモしていってOKです"
          }
          rows={blocksHaveData(blocks) ? 3 : isPopup ? 6 : 8}
          className={`rounded-lg border px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 ${
            activeColor
              ? `${activeColor.border} ${activeColor.fill}`
              : "border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
          }`}
        />
        {type && (
          <button
            type="button"
            onClick={handleCopyPrevious}
            disabled={copying}
            className="self-start rounded border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800 disabled:opacity-50"
          >
            {copying
              ? "読み込み中…"
              : training.title.trim()
                ? `前回の「${training.title.trim()}」を丸ごとコピー`
                : `前回の${trainingTypeLabel[type]}を丸ごとコピー`}
          </button>
        )}
        {editingTraining && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleUpdateTraining}
              disabled={submitting}
              className="rounded-lg bg-red-600 px-3 py-2 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
            >
              修正を保存する
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingTraining(false);
                setBlocks(savedBlocks);
                if (log)
                  setTraining({
                    type: log.type,
                    startTime: log.start_time ? log.start_time.slice(0, 5) : "",
                    title: log.title ?? "",
                    content:
                      log.content === blocksSummaryText(savedBlocks) ? "" : log.content,
                  });
              }}
              className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300"
            >
              やめる
            </button>
          </div>
        )}
        {!isPopup && type === "running" && !training.title.trim() && (
          <RecentTypeLogs
            supabase={supabase}
            authorId={profile.id}
            excludeDate={date}
            type="running"
            label="直近のランメニュー"
          />
        )}
        {!isPopup && type && training.title.trim() && (
          <RecentTypeLogs
            supabase={supabase}
            authorId={profile.id}
            excludeDate={date}
            type={type}
            title={training.title.trim()}
            label={`直近の${training.title.trim()}`}
          />
        )}
      </div>
    );
  }

  // ---- 案A：1日のタイムライン ----
  type TimelineItem = {
    key: string;
    time: string | null;
    kind: "mat" | "training";
    done: boolean;
    upcoming: boolean;
    menu?: DayMenu;
  };
  const firstNonMatTime = nonMatSessions.find((s) => s.start_time)?.start_time ?? null;
  const timeline: TimelineItem[] = [
    ...menus.map((m) => ({
      key: `mat-${m.id}`,
      time: m.start_time,
      kind: "mat" as const,
      done: reportByMenu.has(m.id),
      upcoming: !isMenuOpen(m),
      menu: m,
    })),
    {
      key: "training",
      time: firstNonMatTime,
      kind: "training" as const,
      done: !!log,
      upcoming: false,
    },
  ].sort((a, b) => {
    const ta = a.time ?? (a.kind === "training" ? "99:99" : "00:00");
    const tb = b.time ?? (b.kind === "training" ? "99:99" : "00:00");
    return ta.localeCompare(tb);
  });
  const remaining =
    (exempt ? 0 : pendingMenus.length) + (trainingRequired && !log ? 1 : 0);

  function isExpanded(item: TimelineItem) {
    if (item.key in expanded) return expanded[item.key];
    // 提出済み・開始前は閉じた状態、残っているものは開いた状態から始める
    return !item.done && !item.upcoming;
  }
  function toggle(item: TimelineItem) {
    setExpanded((prev) => ({ ...prev, [item.key]: !isExpanded(item) }));
  }

  function itemTitle(item: TimelineItem) {
    if (item.kind === "mat" && item.menu) {
      const place = item.menu.is_joint
        ? `全体練習・${locationLabel[item.menu.location]}`
        : locationLabel[item.menu.location];
      return { icon: "🤼", title: "マット練習", sub: place };
    }
    const types = nonMatSessions.map((s) => sessionTypeLabel[s.session_type]);
    const icon = log?.type === "running" || (!log && nonMatSessions[0]?.session_type === "running") ? "🏃" : "🏋️";
    return {
      icon,
      title: "トレーニング",
      sub: log
        ? `${trainingTypeLabel[log.type]}${log.title ? `・${log.title}` : ""}`
        : types.length > 0
          ? Array.from(new Set(types)).join("・")
          : "任意（自主トレをした日に）",
    };
  }

  function itemStatus(item: TimelineItem) {
    if (item.done) return { text: "✓ 提出済み", cls: "bg-emerald-600 text-white" };
    if (item.upcoming) return { text: "開始前", cls: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400" };
    if (item.kind === "training" && !trainingRequired)
      return { text: "任意", cls: "bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400" };
    if (exempt) return { text: "免除", cls: "bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300" };
    return { text: "未提出", cls: "bg-red-600 text-white" };
  }

  function renderItemBody(item: TimelineItem) {
    if (item.kind === "mat" && item.menu) {
      const m = item.menu;
      const r = reportByMenu.get(m.id);
      if (item.upcoming) {
        return (
          <p className="text-xs text-neutral-500">
            開始時刻（{m.start_time?.slice(0, 5)}）を過ぎると報告できるようになります。
          </p>
        );
      }
      return (
        <div className="flex flex-col gap-2">
          {m.content ? (
            <details
              className="rounded-lg bg-neutral-100 dark:bg-neutral-800 px-3 py-2 text-xs text-neutral-700 dark:text-neutral-300"
              open={!r && !isPopup}
            >
              <summary className="cursor-pointer text-neutral-600 dark:text-neutral-400">今日のメニュー</summary>
              <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100">{m.content}</p>
            </details>
          ) : (
            <p className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
              メニューは未記入です。やった内容を自分の言葉で書いてください。
            </p>
          )}
          {r ? renderSubmittedReport(m, r) : renderMatForm(m.id)}
        </div>
      );
    }
    // トレーニング
    return log && !editingTraining ? (
      <div className="flex flex-col gap-2">
        <div className="rounded-lg border border-sky-200 dark:border-sky-900/60 bg-sky-50 dark:bg-sky-950/30 p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[length:calc(11px+var(--fs-add))] font-semibold text-sky-700 dark:text-sky-300">
              {trainingTypeLabel[log.type]}
              {log.title ? `・${log.title}` : ""}
              {log.start_time ? `（${log.start_time.slice(0, 5)}〜）` : ""}
            </span>
            <button
              type="button"
              onClick={() => setEditingTraining(true)}
              className="text-[length:calc(11px+var(--fs-add))] font-medium text-neutral-600 dark:text-neutral-400 active:text-neutral-800 dark:active:text-neutral-200"
            >
              修正する
            </button>
          </div>
          <SetSummary blocks={savedBlocks} />
          {log.content && log.content !== blocksSummaryText(savedBlocks) && (
            <p
              className={`whitespace-pre-wrap text-sm text-neutral-900 dark:text-neutral-100 ${
                savedBlocks.length > 0 ? "mt-2 border-t border-sky-200 dark:border-sky-900/50 pt-2" : ""
              }`}
            >
              {log.content}
            </p>
          )}
        </div>
        {!isPopup && <TrainingCommentThread weightLogId={log.id} profile={profile} />}
      </div>
    ) : (
      renderTrainingForm()
    );
  }

  // 週の帯（月曜はじまり）
  const [dy, dm, dd] = date.split("-").map(Number);
  const dObj = new Date(dy, dm - 1, dd);
  const weekStartStr = shiftDate(date, -((dObj.getDay() + 6) % 7));
  const weekDays = Array.from({ length: 7 }, (_, i) => shiftDate(weekStartStr, i));
  const pendingSet = new Set(pendingDates);

  return (
    <div className="flex flex-col gap-4">
      {!isPopup && onDateChange && (
        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-2">
            <div className="flex flex-col">
              <span className="text-lg font-bold text-foreground">
                {formatMonthDayWeek(date)}の日報
              </span>
              {!loading && !isFuture && (
                <span
                  className={`text-xs font-semibold ${
                    remaining > 0 ? "text-red-700 dark:text-red-400" : dayComplete ? "text-emerald-700 dark:text-emerald-400" : "text-neutral-500"
                  }`}
                >
                  {remaining > 0
                    ? `あと${remaining}件`
                    : dayComplete
                      ? "この日はすべて提出済み"
                      : "提出が必要な練習はありません"}
                </span>
              )}
            </div>
            {date !== todayStr && (
              <button
                type="button"
                onClick={() => onDateChange(todayStr)}
                className="rounded-full border border-neutral-300 dark:border-neutral-700 px-2.5 py-1 text-[length:calc(11px+var(--fs-add))] text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
              >
                今日へ
              </button>
            )}
          </div>

          {/* 週の帯：●提出済み ○未提出 */}
          <div className="flex items-stretch gap-1">
            <button
              type="button"
              onClick={() => onDateChange(shiftDate(date, -7))}
              aria-label="前の週"
              className="w-6 shrink-0 rounded text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800"
            >
              ‹
            </button>
            {weekDays.map((d) => {
              const [, , day] = d.split("-").map(Number);
              const w = "月火水木金土日"[weekDays.indexOf(d)];
              const future = d > todayStr;
              const selected = d === date;
              const pending = pendingSet.has(d);
              const submitted = weekSubmitted.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={future}
                  onClick={() => onDateChange(d)}
                  className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 ${
                    selected
                      ? "bg-red-600 text-white"
                      : "bg-neutral-50 dark:bg-neutral-900 text-neutral-700 dark:text-neutral-300 active:bg-neutral-100 dark:active:bg-neutral-800"
                  } disabled:opacity-30`}
                >
                  <span
                    className={`text-[length:calc(9px+var(--fs-add))] ${
                      selected ? "text-white/80" : w === "日" ? "text-red-700 dark:text-red-400" : w === "土" ? "text-sky-700 dark:text-sky-400" : "text-neutral-500"
                    }`}
                  >
                    {w}
                  </span>
                  <span className={`text-sm font-bold ${d === todayStr && !selected ? "underline" : ""}`}>
                    {day}
                  </span>
                  <span className="h-2 text-[8px] leading-none">
                    {pending ? (
                      <span className={selected ? "text-white" : "text-red-700 dark:text-red-400"}>○</span>
                    ) : submitted ? (
                      <span className={selected ? "text-white" : "text-emerald-700 dark:text-emerald-400"}>●</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                const next = shiftDate(date, 7);
                onDateChange(next > todayStr ? todayStr : next);
              }}
              disabled={shiftDate(weekStartStr, 7) > todayStr}
              aria-label="次の週"
              className="w-6 shrink-0 rounded text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800 disabled:opacity-30"
            >
              ›
            </button>
          </div>
          {pendingDates.filter((d) => d < weekStartStr).length > 0 && (
            <button
              type="button"
              onClick={() => onDateChange(pendingDates.filter((d) => d < weekStartStr)[0])}
              className="self-start text-[length:calc(11px+var(--fs-add))] text-red-700 dark:text-red-400 underline decoration-dotted"
            >
              前の週にも未提出があります（{pendingDates.filter((d) => d < weekStartStr).length}日）
            </button>
          )}
        </div>
      )}

      {errorMsg && (
        <p className="rounded bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-400">{errorMsg}</p>
      )}
      {notice && (
        <p className="rounded bg-emerald-50 dark:bg-emerald-950/40 p-2 text-xs text-emerald-700 dark:text-emerald-400">{notice}</p>
      )}

      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : isFuture ? (
        <p className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs text-neutral-500">
          まだ来ていない日の日報は書けません。
        </p>
      ) : (
        <>
          {exempt && (
            <p className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 p-3 text-[length:calc(12px+var(--fs-add))] text-amber-700 dark:text-amber-300">
              この日は管理者により免除されています。日報の提出は不要です（書いた分は記録として残ります）。
            </p>
          )}
          {menus.length === 0 && isOffDay && (
            <p className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs text-neutral-500">
              この日はオフです。自主トレをした場合は、トレーニングに記録できます。
            </p>
          )}

          {/* タイムライン */}
          <ol className="relative flex flex-col gap-3">
            <span
              aria-hidden
              className="absolute bottom-3 left-[2.4rem] top-3 w-px bg-neutral-200 dark:bg-neutral-700"
            />
            {timeline.map((item) => {
              const t = itemTitle(item);
              const st = itemStatus(item);
              const open = isExpanded(item);
              return (
                <li key={item.key} className="relative flex gap-3">
                  <div className="flex w-[2rem] shrink-0 flex-col items-end pt-3">
                    <span className="text-[length:calc(10px+var(--fs-add))] font-semibold text-neutral-600 dark:text-neutral-400">
                      {item.time ? item.time.slice(0, 5) : "—"}
                    </span>
                  </div>
                  <span
                    aria-hidden
                    className={`relative z-10 mt-[0.95rem] h-3 w-3 shrink-0 rounded-full border-2 ${
                      item.done
                        ? "border-emerald-500 bg-emerald-500"
                        : item.upcoming || (item.kind === "training" && !trainingRequired)
                          ? "border-neutral-300 dark:border-neutral-600 bg-background"
                          : "border-red-500 bg-background"
                    }`}
                  />
                  <div
                    className={`min-w-0 flex-1 overflow-hidden rounded-xl border ${
                      item.done
                        ? "border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60"
                        : item.upcoming
                          ? "border-dashed border-neutral-200 dark:border-neutral-800 bg-transparent"
                          : "border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(item)}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
                    >
                      <span className="text-lg leading-none">{t.icon}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{t.title}</span>
                        <span className="truncate text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                          {t.sub}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[length:calc(10px+var(--fs-add))] font-semibold ${st.cls}`}
                      >
                        {st.text}
                      </span>
                      <span className="shrink-0 text-neutral-500">{open ? "▴" : "▾"}</span>
                    </button>
                    {open && (
                      <div className="border-t border-neutral-200 dark:border-neutral-800 px-3 pb-3 pt-2.5">
                        {renderItemBody(item)}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* 一言メモ（自分だけ） */}
          {!isPopup && (
            <section className="flex flex-col gap-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-neutral-600 dark:text-neutral-400">
                  📝 一言メモ（体調など・自分だけが見られます）
                </label>
                <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                  {memo.length}/20
                </span>
              </div>
              <input
                type="text"
                value={memo}
                maxLength={20}
                onChange={(e) => setMemo(e.target.value.slice(0, 20))}
                placeholder="例：体調良好、右膝に違和感 など"
                className={inputCls}
              />
            </section>
          )}

          {/* 提出（画面の下に固定） */}
          {dayComplete && !hasOptionalToSubmit ? (
            <p className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-center text-sm font-semibold text-emerald-700 dark:text-emerald-400">
              ✓ この日の日報はすべて提出済みです
            </p>
          ) : (
            <div
              className={`${isPopup ? "" : "sticky z-20"} flex flex-col gap-2 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-background/95 p-2 shadow-[0_-4px_12px_rgba(0,0,0,0.35)] backdrop-blur`}
              style={isPopup ? undefined : { bottom: "calc(144px + env(safe-area-inset-bottom))" }}
            >
              {missing.length > 0 && (
                <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 p-2 text-[length:calc(11px+var(--fs-add))] text-red-700 dark:text-red-300">
                  {missing.map((p) => (
                    <li key={p}>・{p}</li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || editingTraining || !!editingReportId}
                className="w-full rounded-lg bg-emerald-600 py-3 text-sm font-bold text-white active:bg-emerald-700 disabled:opacity-50"
              >
                {submitting
                  ? "提出中…"
                  : remaining > 0
                    ? `あと${remaining}件 ― 日報を提出する`
                    : dayComplete
                      ? "追加分を提出する"
                      : "日報を提出する"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
