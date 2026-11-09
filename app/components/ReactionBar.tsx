"use client";

import { useState } from "react";
import type { createClient } from "../lib/supabase/client";

type SupabaseBrowserClient = ReturnType<typeof createClient>;

// 日報（実施報告・未実施報告）に付けられるリアクション。
// コーチが全員に文章でコメントしなくても「見たよ」を返せるようにするためのもの。
export const REACTION_EMOJIS = ["👍", "🔥", "💪", "👏"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export type ReactionRow = {
  comment_id: string;
  author_id: string;
  emoji: string;
  author?: { display_name: string } | null;
};

/**
 * 指定した報告（comments.id）に付いたリアクションをまとめて読み込む。
 * テーブルがまだ作られていない環境では、エラーにせず「リアクションなし」として扱う。
 */
export async function loadReactions(
  supabase: SupabaseBrowserClient,
  commentIds: string[]
): Promise<ReactionRow[]> {
  if (commentIds.length === 0) return [];
  const { data, error } = await supabase
    .from("comment_reactions")
    .select(
      "comment_id, author_id, emoji, author:profiles!comment_reactions_author_id_fkey(display_name)"
    )
    .in("comment_id", commentIds);
  if (error) return [];
  return (data ?? []) as unknown as ReactionRow[];
}

/**
 * リアクションの表示と、押したときの付け外し。
 * 自分が押したものは色付きで表示し、もう一度押すと外れる。
 */
export default function ReactionBar({
  commentId,
  reactions,
  profileId,
  teamId,
  supabase,
  onChanged,
  readOnly = false,
}: {
  commentId: string;
  reactions: ReactionRow[];
  profileId: string;
  teamId: string;
  supabase: SupabaseBrowserClient;
  onChanged: () => void | Promise<void>;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const mine = reactions.filter(
    (r) => r.comment_id === commentId && r.author_id === profileId
  );
  const forThis = reactions.filter((r) => r.comment_id === commentId);

  async function toggle(emoji: ReactionEmoji) {
    if (busy || readOnly) return;
    setBusy(true);
    setErrorMsg(null);
    const already = mine.some((r) => r.emoji === emoji);
    const { error } = already
      ? await supabase
          .from("comment_reactions")
          .delete()
          .eq("comment_id", commentId)
          .eq("author_id", profileId)
          .eq("emoji", emoji)
      : await supabase.from("comment_reactions").insert({
          comment_id: commentId,
          author_id: profileId,
          team_id: teamId,
          emoji,
        });
    // 23505 = 連打などで同じリアクションがすでにある
    if (error && error.code !== "23505") {
      setErrorMsg("リアクションを保存できませんでした。");
    }
    await onChanged();
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {REACTION_EMOJIS.map((emoji) => {
          const users = forThis.filter((r) => r.emoji === emoji);
          const isMine = mine.some((r) => r.emoji === emoji);
          if (readOnly && users.length === 0) return null;
          return (
            <button
              key={emoji}
              type="button"
              disabled={busy || readOnly}
              onClick={() => toggle(emoji)}
              title={users
                .map((u) => u.author?.display_name ?? "")
                .filter(Boolean)
                .join("、")}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[length:calc(12px+var(--fs-add))] ${
                isMine
                  ? "border-red-500 bg-red-50 dark:bg-red-950/40 text-neutral-900 dark:text-neutral-100"
                  : "border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 active:bg-neutral-100 dark:active:bg-neutral-800"
              } disabled:cursor-default`}
            >
              <span>{emoji}</span>
              {users.length > 0 && (
                <span className="text-[length:calc(11px+var(--fs-add))] font-semibold">
                  {users.length}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {forThis.length > 0 && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-neutral-500">
          {Array.from(
            new Set(
              forThis.map((r) => r.author?.display_name).filter(Boolean)
            )
          ).join("、")}
          がリアクション
        </p>
      )}
      {errorMsg && (
        <p className="text-[length:calc(10px+var(--fs-add))] text-red-700 dark:text-red-400">
          {errorMsg}
        </p>
      )}
    </div>
  );
}
