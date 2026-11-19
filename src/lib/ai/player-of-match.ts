import type { SimInnings } from "./match-simulator";

/** Bowling figures belong to the team opposing the innings being displayed. */
export function playerOfMatchFromWinner(
  winner: string,
  first: SimInnings,
  second: SimInnings,
): string {
  const winningInnings = winner === first.team ? first : second;
  const losingInnings = winner === first.team ? second : first;
  const batters = winningInnings.batting
    .filter((player) => player.balls > 0)
    .map((player) => ({
      name: player.name,
      score: player.runs + (player.runs >= 50 ? 8 : 0) + player.sixes * 2,
    }));
  const bowlers = losingInnings.bowling
    .filter((player) => player.balls > 0)
    .map((player) => ({
      name: player.name,
      score: player.wickets * 26 +
        (player.wickets > 0 ? Math.max(0, 9 - player.economy) * 2 : 0),
    }));

  return [...batters, ...bowlers].sort((a, b) => b.score - a.score)[0]?.name ??
    winningInnings.batting[0]?.name ??
    losingInnings.bowling[0]?.name ??
    "Match winner";
}
