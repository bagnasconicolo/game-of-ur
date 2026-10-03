// Etichette leggibili per configurazioni, categorie e motivi di fine partita.

import { BOARDS, RULESETS, COMPATIBILITY, type BoardId, type RulesetId } from '../engine/index.ts';

export function parseKey(key: string): { boardId: BoardId; boardVersion: number; rulesetId: RulesetId; rulesetVersion: number } | null {
  const m = key.match(/^([\w-]+)@(\d+)\/([\w-]+)@(\d+)$/);
  if (!m) return null;
  return { boardId: m[1] as BoardId, boardVersion: Number(m[2]), rulesetId: m[3] as RulesetId, rulesetVersion: Number(m[4]) };
}

export function configLabel(key: string): string {
  const c = parseKey(key);
  if (!c) return key;
  return `${BOARDS[c.boardId]?.shortName ?? c.boardId} · ${RULESETS[c.rulesetId]?.name ?? c.rulesetId} v${c.rulesetVersion}`;
}

export function compatOf(boardId: string, rulesetId: string) {
  return COMPATIBILITY.find((c) => c.boardId === boardId && c.rulesetId === rulesetId)!;
}

export const CATEGORY_LABEL: Record<string, string> = {
  competitiva: 'Classificata (Elo)',
  sperimentale: 'Sperimentale (Elo separato)',
  personalizzata: 'Adattamento (senza Elo)',
  locale: 'Locale (non classificata)',
};

export const REASON_LABEL: Record<string, string> = {
  'percorso-completato': 'percorso completato',
  resa: 'resa',
  'tempo-scaduto': 'tempo scaduto',
  abbandono: 'abbandono (disconnessione)',
};

export const STATUS_TAG: Record<string, { cls: string; label: string }> = {
  attestato: { cls: 'attestato', label: 'Attestato' },
  interpretazione: { cls: 'interpretazione', label: 'Interpretazione' },
  convenzione: { cls: 'convenzione', label: 'Convenzione moderna' },
};

export function playerSideLabel(p: 0 | 1, boardId: string): string {
  if (boardId === 'ur-iii') return p === 0 ? 'Chiaro (lato sud)' : 'Scuro (lato nord)';
  return p === 0 ? 'Coni (lato sud)' : 'Rocchetti (lato nord)';
}

export function allConfigKeys(): { key: string; label: string; category: string }[] {
  return COMPATIBILITY.map((c) => {
    const key = `${c.boardId}@${BOARDS[c.boardId].version}/${c.rulesetId}@${RULESETS[c.rulesetId].version}`;
    return { key, label: configLabel(key), category: c.category };
  });
}
