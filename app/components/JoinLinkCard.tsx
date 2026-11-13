"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { liffUrl } from "../lib/liffConfig";

// 部員に配る「参加用のリンクとQRコード」（チームで1つ）。
// LINEで開く → 名簿から自分の名前を選ぶ → はじめての設定、の順に進む。
export default function JoinLinkCard() {
  const url = liffUrl("/welcome");
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    QRCode.toDataURL(url, { margin: 1, width: 360 })
      .then(setQr)
      .catch(() => setQr(null));
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("このリンクをコピーしてください", url);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-color bg-surface-2 p-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-semibold text-foreground">部員に送る参加リンク（全員共通）</span>
        <span className="text-[length:calc(11px+var(--fs-add))] text-neutral-500">
          LINEのグループなどでこのリンクを送るか、QRコードを読み取ってもらってください。LINEで開くと、下の名簿から自分の名前を選んで登録し、そのまま「はじめての設定」に進みます。
        </span>
      </div>
      <div className="flex items-center gap-3">
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qr} alt="参加用のQRコード" className="h-28 w-28 shrink-0 rounded-lg bg-white p-1" />
        ) : (
          <div className="h-28 w-28 shrink-0 rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <code className="break-all text-[length:calc(10px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">{url}</code>
          <button
            type="button"
            onClick={copy}
            className="self-start rounded-lg bg-[#06C755] px-3 py-2 text-xs font-bold text-white active:opacity-80"
          >
            {copied ? "コピーしました" : "リンクをコピー"}
          </button>
        </div>
      </div>
      <ol className="list-decimal pl-5 text-[length:calc(11px+var(--fs-add))] text-neutral-600 dark:text-neutral-400">
        <li>下の名簿に、部員の名前・拠点・学年を登録する</li>
        <li>このリンク（QRコード）を部員に送る</li>
        <li>部員がLINEで開いて自分の名前を選ぶと登録が終わり、名簿の一覧から消える</li>
      </ol>
    </div>
  );
}
