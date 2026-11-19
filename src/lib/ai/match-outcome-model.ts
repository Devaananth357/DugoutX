import model from "../../../data/ai/match-outcome-model.json";

export const DELIVERY_OUTCOMES = ["0", "1", "2", "3", "4", "6", "W"] as const;
type Phase = "PP" | "MID" | "DEATH";

export function learnedDeliveryProbabilities(input: {
  over: number;
  wickets: number;
  battingPosition: number;
  ballsFaced: number;
  ballsSinceWicket: number;
}) {
  const phase: Phase = input.over < 6 ? "PP" : input.over < 16 ? "MID" : "DEATH";
  const wickets = input.wickets <= 2 ? "LOW" : input.wickets <= 5 ? "MID" : "HIGH";
  const position = input.battingPosition <= 3 ? "TOP" : input.battingPosition <= 7 ? "MIDDLE" : "TAIL";
  const settled = input.ballsFaced < 5 ? "NEW" : input.ballsFaced < 15 ? "SET" : "EST";
  const afterWicket = input.ballsSinceWicket < 3 ? "AFTER" : "NORMAL";
  const key = `${phase}|${wickets}|${position}|${settled}|${afterWicket}`;
  const groups = model.groups as Record<string, number[]>;
  const fallback = model.phase as Record<Phase, number[]>;
  return groups[key] ?? fallback[phase];
}
