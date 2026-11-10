// LIFF（LINEの中でアプリを開く仕組み）の設定。LIFF ID は公開されても問題ない値。
// 本番では NEXT_PUBLIC_LIFF_ID に本番用の LIFF ID を設定する。
export const LIFF_ID = process.env.NEXT_PUBLIC_LIFF_ID || "2012523269-UmgHPVzJ";

// LINE のトークなどから開くURL（ログインしてから to のページへ移動する）
export function liffUrl(to: string) {
  return `https://liff.line.me/${LIFF_ID}?to=${encodeURIComponent(to)}`;
}

// トークの返事の下に付ける「アプリで見る」ボタン（LINEのボタン型メッセージ）
export function appButton(path: string, text = "詳しくはアプリで確認できます") {
  return {
    type: "template",
    altText: "アプリで見る",
    template: {
      type: "buttons",
      text,
      actions: [{ type: "uri", label: "アプリで見る", uri: liffUrl(path) }],
    },
  };
}
