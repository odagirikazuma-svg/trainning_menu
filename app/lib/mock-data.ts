import { TrainingMenu } from "./types";

export const initialMenus: TrainingMenu[] = [
  {
    id: "menu-1",
    date: "2026-07-22",
    title: "7/22 通常練習",
    content:
      "アップ20分（ランニング＋動的ストレッチ）\nタックル反復 15分\nスパーリング 5分×6本\n補強：腕立て・腹筋 各3セット",
    createdBy: "山田（キャプテン）",
    createdAt: "2026-07-21T10:00:00.000Z",
    comments: [
      {
        id: "c-1",
        authorName: "コーチ 佐藤",
        role: "coach",
        text: "スパーリングの本数、もう少し増やしても良さそう。",
        createdAt: "2026-07-21T11:00:00.000Z",
      },
    ],
  },
  {
    id: "menu-2",
    date: "2026-07-23",
    title: "7/23 通常練習",
    content: "アップ20分\n技術練習 30分\nスパーリング 5分×8本\nクールダウン",
    createdBy: "山田（キャプテン）",
    createdAt: "2026-07-22T10:00:00.000Z",
    comments: [],
  },
];
