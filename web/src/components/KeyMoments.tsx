// The game's turning points for you (analyze.py key_moments: your brilliant moves, then your
// biggest slips). The review's Summary lists them as "Worth another look" (ReviewSummary.tsx).

export interface KeyMoment {
  ply: number; move_number: number; san: string; class: string | null; brilliant?: boolean; miss?: boolean;
  win_before?: number; win_after?: number;
}
