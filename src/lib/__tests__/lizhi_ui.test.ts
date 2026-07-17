import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import LizhiControls from '../LizhiControls.svelte';
import {
  lizhiCandidateText,
  lizhiChoiceId,
  lizhiChoiceLabel,
  lizhiPaiLabel,
  isLizhiDiscardableCandidate,
  lizhiCandidatesForFlags,
} from '../lizhiUi';

describe('riichi choice UI labels', () => {
  it('identifies every supported riichi option without conflating its flags', () => {
    expect(lizhiChoiceId({ open: false, shuvari: false, fever: false })).toBe('normal');
    expect(lizhiChoiceId({ open: false, shuvari: true, fever: false })).toBe('shuvari');
    expect(lizhiChoiceId({ open: false, shuvari: false, fever: true })).toBe('fever');
    expect(lizhiChoiceId({ open: false, shuvari: true, fever: true })).toBe('shuvari-fever');
    expect(lizhiChoiceId({ open: true, shuvari: false, fever: false })).toBe('open');
    expect(lizhiChoiceId({ open: true, shuvari: true, fever: false })).toBe('shuvari-open');
    expect(lizhiChoiceLabel('shuvari-fever')).toBe('シュバ・フィーバーリーチ');
  });

  it('keeps expanded physical tile identities visible in declaration candidates', () => {
    expect(lizhiPaiLabel('gp')).toBe('金5筒');
    expect(lizhiPaiLabel('np3')).toBe('虹3筒');
    expect(lizhiPaiLabel('z5g')).toBe('緑ぽっち');
    expect(lizhiCandidateText(['gp', 'p0', 'np3', 'gp']))
      .toBe('金5筒・赤5筒・虹3筒');
  });

  it('never advertises nuki-only north as a declaration discard', () => {
    expect(isLizhiDiscardableCandidate('z4_')).toBe(false);
    expect(isLizhiDiscardableCandidate('gN')).toBe(false);
    expect(isLizhiDiscardableCandidate('gp')).toBe(true);
  });

  it('filters FEVER declaration tiles by exact physical identity', () => {
    const flags = { open: false, shuvari: false, fever: true };
    expect(lizhiCandidatesForFlags(['p3', 'np3', 'gp'], ['p3', 'gp'], flags))
      .toEqual(['p3', 'gp']);
  });

  it('renders both the selected kind and the exact next-discard choices', () => {
    const { body } = render(LizhiControls, {
      props: {
        pending: true,
        flags: { open: false, shuvari: true, fever: true },
        normalCandidates: ['s9', 'gp'],
        feverCandidates: ['gp'],
        feverAvailable: true,
        shuvariUsed: false,
        onSelect() {},
      },
    });
    expect(body).toContain('選択確定: シュバ・フィーバーリーチ');
    expect(body).toContain('次に切る牌: 金5筒');
    expect(body).toContain('宣言牌: 9索・金5筒');
    expect(body).toContain('aria-pressed="true"');
    expect(body).toContain('disabled');
  });
});
