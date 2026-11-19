import sheetData from "../../../data/ai/sheet-data.json";
import { clamp, seededUnit } from "./math";
import { selectLineup } from "./lineup";
import { batterMatchConfidence } from "./batter-confidence";
import { getTeamRoster } from "./sheet-data";
import { DELIVERY_OUTCOMES, learnedDeliveryProbabilities } from "./match-outcome-model";
import { playerOfMatchFromWinner } from "./player-of-match";
import type { AiDifficulty, AiPlayer, MatchPhase, PitchType } from "./types";

type Row = Record<string, string | number | boolean | null>;
const tables = sheetData.tables as Record<string, Row[]>;
const byId = (name: string) =>
  new Map((tables[name] ?? []).map((row) => [Number(row.player_id), row]));
const battingRows = byId("batters.Batting_Attributes"),
  bowlingRows = byId("bowlers.Bowling_Attributes");
const pitchRows = new Map(
  (tables["rules.Pitch_Types"] ?? []).map((row) => [
    String(row.pitch_type).toUpperCase(),
    row,
  ]),
);
const stadiumRows = tables["rules.Stadium_Conditions"] ?? [];
const weaknessRows = new Map<number, Row[]>();
for (const row of tables["rules.Batting_Weaknesses"] ?? []) {
  const id = Number(row.player_id);
  weaknessRows.set(id, [...(weaknessRows.get(id) ?? []), row]);
}
const teamNames: Record<string, string> = {
  CHE: "Chennai Super Kings",
  MUM: "Mumbai Indians",
  BLR: "Royal Challengers Bengaluru",
  KOL: "Kolkata Knight Riders",
  DEL: "Delhi Capitals",
  HYD: "Sunrisers Hyderabad",
  PUN: "Punjab Kings",
  RAJ: "Rajasthan Royals",
  LKN: "Lucknow Super Giants",
  GUJ: "Gujarat Titans",
};
const n = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export type BatterMatchStat = {
  playerId: number;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dismissal: string;
  strikeRate: number;
};
export type BowlerMatchStat = {
  playerId: number;
  name: string;
  balls: number;
  runs: number;
  wickets: number;
  economy: number;
};
export type SimInnings = {
  team: string;
  runs: number;
  wickets: number;
  overs: string;
  batting: BatterMatchStat[];
  bowling: BowlerMatchStat[];
  fallOfWickets: string[];
  diagnostics?: { powerplayWickets: number; tailSixes: number; sixesWithinThreeBallsOfWicket: number };
};
export type T20Simulation = {
  pitch: PitchType;
  venue: string;
  first: SimInnings;
  second: SimInnings;
  winner: string;
  summary: string;
  playerOfMatch: string;
};

function weighted(seed: string, weights: number[]) {
  const total = weights.reduce((sum, value) => sum + Math.max(0, value), 0);
  let point = seededUnit(seed) * total;
  for (let i = 0; i < weights.length; i++) {
    point -= Math.max(0, weights[i]);
    if (point <= 0) return i;
  }
  return weights.length - 1;
}
function phaseFor(over: number): MatchPhase {
  return over < 6 ? "Powerplay" : over < 16 ? "Middle" : "Death";
}
function phaseKey(phase: MatchPhase) {
  return phase === "Powerplay"
    ? "powerplay_rating"
    : phase === "Middle"
      ? "middle_overs_rating"
      : "death_overs_rating";
}
function surfaceWeapon(row: Row, pitch: PitchType) {
  if (pitch === "Green")
    return Math.max(n(row.swing_rating, 0), n(row.seam_rating, 0));
  if (pitch === "Bouncy")
    return Math.max(n(row.bounce_rating, 0), n(row.bouncer_rating, 0));
  if (pitch === "Dry")
    return Math.max(n(row.turn_rating, 0), n(row.flight_rating, 0));
  if (pitch === "Slow")
    return Math.max(
      n(row.turn_rating, 0),
      n(row.slower_ball_rating, 0),
      n(row.flight_rating, 0),
    );
  return Math.max(n(row.variation_rating, 0), n(row.yorker_rating, 0));
}
function bowlerStyle(player: AiPlayer) {
  const style = (player.bowlingStyle ?? "").toUpperCase();
  if (style) return style;
  if (player.role === "SPIN") return "SPIN";
  return "PACE";
}
function isSpinBowler(player: AiPlayer) {
  return player.role === "SPIN" ||
    /(ORTHODOX|OFF_BREAK|LEG_BREAK|CHINAMAN|WRIST_SPIN|FINGER_SPIN|SLOW_LEFT_ARM|SPIN)/.test(bowlerStyle(player));
}
export function isPowerplaySpinRisk(player: AiPlayer) {
  return isSpinBowler(player) && player.id !== 205 && player.id !== 20;
}
function styleMatches(rule: string, bowler: AiPlayer) {
  const wanted = rule.toUpperCase();
  if (wanted === "ANY") return true;
  const actual = bowlerStyle(bowler);
  if (wanted.includes("SPIN")) return bowler.role === "SPIN";
  if (
    wanted.includes("FAST") ||
    wanted.includes("MEDIUM") ||
    wanted.includes("PACE")
  )
    return bowler.role === "PACE" || bowler.role === "AR";
  return actual.includes(wanted) || wanted.includes(actual);
}
function pitchChoice(seed: string): PitchType {
  const pitches: PitchType[] = ["Flat", "Slow", "Dry", "Green", "Bouncy"];
  return pitches[
    Math.floor(seededUnit(seed) * pitches.length) % pitches.length
  ];
}
function venueFor(home: string) {
  const wanted = teamNames[home] ?? home;
  return (
    stadiumRows.find(
      (row) => String(row.home_team).toLowerCase() === wanted.toLowerCase(),
    ) ??
    stadiumRows[Math.floor(seededUnit(home) * Math.max(1, stadiumRows.length))]
  );
}
function chooseBowler(
  players: AiPlayer[],
  over: number,
  used: Map<number, number>,
  lastId: number | null,
) {
  const phase = phaseFor(over);
  const candidates = players.filter(
    (player) =>
      (player.role === "PACE" ||
        player.role === "SPIN" ||
        player.role === "AR") &&
      (used.get(player.id) ?? 0) < 4 &&
      player.id !== lastId,
  );
  const available = candidates.length
    ? candidates
    : players.filter((player) => (used.get(player.id) ?? 0) < 4);
  const saferPowerplayOptions = phase === "Powerplay"
    ? available.filter((player) => !isPowerplaySpinRisk(player))
    : [];
  const pool = saferPowerplayOptions.length ? saferPowerplayOptions : available;
  return (
    [...pool].sort((a, b) => {
      const ar = bowlingRows.get(a.id) ?? {},
        br = bowlingRows.get(b.id) ?? {};
      const aScore =
        a.bowling * 0.62 +
        n(ar[phaseKey(phase)], a.bowling) * 0.25 +
        n(ar.control_rating, a.bowling) * 0.08 +
        n(ar.stamina_rating, 70) * 0.05;
      const bScore =
        b.bowling * 0.62 +
        n(br[phaseKey(phase)], b.bowling) * 0.25 +
        n(br.control_rating, b.bowling) * 0.08 +
        n(br.stamina_rating, 70) * 0.05;
      return bScore - aScore;
    })[0] ?? players[0]
  );
}
function weaknessModifier(
  batter: AiPlayer,
  bowler: AiPlayer,
  pitch: PitchType,
  phase: MatchPhase,
  balls: number,
) {
  let wicket = 1,
    boundary = 1,
    dot = 1;
  for (const row of weaknessRows.get(batter.id) ?? []) {
    const rulePitch = String(row.pitch_type ?? "ANY").toUpperCase(),
      rulePhase = String(row.match_phase ?? "ANY").toUpperCase();
    if (rulePitch !== "ANY" && rulePitch !== pitch.toUpperCase()) continue;
    if (rulePhase !== "ANY" && rulePhase !== phase.toUpperCase()) continue;
    if (!styleMatches(String(row.bowling_style ?? "ANY"), bowler)) continue;
    const activation = n(row.activation_after_balls, 5);
    if (balls < activation) continue;
    const full = Math.max(activation + 1, n(row.full_effect_after_balls, 12));
    const progress = clamp(
      (balls - activation + 1) / (full - activation),
      0,
      1,
    );
    wicket *= 1 + (n(row.maximum_wicket_modifier, 1.16) - 1) * progress;
    dot *= 1 + n(row.dot_ball_pressure, 0.02) * progress;
    boundary *= 1 - n(row.boundary_pressure_reduction, 0.08) * progress;
  }
  return { wicket, boundary: Math.max(0.65, boundary), dot };
}
function innings(
  team: string,
  opponent: string,
  battingSquad: AiPlayer[],
  bowlingSquad: AiPlayer[],
  pitch: PitchType,
  venue: Row,
  target: number | undefined,
  seed: string,
  difficulty: AiDifficulty,
): SimInnings {
  const battingLineup = selectLineup(battingSquad, pitch, difficulty);
  const bowlingLineup = selectLineup(bowlingSquad, pitch, difficulty);
  const batting = battingLineup.battingOrder
    .map((id) => battingSquad.find((player) => player.id === id)!)
    .filter(Boolean);
  const fielding = bowlingLineup.playerIds
    .map((id) => bowlingSquad.find((player) => player.id === id)!)
    .filter(Boolean);
  const stats = new Map<number, BatterMatchStat>(
    batting.map((player) => [
      player.id,
      {
        playerId: player.id,
        name: player.name,
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dismissal: "not out",
        strikeRate: 0,
      },
    ]),
  );
  const bowlStats = new Map<number, BowlerMatchStat>();
  const oversUsed = new Map<number, number>();
  const matchupBalls = new Map<string, number>();
  const fall: string[] = [];
  let powerplayWickets = 0, tailSixes = 0, sixesWithinThreeBallsOfWicket = 0;
  let striker = 0,
    nonStriker = 1,
    next = 2,
    score = 0,
    wickets = 0,
    legalBalls = 0,
    lastBowler: number | null = null,
    lastWicketBall = -99;
  while (legalBalls < 120 && wickets < 10 && (!target || score < target)) {
    const over = Math.floor(legalBalls / 6),
      ball = legalBalls % 6,
      phase = phaseFor(over);
    if (ball === 0) {
      const picked = chooseBowler(fielding, over, oversUsed, lastBowler);
      lastBowler = picked.id;
      oversUsed.set(picked.id, (oversUsed.get(picked.id) ?? 0) + 1);
    }
    const bowler =
        fielding.find((player) => player.id === lastBowler) ?? fielding[0],
      batter = batting[striker];
    if (!batter || !bowler) break;
    const bowlRow = bowlingRows.get(bowler.id) ?? {};
    const batStat = stats.get(batter.id)!;
    const matchupKey = `${batter.id}:${bowler.id}`;
    const bowlStat = bowlStats.get(bowler.id) ?? {
      playerId: bowler.id,
      name: bowler.name,
      balls: 0,
      runs: 0,
      wickets: 0,
      economy: 0,
    };
    bowlStats.set(bowler.id, bowlStat);
    const required = target
      ? Math.max(0, target - score) / Math.max(1, (120 - legalBalls) / 6)
      : 0;
    const fieldRating =
      fielding.reduce((sum, player) => sum + player.fielding, 0) /
      Math.max(1, fielding.length);
    const wideRate = clamp(0.012 + n(bowlRow.wide_rate, 0) / 180, 0, 0.045),
      noBallRate = clamp(0.004 + n(bowlRow.no_ball_rate, 0) / 300, 0, 0.02);
    const extraRoll = seededUnit(`${seed}:${legalBalls}:${score}:extra`);
    if (extraRoll < wideRate + noBallRate) {
      score++;
      bowlStat.runs++;
      continue;
    }
    const batMode = required > 10 || (phase === "Death" && wickets < 7) ? "Attack" : "Rotate";
    const model = liveDeliveryProbabilities({
      batter, bowler, pitch, over, ballsFaced: batStat.balls,
      runsScored: batStat.runs, fours: batStat.fours, sixes: batStat.sixes,
      inningsSeed: seed,
      ballsAgainstBowler: matchupBalls.get(matchupKey) ?? 0,
      battingPosition: striker + 1,
      ballsSinceWicket: legalBalls - lastWicketBall - 1,
      battingApproach: batMode,
      bowlingApproach: "Balanced",
      field: "Balanced",
      fieldingRating: fieldRating,
      requiredRate: required,
      wickets,
      outfieldSpeed: n(venue.outfield_speed, 70),
      boundaryMetres: n(venue.average_boundary_m, 70),
      bowlerRuns: bowlStat.runs,
    });
    const outcome = weighted(
      `${seed}:${legalBalls}:${score}:${wickets}:${batter.id}:${bowler.id}`,
      model.probabilities,
    );
    legalBalls++;
    batStat.balls++;
    matchupBalls.set(matchupKey, (matchupBalls.get(matchupKey) ?? 0) + 1);
    bowlStat.balls++;
    if (outcome === 6) {
      wickets++;
      if (over < 6) powerplayWickets++;
      lastWicketBall = legalBalls - 1;
      const dismissalRoll = seededUnit(
        `${seed}:dismissal:${legalBalls}:${batter.id}`,
      );
      const catchers = fielding.filter((player) => player.id !== bowler.id);
      const catcher = catchers[
        Math.floor(seededUnit(`${seed}:catcher:${legalBalls}`) * catchers.length)
      ]?.name ?? bowler.name;
      const keeper = fielding.find((player) => player.role === "WK")?.name ?? catcher;
      const dismissal =
        dismissalRoll < 0.48
          ? `c ${catcher} b ${bowler.name}`
          : dismissalRoll < 0.68
            ? `b ${bowler.name}`
            : dismissalRoll < 0.84
              ? `lbw b ${bowler.name}`
              : dismissalRoll < 0.94
                ? `c ${keeper} b ${bowler.name}`
                : `run out (${catcher})`;
      if (!dismissal.startsWith("run out")) bowlStat.wickets++;
      batStat.dismissal = dismissal;
      fall.push(
        `${score}/${wickets} (${batter.name}, ${Math.floor(legalBalls / 6)}.${legalBalls % 6})`,
      );
      if (next < batting.length) {
        striker = next++;
      } else break;
    } else {
      const runs = [0, 1, 2, 3, 4, 6][outcome] ?? 0;
      score += runs;
      batStat.runs += runs;
      bowlStat.runs += runs;
      if (runs === 4) batStat.fours++;
      if (runs === 6) batStat.sixes++;
      if (runs === 6 && (batter.role === "PACE" || batter.role === "SPIN")) tailSixes++;
      if (runs === 6 && legalBalls - lastWicketBall - 2 < 3) sixesWithinThreeBallsOfWicket++;
      if (runs % 2 === 1) [striker, nonStriker] = [nonStriker, striker];
    }
    if (legalBalls % 6 === 0) [striker, nonStriker] = [nonStriker, striker];
  }
  for (const stat of stats.values())
    stat.strikeRate = stat.balls
      ? Math.round((stat.runs / stat.balls) * 10000) / 100
      : 0;
  for (const stat of bowlStats.values())
    stat.economy = stat.balls
      ? Math.round((stat.runs / (stat.balls / 6)) * 100) / 100
      : 0;
  return {
    team,
    runs: score,
    wickets,
    overs: `${Math.floor(legalBalls / 6)}.${legalBalls % 6}`,
    batting: [...stats.values()].filter((stat) => stat.balls > 0),
    bowling: [...bowlStats.values()],
    fallOfWickets: fall,
    diagnostics: { powerplayWickets, tailSixes, sixesWithinThreeBallsOfWicket },
  };
}
export function liveDeliveryProbabilities(input: {
  batter: AiPlayer;
  bowler: AiPlayer;
  pitch: PitchType;
  over: number;
  ballsFaced: number;
  runsScored?: number;
  fours?: number;
  sixes?: number;
  inningsSeed?: string;
  ballsAgainstBowler?: number;
  battingApproach: "Defend" | "Rotate" | "Attack";
  bowlingApproach: "Attack" | "Balanced" | "Contain";
  field: "Attacking" | "Balanced" | "Defensive";
  fieldingRating: number;
  requiredRate?: number;
  wickets: number;
  battingPosition?: number;
  ballsSinceWicket?: number;
  outfieldSpeed?: number;
  boundaryMetres?: number;
  bowlerRuns?: number;
}) {
  const { batter, bowler, pitch } = input,
    phase = phaseFor(input.over),
    batRow = battingRows.get(batter.id) ?? {},
    bowlRow = bowlingRows.get(bowler.id) ?? {},
    isSpin = isSpinBowler(bowler),
    matchup = n(
      isSpin ? batRow.spin_rating : batRow.pace_rating,
      batter.batting,
    ),
    phaseBat = n(batRow[phaseKey(phase)], batter.batting),
    phaseBowl = n(bowlRow[phaseKey(phase)], bowler.bowling),
    pitchBat = n(
      batRow[`${pitch.toLowerCase()}_pitch_rating`],
      batter.pitchRatings?.[pitch] ?? 70,
    ),
    pitchBowl = n(
      bowlRow[`${pitch.toLowerCase()}_pitch_rating`],
      bowler.pitchRatings?.[pitch] ?? 70,
    );
  const batSkill =
      batter.batting * 0.34 +
      matchup * 0.2 +
      phaseBat * 0.16 +
      pitchBat * 0.12 +
      batter.form * 0.08 +
      batter.confidence * 0.06 +
      batter.fitness * 0.04 -
      (batter.role === "PACE" || batter.role === "SPIN" ? 10 : 0),
    bowlSkill =
      bowler.bowling * 0.31 +
      phaseBowl * 0.18 +
      pitchBowl * 0.13 +
      n(bowlRow.control_rating, bowler.bowling) * 0.1 +
      n(bowlRow.wicket_taking_rating, bowler.bowling) * 0.1 +
      surfaceWeapon(bowlRow, pitch) * 0.08 +
      bowler.form * 0.04 +
      bowler.confidence * 0.04 +
      bowler.fitness * 0.02,
    edge = (batSkill - bowlSkill) / 100,
    weakness = weaknessModifier(batter, bowler, pitch, phase, input.ballsAgainstBowler ?? 0),
    matchConfidence = batterMatchConfidence({
      playerId: batter.id,
      batting: batter.batting,
      baseConfidence: batter.confidence,
      role: batter.role,
      pitch,
      battingPosition: input.battingPosition ?? batter.battingPosition ?? 7,
      balls: input.ballsFaced,
      runs: input.runsScored ?? 0,
      fours: input.fours ?? 0,
      sixes: input.sixes ?? 0,
      inningsSeed: input.inningsSeed ?? "match",
    });
  const bat =
      input.battingApproach === "Attack"
        ? { boundary: 1.28, wicket: 1.3, dot: 0.72 }
        : input.battingApproach === "Defend"
          ? { boundary: 0.62, wicket: 0.62, dot: 1.35 }
          : { boundary: 0.92, wicket: 0.88, dot: 0.9 },
    bowl =
      input.bowlingApproach === "Attack"
        ? { boundary: 1.12, wicket: 1.22, dot: 1.02 }
        : input.bowlingApproach === "Contain"
          ? { boundary: 0.74 + matchConfidence.progress * 0.25, wicket: 0.72, dot: 1.28 - matchConfidence.progress * 0.16 }
          : { boundary: 1, wicket: 1, dot: 1 },
    field =
      input.field === "Attacking"
        ? { boundary: 1.14, wicket: 1.18, dot: 0.95 }
        : input.field === "Defensive"
          ? { boundary: 0.7, wicket: 0.7, dot: 1.2 }
          : { boundary: 1, wicket: 1, dot: 1 };
  const chase = input.requiredRate ?? 0,
    chaseRisk = chase > 11 ? 1.12 : chase > 9 ? 1.05 : 1,
    base = learnedDeliveryProbabilities({
      over: input.over,
      wickets: input.wickets,
      battingPosition: input.battingPosition ?? batter.battingPosition ?? 7,
      ballsFaced: input.ballsFaced,
      ballsSinceWicket: input.ballsSinceWicket ?? 99,
    }),
    pitchRow = pitchRows.get(pitch.toUpperCase()) ?? {},
    pitchBoundary = 1 + (n(pitchRow.boundary_modifier, 1) - 1) * .65,
    pitchWicket = 1 + (n(pitchRow.wicket_modifier, 1) - 1) * .65,
    pitchDot = 1 + (n(pitchRow.dot_ball_modifier, 1) - 1) * .65,
    strikeProfile = clamp(1 + (n(batRow.expected_strike_rate, 135) / 135 - 1) * .2, .87, 1.14),
    economyProfile = clamp(1 + (n(bowlRow.expected_economy, 8.5) / 8.5 - 1) * .22, .86, 1.14),
    boundaryProfile = clamp(Math.sqrt(n(batRow.boundary_rate, .32) / .32), .82, 1.2),
    dotProfile = clamp(1 + (n(bowlRow.dot_ball_rate, .3) - n(batRow.dot_ball_rate, .3)) * .28, .82, 1.18),
    outfield = clamp(1 + ((input.outfieldSpeed ?? 70) - 70) / 350, .9, 1.1),
    boundarySize = clamp(1 + (70 - (input.boundaryMetres ?? 70)) / 300, .9, 1.1),
    p95 = n(bowlRow.four_over_runs_p95, 60),
    lateSpellControl = (input.bowlerRuns ?? 0) > p95 * .75 ? .9 : 1,
    powerplaySpinRisk = phase === "Powerplay" && isPowerplaySpinRisk(bowler),
    // Most conventional spinners are expensive with the inner ring up. The
    // two specialist powerplay exceptions retain their normal sheet ratings.
    powerplaySpinBoundary = powerplaySpinRisk ? (pitch === "Dry" || pitch === "Slow" ? 1.55 : 1.35) : 1,
    powerplaySpinDot = powerplaySpinRisk ? .85 : 1,
    boundary =
      (1 + edge * 0.7) *
      weakness.boundary *
      bat.boundary *
      bowl.boundary *
      field.boundary *
      pitchBoundary * strikeProfile * economyProfile * boundaryProfile * outfield * boundarySize * lateSpellControl * powerplaySpinBoundary,
    wicket =
      (1 - edge * 0.5) *
      weakness.wicket *
      bat.wicket *
      bowl.wicket *
      field.wicket *
      pitchWicket *
      chaseRisk *
      (input.wickets >= 7 ? 0.88 : 1),
    dot =
      (1 - edge * 0.35) *
      weakness.dot *
      bat.dot *
      bowl.dot *
      field.dot *
      (1 + (input.fieldingRating - 70) / 260) * pitchDot * dotProfile * powerplaySpinDot,
    power = clamp((batter.batting - 50) / 40, 0, 1),
    sixPower = batter.role === "PACE" || batter.role === "SPIN" ? .08 + power * .3 :
      batter.role === "AR" ? .35 + power * .65 : .75 + power * .55;
  const weights = [
      base[0] * dot,
      base[1] * (1 + edge * 0.12),
      base[2],
      base[3],
      base[4] * boundary,
      base[5] * boundary * sixPower *
        (input.bowlingApproach === "Contain" ? 1 + matchConfidence.progress * 0.22 : 1),
      base[6] * clamp(wicket, .4, 2),
    ],
    total = weights.reduce((sum, value) => sum + Math.max(0.01, value), 0);
  return {
    outcomes: DELIVERY_OUTCOMES,
    probabilities: weights.map((value) => Math.max(0.01, value) / total),
    batSkill: Math.round(batSkill),
    bowlSkill: Math.round(bowlSkill),
    confidence: matchConfidence.value,
    phase,
  };
}

export function simulateT20Match(input: {
  code: string;
  fixtureId: number;
  home: string;
  away: string;
  homeSquad: AiPlayer[];
  awaySquad: AiPlayer[];
  difficulty: AiDifficulty;
  pitch?: PitchType;
  battingFirst?: string;
  tactics?: Record<
    string,
    {
      battingApproach?: string;
      bowlingApproach?: string;
      field?: string;
      nextBatter?: number;
      nextBowler?: number;
    }
  >;
}): T20Simulation {
  const seed = `${input.code}:match:${input.fixtureId}`,
    pitch = input.pitch ?? pitchChoice(`${seed}:pitch`),
    venue = venueFor(input.home),
    firstTeam =
      input.battingFirst === input.home || input.battingFirst === input.away
        ? input.battingFirst
        : seededUnit(`${seed}:toss`) > 0.5
          ? input.home
          : input.away,
    secondTeam = firstTeam === input.home ? input.away : input.home,
    firstSquad = firstTeam === input.home ? input.homeSquad : input.awaySquad,
    secondSquad = secondTeam === input.home ? input.homeSquad : input.awaySquad;
  const first = innings(
    firstTeam,
    secondTeam,
    firstSquad,
    secondSquad,
    pitch,
    venue,
    undefined,
    `${seed}:first`,
    input.difficulty,
  );
  const second = innings(
    secondTeam,
    firstTeam,
    secondSquad,
    firstSquad,
    pitch,
    venue,
    first.runs + 1,
    `${seed}:second`,
    input.difficulty,
  );
  let winner: string, summary: string;
  if (second.runs > first.runs) {
    winner = second.team;
    summary = `${winner} won by ${10 - second.wickets} wickets`;
  } else if (first.runs > second.runs) {
    winner = first.team;
    summary = `${winner} won by ${first.runs - second.runs} runs`;
  } else {
    winner = seededUnit(`${seed}:superover`) > 0.5 ? first.team : second.team;
    summary = `${winner} won after a Super Over`;
  }
  const playerOfMatch = playerOfMatchFromWinner(winner, first, second);
  return {
    pitch,
    venue: String(venue.stadium_name ?? "DugoutX Stadium"),
    first,
    second,
    winner,
    summary,
    playerOfMatch,
  };
}

export function calibrateMatchEngine(runs = 100) {
  const teams = [
    "CHE",
    "MUM",
    "BLR",
    "KOL",
    "DEL",
    "HYD",
    "PUN",
    "RAJ",
    "LKN",
    "GUJ",
  ];
  let inningsCount = 0,
    totalBalls = 0,
    totalRuns = 0,
    totalWickets = 0,
    totalPowerplayWickets = 0,
    tailSixes = 0,
    immediateSixes = 0,
    earlyAllOut = 0,
    bowlerTopFour = 0,
    under100 = 0,
    over220 = 0,
    chases = 0;
  for (let index = 0; index < runs; index++) {
    const home = teams[index % teams.length],
      away =
        teams[(index * 3 + 1) % teams.length] === home
          ? teams[(index + 4) % teams.length]
          : teams[(index * 3 + 1) % teams.length];
    const result = simulateT20Match({
      code: `CAL-${index}`,
      fixtureId: index + 1,
      home,
      away,
      homeSquad: getTeamRoster(home),
      awaySquad: getTeamRoster(away),
      difficulty: "Expert",
    });
    for (const item of [result.first, result.second]) {
      inningsCount++;
      const [completedOvers, ballsInOver] = item.overs.split(".").map(Number);
      totalBalls += completedOvers * 6 + ballsInOver;
      totalRuns += item.runs;
      totalWickets += item.wickets;
      totalPowerplayWickets += item.diagnostics?.powerplayWickets ?? 0;
      tailSixes += item.diagnostics?.tailSixes ?? 0;
      immediateSixes += item.diagnostics?.sixesWithinThreeBallsOfWicket ?? 0;
      if (item.wickets === 10 && Number(item.overs.split(".")[0]) < 10) earlyAllOut++;
      const roster = item.team === home ? getTeamRoster(home) : getTeamRoster(away);
      const ordered = selectLineup(roster, result.pitch, "Expert").battingOrder.slice(0, 4);
      if (ordered.some(id => roster.find(player => player.id === id)?.role === "PACE" || roster.find(player => player.id === id)?.role === "SPIN")) bowlerTopFour++;
      if (item.runs < 100) under100++;
      if (item.runs > 220) over220++;
    }
    if (result.winner === result.second.team) chases++;
  }
  return {
    runs,
    legalBalls: totalBalls,
    averageScore: Math.round((totalRuns / inningsCount) * 10) / 10,
    averageWickets: Math.round((totalWickets / inningsCount) * 10) / 10,
    averagePowerplayWickets: Math.round((totalPowerplayWickets / inningsCount) * 100) / 100,
    tailSixesPerInnings: Math.round((tailSixes / inningsCount) * 1000) / 1000,
    sixesWithinThreeBallsOfWicketPerInnings: Math.round((immediateSixes / inningsCount) * 1000) / 1000,
    earlyAllOutRate: Math.round((earlyAllOut / inningsCount) * 1000) / 1000,
    bowlerTopFourRate: Math.round((bowlerTopFour / inningsCount) * 1000) / 1000,
    under100Rate: Math.round((under100 / inningsCount) * 1000) / 1000,
    over220Rate: Math.round((over220 / inningsCount) * 1000) / 1000,
    chaseWinRate: Math.round((chases / runs) * 1000) / 1000,
  };
}

export function calibrateContainConfidence(samples = 10000) {
  const batter = getTeamRoster("BLR").find(player => player.name === "Virat Kohli");
  const bowler = getTeamRoster("DEL").find(player => player.name === "Mitchell Starc");
  if (!batter || !bowler) throw new Error("Calibration players missing");
  const scenarios = [
    { pitch: "Flat" as PitchType, ballsFaced: 2, runsScored: 2, fours: 0 },
    { pitch: "Flat" as PitchType, ballsFaced: 18, runsScored: 24, fours: 2 },
    { pitch: "Dry" as PitchType, ballsFaced: 2, runsScored: 2, fours: 0 },
    { pitch: "Dry" as PitchType, ballsFaced: 18, runsScored: 24, fours: 2 },
  ];
  const results = scenarios.map(scenario => {
    const model = liveDeliveryProbabilities({
      batter, bowler, pitch: scenario.pitch, over: 17,
      battingPosition: 1, ballsFaced: scenario.ballsFaced,
      runsScored: scenario.runsScored, fours: scenario.fours, sixes: 0,
      inningsSeed: "contain-calibration", battingApproach: "Rotate",
      bowlingApproach: "Contain", field: "Defensive", fieldingRating: 75,
      wickets: 4, ballsSinceWicket: 9, bowlerRuns: 20,
    });
    return { pitch: scenario.pitch, ballsFaced: scenario.ballsFaced,
      confidence: model.confidence, sixChance: model.probabilities[5],
      deliveries: 0, sixes: 0, boundaries: 0, wickets: 0, model };
  });
  for (let index = 0; index < samples; index++) {
    const scenario = results[index % results.length];
    const outcome = weighted(`contain-calibration:${scenario.pitch}:${scenario.ballsFaced}:${index}`, scenario.model.probabilities);
    scenario.deliveries++;
    if (outcome === 5) scenario.sixes++;
    if (outcome === 4 || outcome === 5) scenario.boundaries++;
    if (outcome === 6) scenario.wickets++;
  }
  return { sampledBalls: samples, scenarios: results.map(({ model: _model, ...result }) => {
    void _model;
    return { ...result,
      sixChance: Math.round(result.sixChance * 1000) / 10,
      sampledSixRate: Math.round(result.sixes / result.deliveries * 1000) / 10,
      sampledBoundaryRate: Math.round(result.boundaries / result.deliveries * 1000) / 10,
      sampledWicketRate: Math.round(result.wickets / result.deliveries * 1000) / 10,
    };
  }) };
}

export function calibratePowerplaySpin(oversPerScenario = 250) {
  const batter = getTeamRoster("BLR").find(player => player.name === "Virat Kohli");
  const bowlers = [
    getTeamRoster("KOL").find(player => player.name === "Varun Chakravarthy"),
    getTeamRoster("BLR").find(player => player.name === "Krunal Pandya"),
    getTeamRoster("CHE").find(player => player.name === "Akeal Hosein"),
    getTeamRoster("DEL").find(player => player.name === "Mitchell Starc"),
  ];
  if (!batter || bowlers.some(player => !player)) throw new Error("Calibration players missing");
  const scenarios = bowlers.flatMap(bowler => (["Flat", "Dry"] as PitchType[]).map(pitch => {
    let highScoringOvers = 0, totalRuns = 0, boundaries = 0;
    for (let sample = 0; sample < oversPerScenario; sample++) {
      let runs = 0;
      for (let ball = 0; ball < 6; ball++) {
        const model = liveDeliveryProbabilities({
          batter, bowler: bowler!, pitch, over: 2, battingPosition: 1,
          ballsFaced: 8 + ball, runsScored: 10 + runs,
          inningsSeed: `powerplay-spin:${sample}`, battingApproach: "Rotate",
          bowlingApproach: "Balanced", field: "Balanced", fieldingRating: 75,
          wickets: 1, ballsSinceWicket: 12, bowlerRuns: 0,
        });
        const outcome = weighted(`powerplay-spin:${bowler!.id}:${pitch}:${sample}:${ball}`, model.probabilities);
        if (outcome === 4 || outcome === 5) boundaries++;
        runs += [0, 1, 2, 3, 4, 6, 0][outcome];
      }
      totalRuns += runs;
      if (runs >= 15) highScoringOvers++;
    }
    return { bowler: bowler!.name, pitch, highScoringOverRate: Math.round(highScoringOvers / oversPerScenario * 1000) / 10,
      averageRuns: Math.round(totalRuns / oversPerScenario * 10) / 10,
      boundaryRate: Math.round(boundaries / (oversPerScenario * 6) * 1000) / 10 };
  }));
  return { sampledBalls: scenarios.length * oversPerScenario * 6, scenarios };
}
