/**
 * Paleta dos charts — navy + variações sutis, alinhada aos tokens (accent-700..400).
 * Usada em donut/bar/line. Cores em ordem de prioridade.
 */
export const CHART_COLORS = [
  '#14213D', // accent-700 — brand anchor
  '#2D426B', // accent-500
  '#4D6388', // accent-400
  '#7C8BA7', // navy claro derivado
  '#A6B0C2', // navy ainda mais claro
  '#2F6E3C', // positive
  '#7A5E22', // warn
  '#8C3D2E', // negative
];

export const CHART_STATUS_COLOR: Record<string, string> = {
  done: '#2F6E3C',
  failed: '#8C3D2E',
  running: '#3A5A7C',
  queued: '#7A5E22',
};
