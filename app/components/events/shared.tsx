"use client";

import { useEffect, useState } from "react";
import { useProfile, } from "../shell/AppShell";
import {
  type QueueTask,
} from "../TaskQueuePopup";
import {
  type EventPendingTask,
} from "../shell/useMyEventPendingTasks";
import { createClient } from "../../lib/supabase/client";
import {
  currentGrade,
  Location,
  locationLabel,
  } from "../../lib/types";


// イベントページで共通に使う型・部品・関数

export type EventTab = "weight_max" | "body_composition" | "match_reflection";

export const tabLabel: Record<EventTab, string> = {
  weight_max: "ウェイトMAX",
  body_composition: "体組成",
  match_reflection: "試合の振り返り",
};

export const matchResultOptions = [
  "優勝",
  "準優勝",
  "3位",
  "4位",
  "5位",
  "ベスト16",
  "ベスト32",
  "3回戦敗退",
  "2回戦敗退",
  "1回戦敗退",
];

export function formatMonthDay(dateStr: string) {
  const [, m, d] = (dateStr ?? "").split("-").map(Number);
  if (!m || !d) return dateStr;
  return `${m}月${d}日`;
}

export type WeightMaxEventRow = {
  id: string;
  deadline: string;
  created_at: string;
  closed_at: string | null;
};

export type TeamEventRow = {
  id: string;
  type: "match_reflection" | "body_composition";
  title: string;
  deadline: string;
  closed_at: string | null;
};

export type SubmissionRow = {
  id: string;
  event_id: string;
  updated_at: string;
  match_result: string | null;
  match_title: string | null;
  match_count: number | null;
  win_count: number | null;
  loss_count: number | null;
  reflection: string | null;
  good_points: string | null;
  challenges: string | null;
  improvement_plan: string | null;
  team_challenges: string | null;
  measurement_date: string | null;
  weight_kg: number | null;
  body_fat_pct: number | null;
  muscle_mass_kg: number | null;
  lean_body_mass_kg: number | null;
};

export type EventCommentRow = {
  id: string;
  submission_id: string;
  author_id: string;
  text: string;
  created_at: string;
};

// イベントの提出内容（試合の振り返りなど）に対するコメントスレッド。
// コーチ・本人どちらからもコメントでき、お互いのフィードバックに使える。
export function CommentThread({
  submissionId,
  profile,
  members,
}: {
  submissionId: string;
  profile: ReturnType<typeof useProfile>["profile"];
  members: EventMemberRow[];
}) {
  const supabase = createClient();
  const [comments, setComments] = useState<EventCommentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("team_event_comments")
      .select("id, submission_id, author_id, text, created_at")
      .eq("submission_id", submissionId)
      .order("created_at", { ascending: true });
    if (error) setErrorMsg(error.message);
    setComments((data ?? []) as EventCommentRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId]);

  async function handlePost() {
    if (!text.trim()) return;
    setPosting(true);
    const { error } = await supabase.from("team_event_comments").insert({
      submission_id: submissionId,
      team_id: profile.team_id,
      author_id: profile.id,
      text: text.trim(),
    });
    if (error) {
      setErrorMsg(error.message);
    } else {
      setText("");
      await load();
    }
    setPosting(false);
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-color pt-2">
      <p className="text-[length:calc(11px+var(--fs-add))] font-semibold text-neutral-500 dark:text-neutral-400">
        コメント
      </p>
      {loading ? (
        <p className="text-xs text-neutral-500">読み込み中…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-neutral-500">まだコメントはありません。</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {comments.map((c) => {
            const name =
              c.author_id === profile.id
                ? "自分"
                : members.find((m) => m.id === c.author_id)?.display_name ??
                  "（不明な部員）";
            return (
              <div
                key={c.id}
                className="rounded-lg border border-border-color bg-background p-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{name}</span>
                  <span className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
                    {formatMonthDay(c.created_at.slice(0, 10))}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-neutral-700 dark:text-neutral-200">
                  {c.text}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {errorMsg && (
        <p className="rounded bg-red-950/40 p-2 text-[length:calc(11px+var(--fs-add))] text-red-400">
          {errorMsg}
        </p>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="コメントを入力"
          className="flex-1 rounded-lg border border-border-color bg-background px-2 py-1.5 text-xs text-foreground"
        />
        <button
          onClick={handlePost}
          disabled={posting || !text.trim()}
          className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white active:bg-red-700 disabled:opacity-50"
        >
          送信
        </button>
      </div>
    </div>
  );
}

export type BodyCompositionSubmissionRow = SubmissionRow & { author_id: string };

export type MatchSubmissionRow = {
  id: string;
  author_id: string;
  updated_at: string;
  match_result: string | null;
  match_title: string | null;
  match_count: number | null;
  win_count: number | null;
  loss_count: number | null;
  reflection: string | null;
  good_points: string | null;
  challenges: string | null;
  improvement_plan: string | null;
  team_challenges: string | null;
};

// 体組成専用のタブ。体組成は「前回比」を表示しない代わりに、記録が増えても
// 見づらくならないよう計測日ごとにまとめ、タップで詳細を開閉できるようにする。
export type EventMemberRow = {
  id: string;
  display_name: string;
  home_location: Location | null;
  role: string;
  entry_year: number | null;
};

// 「全員の数値」表示の並び順：自分を一番上、その下は学年が上の人から
// （同学年内は多摩→大塚の順）。学年が分からない場合は一番下に回す。
export function sortForAllView<T extends EventMemberRow>(
  members: T[],
  selfId: string
): T[] {
  const grade = (m: T) => (m.entry_year != null ? currentGrade(m.entry_year) : -1);
  const locRank = (m: T) => (m.home_location === "otsuka" ? 1 : 0);
  return [...members].sort((a, b) => {
    if (a.id === selfId) return -1;
    if (b.id === selfId) return 1;
    const gradeDiff = grade(b) - grade(a);
    if (gradeDiff !== 0) return gradeDiff;
    const locDiff = locRank(a) - locRank(b);
    if (locDiff !== 0) return locDiff;
    return a.display_name.localeCompare(b.display_name, "ja");
  });
}

// 学年ラベル（不明な場合は「学年不明」）
export function gradeGroupLabel<T extends EventMemberRow>(m: T): string {
  return m.entry_year != null ? `${currentGrade(m.entry_year)}年` : "学年不明";
}

// 前回の記録との差分を「+2kg」「-1kg」の形に整形する（差が無ければ「±0kg」、
// 前回の記録が無ければnullを返し、呼び出し側で非表示にする）
export function formatDiff(
  current: number | null,
  previous: number | null | undefined
): { text: string; positive: boolean; zero: boolean } | null {
  if (current == null || previous == null) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return { text: "±0kg", positive: false, zero: true };
  return {
    text: `${diff > 0 ? "+" : ""}${diff}kg`,
    positive: diff > 0,
    zero: false,
  };
}

export type WeightMaxAuthorRow = {
  event_id: string;
  author_id: string;
  bench: number | null;
  squat: number | null;
  deadlift: number | null;
};

// events は created_at 降順（0番目が最新）。著者ごとに提出をidx昇順で並べておき、
// 「あるイベント(idx)より後ろ（＝より過去）で、そのリフトの値がある直近の提出」を
// 前回の記録として引けるようにする。
export function buildPrevValueLookup(
  events: WeightMaxEventRow[],
  rows: WeightMaxAuthorRow[]
): Map<string, { idx: number; row: WeightMaxAuthorRow }[]> {
  const eventIndexById = new Map(events.map((e, i) => [e.id, i]));
  const byAuthor = new Map<string, { idx: number; row: WeightMaxAuthorRow }[]>();
  for (const r of rows) {
    const idx = eventIndexById.get(r.event_id);
    if (idx == null) continue;
    const list = byAuthor.get(r.author_id) ?? [];
    list.push({ idx, row: r });
    byAuthor.set(r.author_id, list);
  }
  for (const list of byAuthor.values()) list.sort((a, b) => a.idx - b.idx);
  return byAuthor;
}

export function getPreviousValue(
  byAuthor: Map<string, { idx: number; row: WeightMaxAuthorRow }[]>,
  authorId: string,
  idx: number,
  lift: "bench" | "squat" | "deadlift"
): number | null {
  const list = byAuthor.get(authorId);
  if (!list) return null;
  for (const entry of list) {
    if (entry.idx > idx && entry.row[lift] != null) return entry.row[lift];
  }
  return null;
}

/**
 * 学年ごとに折りたたんで表示するための汎用リスト。
 * collapseByGradeがfalseならそのままrenderRowを並べるだけ、
 * trueなら学年ごとにグループ化し、タップで開閉できるアコーディオンにする。
 */
export function GradedMemberList<T extends EventMemberRow>({
  rows,
  collapseByGrade,
  renderRow,
}: {
  rows: T[];
  collapseByGrade: boolean;
  renderRow: (row: T) => React.ReactNode;
}) {
  const [openGrades, setOpenGrades] = useState<Set<string>>(new Set());

  if (!collapseByGrade) {
    return <div className="flex flex-col gap-1.5">{rows.map(renderRow)}</div>;
  }

  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const label = gradeGroupLabel(r);
    const list = groups.get(label) ?? [];
    list.push(r);
    groups.set(label, list);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {Array.from(groups.entries()).map(([label, groupRows]) => {
        const isOpen = openGrades.has(label);
        return (
          <div
            key={label}
            className="overflow-hidden rounded-lg border border-border-color"
          >
            <button
              type="button"
              onClick={() =>
                setOpenGrades((prev) => {
                  const next = new Set(prev);
                  if (next.has(label)) next.delete(label);
                  else next.add(label);
                  return next;
                })
              }
              className="flex w-full items-center justify-between bg-background px-3 py-2 text-xs font-semibold text-foreground"
            >
              <span>{label}</span>
              <span className="text-neutral-500 dark:text-neutral-400">
                {groupRows.length}人{isOpen ? " ▲" : " ▼"}
              </span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-1.5 p-2">
                {groupRows.map(renderRow)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function EventTargetPicker({
  members,
  selectedIds,
  onChange,
}: {
  members: EventMemberRow[];
  selectedIds: Set<string>;
  onChange: (ids: Set<string>) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 dark:text-neutral-400">
          対象者(選ばなければ全員が対象になります)
        </span>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-[length:calc(11px+var(--fs-add))] text-neutral-500 underline dark:text-neutral-400"
          >
            選択をクリア
          </button>
        )}
      </div>
      <div className="max-h-40 overflow-y-auto rounded border border-border-color bg-background p-2">
        <div className="flex flex-col gap-1">
          {members
            .filter(
              (m) => m.role !== "coach" && m.role !== "manager" && m.role !== "ob"
            )
            .map((m) => (
              <label
                key={m.id}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(m.id)}
                  onChange={(e) => {
                    const next = new Set(selectedIds);
                    if (e.target.checked) next.add(m.id);
                    else next.delete(m.id);
                    onChange(next);
                  }}
                  className="h-3.5 w-3.5"
                />
                {m.display_name}
                <span className="text-neutral-500 dark:text-neutral-500">
                  （{locationLabel[m.home_location ?? "tama"]}）
                </span>
              </label>
            ))}
        </div>
      </div>
    </div>
  );
}

export function useEventMembers(teamId: string) {
  const supabase = createClient();
  const [members, setMembers] = useState<EventMemberRow[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, home_location, role, entry_year")
        .eq("team_id", teamId);
      setMembers((data ?? []) as EventMemberRow[]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);
  return members;
}

export function buildEventQueueTask(
  type: EventTab,
  task: EventPendingTask,
  setTab: (t: EventTab) => void
): QueueTask {
  return {
    key: `event-${type}-${task.id}`,
    kind: "event",
    overdue: task.overdue,
    badgeLabel: `イベント：${tabLabel[type]} 未提出${
      task.overdue ? "（期限切れ）" : ""
    }`,
    title: task.title || `〜${formatMonthDay(task.deadline)}`,
    urgent: task.overdue,
    content: (close: () => void) => (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-neutral-400">
          締切：{formatMonthDay(task.deadline)}
        </p>
        <button
          onClick={() => {
            setTab(type);
            close();
          }}
          className="self-start rounded-lg bg-red-600 px-4 py-2 text-xs font-medium text-white active:bg-red-700"
        >
          {tabLabel[type]}タブへ移動して入力する
        </button>
      </div>
    ),
  };
}

