import { describe, expect, it } from 'vitest';
import { discordLoginUrl, loginNextPath, roomInviteUrl, withRoomParam } from '../roomLink';

// [2026-10-09 遊真 B1/B2/B3] 招待リンク [/?room=ABCD] をログインと再読み込みで失わない

describe('loginNextPath / discordLoginUrl [B1]', () => {
  it('招待リンクの path + query を ?next= に載せる [encode する]', () => {
    const url = discordLoginUrl('', { pathname: '/', search: '?room=ABCD' });
    expect(url).toBe('/auth/discord/login?next=%2F%3Froom%3DABCD');
    expect(decodeURIComponent(url.split('next=')[1])).toBe('/?room=ABCD');
  });
  it('query 無しは path だけ', () => {
    expect(discordLoginUrl('', { pathname: '/', search: '' })).toBe('/auth/discord/login?next=%2F');
  });
  it('API_BASE が付く構成でも next は相対パスのまま', () => {
    const url = discordLoginUrl('https://api.example', { pathname: '/play/', search: '?room=XY12&x=1' });
    expect(url.startsWith('https://api.example/auth/discord/login?next=')).toBe(true);
    expect(decodeURIComponent(url.split('next=')[1])).toBe('/play/?room=XY12&x=1');
  });
  it('protocol 相対 [//evil] にならない', () => {
    expect(loginNextPath({ pathname: '//evil.example/x', search: '' })).toBe('/evil.example/x');
    expect(loginNextPath({ pathname: 'noslash', search: '?a=1' })).toBe('/noslash?a=1');
  });
});

describe('withRoomParam [B2]', () => {
  it('部屋に入ったら ?room= を付ける / 他の query と hash は残す', () => {
    expect(withRoomParam({ pathname: '/', search: '', hash: '' }, 'ABCD')).toBe('/?room=ABCD');
    expect(withRoomParam({ pathname: '/', search: '?debug=1', hash: '#top' }, 'ABCD')).toBe('/?debug=1&room=ABCD#top');
  });
  it('すでに付いていれば置き換える', () => {
    expect(withRoomParam({ pathname: '/', search: '?room=OLD1' }, 'NEW2')).toBe('/?room=NEW2');
  });
  it('抜けたら外す [他の query は残す / 何も残らなければ path だけ]', () => {
    expect(withRoomParam({ pathname: '/', search: '?room=ABCD' }, null)).toBe('/');
    expect(withRoomParam({ pathname: '/', search: '?room=ABCD&debug=1', hash: '#x' }, null)).toBe('/?debug=1#x');
    expect(withRoomParam({ pathname: '/', search: '' }, null)).toBe('/');
  });
});

describe('roomInviteUrl [B3]', () => {
  it('共有 ・ コピーする招待リンク', () => {
    expect(roomInviteUrl('https://anmika.example', 'ABCD')).toBe('https://anmika.example/?room=ABCD');
  });
});
