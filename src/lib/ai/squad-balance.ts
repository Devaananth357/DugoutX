import type { AiPlayer, PlayerRole } from "./types";

// These are minimum squad resources, leaving the remaining places flexible.
export const SQUAD_MINIMUMS: Record<PlayerRole, number> = {
  BAT: 4,
  WK: 2,
  AR: 2,
  PACE: 4,
  SPIN: 2,
};
export const MIN_OPENERS = 2;

export function isOpener(player: AiPlayer) {
  return (player.role === "BAT" || player.role === "WK" || player.role === "AR") &&
    player.battingPosition !== undefined && player.battingPosition >= 1 && player.battingPosition <= 2;
}

export function squadCounts(squad: AiPlayer[]) {
  const roles = { BAT: 0, WK: 0, AR: 0, PACE: 0, SPIN: 0 };
  let openers = 0;
  for (const player of squad) {
    roles[player.role]++;
    if (isOpener(player)) openers++;
  }
  return { roles, openers };
}

export function squadGaps(squad: AiPlayer[]) {
  const { roles, openers } = squadCounts(squad);
  const roleGaps = Object.fromEntries(
    (Object.keys(SQUAD_MINIMUMS) as PlayerRole[]).map(role =>
      [role, Math.max(0, SQUAD_MINIMUMS[role] - roles[role])],
    ),
  ) as Record<PlayerRole, number>;
  return { roleGaps, openerGap: Math.max(0, MIN_OPENERS - openers) };
}

// Reserve separate places for openers unless the same new player closes both gaps.
// This avoids relying on an opener with a particular role still being available later.
export function minimumPlacesNeeded(squad: AiPlayer[]) {
  const { roleGaps, openerGap } = squadGaps(squad);
  const rolePlaces = Object.values(roleGaps).reduce((sum, gap) => sum + gap, 0);
  return rolePlaces + openerGap;
}

export function squadBalanceViolations(squad: AiPlayer[]) {
  const { roleGaps, openerGap } = squadGaps(squad);
  const violations = (Object.keys(roleGaps) as PlayerRole[])
    .filter(role => roleGaps[role] > 0)
    .map(role => `${role} short by ${roleGaps[role]}`);
  if (openerGap) violations.push(`openers short by ${openerGap}`);
  return violations;
}
