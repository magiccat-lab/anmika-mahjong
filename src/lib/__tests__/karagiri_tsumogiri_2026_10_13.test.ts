// [2026-10-13 リョー「からぎりがツモギリ扱いになってるとかあるかも」]
// 打牌のツモ切り判定は牌の種類だけを見ていたので、ツモった牌と同じ牌を手から切る空切りも
// ツモ切り [河で薄く出る] になっていた。画面は押した牌がツモった牌そのものかを meta.tsumogiri で送る。
// meta.tsumogiri が無い打牌 [CPU ・ 自動ツモ切り ・ 旧版の画面] は今まで通り種類で見る
import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { buildShoupai, type Game3 } from '../game3';
import { createGameStore } from '../store';
import type { PlayerId } from '../types';

// m2 の対子を持った 13 枚に m2 をツモらせる [空切りができる形]
const HAND = ['m2', 'm2', 'p3', 'p4', 'p6', 's1', 's2', 's4', 's6', 's7', 'z1', 'z2', 'z3'];

function drawSameTile() {
  const store = createGameStore();
  const game: Game3 = (get(store as any) as any).game;
  const player = game.lunbanToPlayerId(game.state.lunban) as PlayerId;
  store.setCpuSeats(([0, 1, 2] as PlayerId[]).filter((p) => p !== player));
  game.diyizimo = false;
  game.huapai[player] = [];
  game.shoupai.set(player, buildShoupai(HAND));
  const shan: any = game.shan;
  shan._pai[shan._pai.length - 1] = 'm2';
  expect(game.zimo()).toBe('m2');
  (get(store as any) as any).lastZimo = 'm2';
  return { store, game, player };
}

const lastLog = (game: Game3, player: PlayerId) => game.discardLog[player].at(-1);

describe('空切りはツモ切りにしない', () => {
  it('手の中の m2 を切った [tsumogiri: false] → 手出し', () => {
    const { store, game, player } = drawSameTile();
    store.discard('m2', { tsumogiri: false });
    expect(lastLog(game, player)).toMatchObject({ pai: 'm2', tsumogiri: false });
  });

  it('ツモった m2 を切った [tsumogiri: true] → ツモ切り', () => {
    const { store, game, player } = drawSameTile();
    store.discard('m2', { tsumogiri: true });
    expect(lastLog(game, player)).toMatchObject({ pai: 'm2', tsumogiri: true });
  });

  it('ツモった牌と違う牌に tsumogiri: true が付いて来てもツモ切りにしない', () => {
    const { game, player } = drawSameTile();
    game.dapai('z3', { tsumogiri: true });
    expect(lastLog(game, player)).toMatchObject({ pai: 'z3', tsumogiri: false });
  });

  it('meta.tsumogiri が無い打牌 [CPU ・ 自動ツモ切り] は今まで通り種類で見る', () => {
    const { game, player } = drawSameTile();
    game.dapai('m2');
    expect(lastLog(game, player)).toMatchObject({ pai: 'm2', tsumogiri: true });
  });
});
