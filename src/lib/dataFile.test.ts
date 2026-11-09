import { describe, expect, it } from 'vitest';
import { fingerprint, parseStateText, serializeState } from './dataFile';
import { demoState } from './store';
import type { AppState } from './types';

describe('fichier de comptes', () => {
  const state = demoState('dark');

  it('relire le fichier enregistré redonne exactement les mêmes données', () => {
    const back = parseStateText(serializeState(state));
    expect(back).not.toBeNull();
    expect(fingerprint(back!)).toBe(fingerprint(state));
  });

  it('changer de thème ne compte pas comme une modification', () => {
    const light: AppState = { ...state, theme: 'light' };
    expect(fingerprint(light)).toBe(fingerprint(state));
  });

  it('toute modification des données change l’empreinte', () => {
    const tx = { ...state.transactions[0], amount: state.transactions[0].amount + 0.01 };
    expect(fingerprint({ ...state, transactions: [tx, ...state.transactions.slice(1)] })).not.toBe(fingerprint(state));
    expect(fingerprint({ ...state, primaryId: null })).not.toBe(fingerprint(state));
    expect(fingerprint({ ...state, period: { kind: 'day', day: 25 } })).not.toBe(fingerprint(state));
    expect(
      fingerprint({ ...state, categories: [{ id: 'c:1', label: 'Péages', icon: '🛣️', type: 'expense' }] }),
    ).not.toBe(fingerprint(state));
  });

  it('accepte un fichier avec BOM et refuse ce qui n’est pas un fichier Slice', () => {
    const bom = String.fromCharCode(0xfeff);
    expect(parseStateText(bom + serializeState(state))?.accounts).toHaveLength(state.accounts.length);
    expect(parseStateText('{"comptes": []}')).toBeNull();
    expect(parseStateText('date;libellé;montant')).toBeNull();
    expect(parseStateText('')).toBeNull();
  });

  it('les anciennes sauvegardes exportées s’ouvrent aussi', () => {
    const exported = JSON.stringify(state, null, 2);
    expect(fingerprint(parseStateText(exported)!)).toBe(fingerprint(state));
  });
});
