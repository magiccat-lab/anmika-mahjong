// 限定スタンプ [2026-11-04 リョー「急に静か、俺にだけ搭載して」「ちなみに俺は全種使えるようにして」「asumeに「週1オンミカ！」ってスタンプもつけて」]
// 持ち主の user_id だけが pallet に出せて、server も持ち主以外の送信を黙って捨てる。管理者 [magicren] は全種使える。
// client [store.ts / StampPallet.svelte] と server [ws_server.ts] の両方がここを import する
export const STAMP_ADMIN_USER_ID = '398738170314752012'; // magicren

/** 限定スタンプ id → 持ち主 user_id [pallet に出す並びもこの順] */
export const LIMITED_STAMP_OWNERS: Readonly<Record<string, string>> = {
  kyuni: '398738170314752012', // magicren
  kaihatsu: '398738170314752012', // magicren
  toutotsu: '410812617263808513', // .noimi
  nipmachi: '590540156617097217', // isg.
  jibungatari: '464811848420556801', // arupu_
  shuichi: '514403167165743104', // asume65
};
export const LIMITED_STAMP_IDS = ['kyuni', 'kaihatsu', 'toutotsu', 'nipmachi', 'jibungatari', 'shuichi'] as const;
export type LimitedStampId = typeof LIMITED_STAMP_IDS[number];

/** [2026-11-04 先輩「全員cpuにも出してあげよう」] 人が 1 人だけの卓 (CPU 戦 ・ 他が全員 CPU の部屋) は
 *  見るのが本人だけなので、固有スタンプを誰にでも全種出す。人が 2 人以上の卓は持ち主だけ */
export function stampsOpenToAll(members: ReadonlyArray<{ is_cpu?: boolean }> | null | undefined): boolean {
  if (!members) return true;
  return members.filter((m) => !m.is_cpu).length <= 1;
}
export const LIMITED_STAMP_LABELS: Record<LimitedStampId, string> = {
  kyuni: '急に静か',
  kaihatsu: '開発者特権',
  toutotsu: '唐突に-1000枚',
  nipmachi: '2p待ちに取れんかね',
  jibungatari: '自分語りしまーす',
  shuichi: '週1オンミカ！',
};

export function isLimitedStamp(stampId: string): stampId is LimitedStampId {
  return Object.prototype.hasOwnProperty.call(LIMITED_STAMP_OWNERS, stampId);
}

/** この user がそのスタンプを送ってよいか。共有スタンプは true を返さない [限定だけを見る]ので、
 *  呼ぶ側は「共有の許可リスト or canUseLimitedStamp」で判定する */
export function canUseLimitedStamp(stampId: string, userId: string | null | undefined): boolean {
  if (!isLimitedStamp(stampId) || !userId) return false;
  return userId === STAMP_ADMIN_USER_ID || userId === LIMITED_STAMP_OWNERS[stampId];
}

/** pallet の最終段に出す、この user が使える限定スタンプ */
export function limitedStampsFor(userId: string | null | undefined): LimitedStampId[] {
  return LIMITED_STAMP_IDS.filter((id) => canUseLimitedStamp(id, userId));
}
