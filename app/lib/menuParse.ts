// これまでの自由記述のメニュー（例：「アップ 15分\n打ち込み 3分×4」）を、メニュー項目に変換する。
// 読み取れなかった量は空のまま（「量が未入力」）にし、本数の数え方は監督が確認するまで「未確認」にする。

import { emptyItem, type MenuCategory, type MenuItemDraft } from "./menuItems";

function normalize(s: string) {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[✕＊*]/g, "×")
    .replace(/(\d)\s*[xX]\s*(?=\d)/g, "$1×")
    .replace(/[ｍＭ]/g, "m")
    .replace(/ｋｍ|ＫＭ|ｋm/g, "km")
    .replace(/\s+/g, " ")
    .trim();
}

const categoryRules: [MenuCategory, RegExp][] = [
  ["cooldown", /ダウン|ストレッチ/],
  ["warmup", /アップ/],
  ["spar", /スパー|実戦|試合形式/],
  ["drill", /打ち込み|打込/],
  ["situational", /攻防|状況/],
  ["sprint", /ダッシュ|スプリント|シャトル/],
  ["run", /ラン|ジョグ|走|km/],
  ["conditioning", /補強|腕立て|腹筋|背筋|懸垂|ロープ|スクワット|サーキット|シコ|体幹|筋/],
  ["technique", /技術|技|寝技|崩し|返し|タックル/],
];

function categoryOf(s: string): MenuCategory {
  for (const [c, re] of categoryRules) if (re.test(s)) return c;
  return "other";
}

// 括弧の外にある区切り（、）で分ける
function splitOutsideParens(s: string, sep: string) {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "（" || ch === "(") depth++;
    if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

type Amount = Partial<MenuItemDraft> & { matched: string };

function findAmount(s: string, cat: MenuCategory): Amount | null {
  let m: RegExpMatchArray | null;
  // 3分×2ピリオド×4本 → 1本6分×4本
  if ((m = s.match(/(\d+)分(?:(\d+)秒)?[）)]?\s*×\s*(\d+)\s*(?:ピリオド|P)\s*×\s*(\d+)\s*本?/)))
    return { matched: m[0], amount_type: "timed", unit_seconds: (+m[1] * 60 + +(m[2] ?? 0)) * +m[3], sets: +m[4] };
  // 3分×4、30秒×5、1分30秒×3
  if ((m = s.match(/(\d+)(分|秒)(?:(\d+)秒)?[）)]?\s*×\s*(\d+)\s*(?:本|セット|ラウンド|R)?/)))
    return {
      matched: m[0],
      amount_type: "timed",
      unit_seconds: m[2] === "分" ? +m[1] * 60 + +(m[3] ?? 0) : +m[1],
      sets: +m[4],
    };
  if ((m = s.match(/(\d+)\s*(?:m|メートル)\s*×\s*(\d+)\s*本?/)))
    return { matched: m[0], amount_type: "distance", distance_m: +m[1], sets: +m[2] };
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*(?:km|キロ)(?:\s*×\s*(\d+)\s*本?)?/)))
    return { matched: m[0], amount_type: "distance", distance_m: Math.round(+m[1] * 1000), sets: m[2] ? +m[2] : 1 };
  if ((m = s.match(/(\d+)\s*(?:m|メートル)(?![a-z])(?:\s*×\s*(\d+)\s*本?)?/)))
    return { matched: m[0], amount_type: "distance", distance_m: +m[1], sets: m[2] ? +m[2] : 1 };
  if ((m = s.match(/(\d+(?:\.\d+)?)\s*時間/)))
    return { matched: m[0], amount_type: "total", total_seconds: Math.round(+m[1] * 3600) };
  if ((m = s.match(/(\d+)\s*回?\s*×\s*(\d+)\s*セット/)))
    return { matched: m[0], amount_type: "reps", reps: +m[1], sets: +m[2] };
  if ((m = s.match(/(\d+)\s*分(?:(\d+)秒)?/)))
    return { matched: m[0], amount_type: "total", total_seconds: +m[1] * 60 + +(m[2] ?? 0) };
  if ((m = s.match(/(\d+)\s*本/)))
    return cat === "spar" || cat === "drill" || cat === "situational"
      ? { matched: m[0], amount_type: "timed", sets: +m[1] }
      : { matched: m[0], amount_type: "distance", sets: +m[1] };
  if ((m = s.match(/×\s*(\d+)/)))
    return cat === "spar" || cat === "drill" || cat === "situational"
      ? { matched: m[0], amount_type: "timed", sets: +m[1] }
      : { matched: m[0], amount_type: "reps", reps: +m[1], sets: 1 };
  if ((m = s.match(/MAX/i))) return { matched: m[0], amount_type: "reps", reps: null, sets: 1 };
  if ((m = s.match(/(\d+)\s*回/))) return { matched: m[0], amount_type: "reps", reps: +m[1], sets: 1 };
  if ((m = s.match(/(\d+)$/))) return { matched: m[0], amount_type: "reps", reps: +m[1], sets: 1 };
  return null;
}

function parseSegment(raw: string, inherited: MenuCategory | null): MenuItemDraft | null {
  let s = normalize(raw).replace(/^[・\-●○◎*]+\s*|^\d+[.)．]\s*/, "").trim();
  if (!s || /^(休憩|夜[：:]|ミーティング)/.test(s)) return null;

  // 「技術：がぶり返し」のような見出し
  let prefix = "";
  const pm = s.match(/^([^：:（(]{1,8})[：:]\s*(.+)$/);
  if (pm) {
    prefix = pm[1].trim();
    s = pm[2].trim();
  }
  // ［通常］［重量級］
  let target: MenuItemDraft["target_group"] = "all";
  s = s.replace(/［(通常|重量級)］/g, (_, g: string) => {
    target = g === "重量級" ? "heavy" : "regular";
    return " ";
  });

  // 括弧の中は「注意点」に回す（時間だけが書かれていれば量として読む）
  const notes: string[] = [];
  const outside = s.replace(/[（(]([^）)]*)[）)]/g, (_, inner: string) => {
    notes.push(inner.trim());
    return " ";
  });
  // 種別は括弧の外で決める（「技術練習（テイクダウン中心）」がダウンにならないように）
  const cat =
    inherited ??
    (prefix && categoryOf(prefix) !== "other"
      ? categoryOf(prefix)
      : categoryOf(prefix + outside) !== "other"
        ? categoryOf(prefix + outside)
        : categoryOf(prefix + s));
  let amount = findAmount(outside, cat);
  const name0 = amount ? outside.replace(amount.matched, " ") : outside;
  // 「実戦形式（6分）×4」：括弧の中の時間を1本の時間として使う
  const timeNote = notes.findIndex((n) => /^\d+(分|秒)$/.test(n));
  if (timeNote >= 0 && (!amount || (amount.amount_type === "timed" && !amount.unit_seconds))) {
    const t = notes[timeNote].match(/^(\d+)(分|秒)$/)!;
    const sec = t[2] === "分" ? +t[1] * 60 : +t[1];
    amount = amount ? { ...amount, unit_seconds: sec } : { matched: "", amount_type: "total", total_seconds: sec };
    notes.splice(timeNote, 1);
  }
  let name = name0;
  name = name.replace(/[×\s]+$/, "").replace(/\s+/g, " ").trim();
  if (!name) name = prefix || s;
  // 「技術：〜」「補強：〜」は中身だけで分かるので見出しを省く。「スパー：スタンド」などは残す
  else if (prefix && !/^(技術|補強)$/.test(prefix)) name = `${prefix}：${name}`;

  const it = emptyItem(cat);
  it.name = name.slice(0, 40);
  it.note = notes.filter(Boolean).join("・").slice(0, 100);
  it.target_group = target;
  if (amount) {
    const { matched: _m, ...rest } = amount;
    Object.assign(it, rest);
  }
  return it;
}

export function parseMenuText(text: string): MenuItemDraft[] {
  const out: MenuItemDraft[] = [];
  for (const rawLine of text.split(/\n/)) {
    // 字下げした行は、前の項目の注意点
    if (/^[　 ]{1,}\S/.test(rawLine) && out.length > 0) {
      const last = out[out.length - 1];
      last.note = [last.note, normalize(rawLine)].filter(Boolean).join("・").slice(0, 100);
      continue;
    }
    for (const part of splitOutsideParens(rawLine, "→")) {
      for (const seg of splitOutsideParens(part, "、")) {
        // 「補強：腕立て50・腹筋50」→ 2つの項目に分ける（それぞれに数字があるときだけ）
        const pm = normalize(seg).match(/^([^：:（(]{1,8})[：:]\s*(.+)$/);
        const body = pm ? pm[2] : normalize(seg);
        const pieces = splitOutsideParens(body, "・");
        if (pieces.length > 1 && pieces.every((p) => /\d|MAX/i.test(p))) {
          const inh = pm ? categoryOf(pm[1]) : null;
          for (const p of pieces) {
            const it = parseSegment(p, inh && inh !== "other" ? inh : null);
            if (it) out.push(it);
          }
          continue;
        }
        const it = parseSegment(seg, null);
        if (it) out.push(it);
      }
    }
  }
  return out;
}
