import { average } from "./math";
import { isOpener } from "./squad-balance";
import type { AiDifficulty, AiPlayer, LineupDecision, PitchType } from "./types";

function score(player: AiPlayer, pitch: PitchType) {
  const pitchFit = player.pitchRatings?.[pitch] ?? 75;
  const core = player.role === "BAT" || player.role === "WK" ? player.batting :
    player.role === "AR" ? (player.batting + player.bowling) / 2 : player.bowling;
  return core * .62 + player.form * .14 + player.confidence * .1 + player.fitness * .08 + pitchFit * .06;
}

function isBalancedEleven(players: AiPlayer[]) {
  return players.length === 11 &&
    players.filter(isOpener).length >= 2 &&
    players.filter(player => player.role === "WK").length >= 1 &&
    players.filter(player => player.role === "AR").length >= 1 &&
    players.filter(player => player.role === "PACE").length >= 2 &&
    players.filter(player => player.role === "SPIN").length >= 1 &&
    players.filter(player => player.overseas).length <= 4;
}

function repairEleven(squad: AiPlayer[], pitch: PitchType): AiPlayer[] | null {
  type Choice = {
    players: AiPlayer[];
    rating: number;
    overseas: number;
    openers: number;
    keepers: number;
    allRounders: number;
    pace: number;
    spin: number;
  };
  const key = (choice: Choice) => {
    let value = choice.players.length;
    for (const [count, radix] of [
      [choice.overseas, 5], [Math.min(choice.openers, 2), 3],
      [Math.min(choice.keepers, 1), 2], [Math.min(choice.allRounders, 1), 2],
      [Math.min(choice.pace, 2), 3], [Math.min(choice.spin, 1), 2],
    ]) value = value * radix + count;
    return value;
  };
  const empty: Choice = {
    players: [], rating: 0, overseas: 0, openers: 0,
    keepers: 0, allRounders: 0, pace: 0, spin: 0,
  };
  const choices = new Map<number, Choice>([[key(empty), empty]]);
  for (const player of squad) {
    for (const choice of [...choices.values()]) {
      if (choice.players.length >= 11 || (player.overseas && choice.overseas >= 4)) continue;
      const candidate: Choice = {
        players: [...choice.players, player],
        rating: choice.rating + score(player, pitch),
        overseas: choice.overseas + Number(player.overseas),
        openers: choice.openers + Number(isOpener(player)),
        keepers: choice.keepers + Number(player.role === "WK"),
        allRounders: choice.allRounders + Number(player.role === "AR"),
        pace: choice.pace + Number(player.role === "PACE"),
        spin: choice.spin + Number(player.role === "SPIN"),
      };
      const id = key(candidate);
      if ((choices.get(id)?.rating ?? -Infinity) < candidate.rating)
        choices.set(id, candidate);
    }
  }
  return [...choices.values()]
    .filter(choice => choice.players.length === 11 && choice.openers >= 2 &&
      choice.keepers >= 1 && choice.allRounders >= 1 &&
      choice.pace >= 2 && choice.spin >= 1)
    .sort((a, b) => b.rating - a.rating)[0]?.players ?? null;
}

export function selectLineup(squad: AiPlayer[], pitch: PitchType, _difficulty: AiDifficulty): LineupDecision {
  void _difficulty;
  const ranked = [...squad].sort((a, b) => score(b, pitch) - score(a, pitch));
  const selected: AiPlayer[] = [];
  const add = (players: AiPlayer[], count: number) => {
    let added = 0;
    for (const player of players) {
      if (added >= count) break;
      if (selected.includes(player) || (player.overseas && selected.filter(item => item.overseas).length >= 4)) continue;
      selected.push(player);
      added++;
    }
  };

  add(ranked.filter(isOpener), 2);
  add(ranked.filter(player => player.role === "WK"), Math.max(0, 1 - selected.filter(player => player.role === "WK").length));
  add(ranked.filter(player => player.role === "BAT"), Math.max(0, 4 - selected.filter(player => player.role === "BAT").length));
  add(ranked.filter(player => player.role === "AR"), Math.max(0, 1 - selected.filter(player => player.role === "AR").length));
  add(ranked.filter(player => player.role === "PACE"), Math.max(0, 2 - selected.filter(player => player.role === "PACE").length));
  add(ranked.filter(player => player.role === "SPIN"), Math.max(0, 1 - selected.filter(player => player.role === "SPIN").length));
  add(ranked.filter(player => player.role === "PACE" || player.role === "SPIN"), 4 - selected.filter(player => player.role === "PACE" || player.role === "SPIN").length);
  add(ranked, 11 - selected.length);

  let eleven = selected.slice(0, 11);
  if (!isBalancedEleven(eleven))
    eleven = repairEleven(squad, pitch) ?? eleven;
  const keeper = [...eleven].sort((a, b) => (b.keeping ?? 0) - (a.keeping ?? 0))[0];
  const openers = [...eleven].filter(isOpener).sort((a, b) => score(b, pitch) - score(a, pitch)).slice(0, 2);
  const battingTier = (player: AiPlayer) =>
    player.role === "BAT" || player.role === "WK" ? 2 : player.role === "AR" ? 1 : 0;
  const battingScore = (player: AiPlayer) =>
    player.batting * .72 + player.form * .18 + player.confidence * .1;
  const rest = eleven.filter(player => !openers.includes(player))
    .sort((a, b) => battingTier(b) - battingTier(a) || battingScore(b) - battingScore(a));
  const captain = [...eleven].sort((a, b) => (b.confidence + b.form) - (a.confidence + a.form))[0];
  return {
    playerIds: eleven.map(player => player.id),
    battingOrder: [...openers, ...rest].map(player => player.id),
    captainId: captain.id,
    wicketkeeperId: keeper.id,
    reasons: [
      `Selected for ${pitch.toLowerCase()} conditions`,
      `Average form ${average(eleven.map(player => player.form)).toFixed(1)}`,
      "Two opening batters, a wicketkeeper, pace, spin and all-round options",
    ],
  };
}
