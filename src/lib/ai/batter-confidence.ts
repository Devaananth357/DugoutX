import { clamp, seededUnit } from "./math";

export function batterMatchConfidence(input: {
  playerId: number;
  batting: number;
  baseConfidence: number;
  role: string;
  pitch: string;
  battingPosition: number;
  balls: number;
  runs: number;
  fours: number;
  sixes: number;
  inningsSeed: string;
}) {
  const { battingPosition, role, balls } = input;
  const roleTempo = role === "PACE" || role === "SPIN" ? 1.25 : role === "AR" ? 0.94 : 1;
  const positionTempo = battingPosition <= 2 ? 17 : battingPosition <= 4 ? 12 : battingPosition <= 7 ? 7.5 : 10;
  const variation = 0.78 + seededUnit(`${input.inningsSeed}:${input.playerId}:settle`) * 0.44;
  const skillTempo = clamp(1 - (input.batting - 75) * 0.004, 0.82, 1.18);
  const surfaceTempo = input.pitch === "Flat" ? 0.68 :
    input.pitch === "Dry" ? 1.38 :
    input.pitch === "Slow" ? 1.3 :
    input.pitch === "Green" ? 1.15 : 1;
  const settlingBalls = positionTempo * roleTempo * variation * skillTempo * surfaceTempo;
  const progress = 1 - Math.exp(-Math.max(0, balls) / settlingBalls);
  const startingConfidence = 37 + (input.baseConfidence - 60) * 0.22 + (input.batting - 70) * 0.08;
  const momentum = clamp((input.runs - balls * 1.1) * 0.28, -8, 8);
  const boundaries = Math.min(5, input.fours * 0.45 + input.sixes * 1.4);
  return {
    value: Math.round(clamp(startingConfidence + 43 * progress + momentum + boundaries, 20, 95)),
    progress: clamp(progress + Math.max(0, momentum) / 80, 0, 1),
  };
}
