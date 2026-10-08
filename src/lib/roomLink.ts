// [2026-10-09 遊真 B1/B2] 招待リンク [/?room=ABCD] をログインと再読み込みの両方で失わない pure な部品。

type LocationLike = { pathname: string; search: string; hash?: string };

/** ログイン後に戻る先 [同一 origin の相対パス]。招待リンクの ?room= もそのまま運ぶ */
export function loginNextPath(loc: LocationLike): string {
  const path = loc.pathname.startsWith('/') ? loc.pathname : `/${loc.pathname}`;
  // '//evil' のような protocol 相対 URL にしない
  const safe = path.startsWith('//') ? `/${path.replace(/^\/+/, '')}` : path;
  return `${safe}${loc.search ?? ''}`;
}

/** Discord ログインの入口 URL。?next= に今のページを付けて、ログイン後に戻す */
export function discordLoginUrl(apiBase: string, loc: LocationLike): string {
  return `${apiBase}/auth/discord/login?next=${encodeURIComponent(loginNextPath(loc))}`;
}

/** 部屋の中にいる間だけ ?room= を URL に残す。roomId が null なら外す。他の query と hash は触らない */
export function withRoomParam(loc: LocationLike, roomId: string | null): string {
  const params = new URLSearchParams(loc.search ?? '');
  if (roomId) params.set('room', roomId);
  else params.delete('room');
  const query = params.toString();
  return `${loc.pathname}${query ? `?${query}` : ''}${loc.hash ?? ''}`;
}

/** 招待リンクの全体 URL [共有 ・ コピー用] */
export function roomInviteUrl(origin: string, roomId: string): string {
  return `${origin}/?room=${encodeURIComponent(roomId)}`;
}
