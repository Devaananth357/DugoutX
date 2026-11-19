import marketValues from "../../../data/ml/player-market-values.json";
import type { AiPlayer } from "./types";

export type LearnedMarketValue = {
  name: string;
  team: string;
  minValue: number;
  marketValue: number;
  maxValue: number;
  retentionProbability: number;
  labelSource: string;
};

const learnedValues = marketValues as Record<string, LearnedMarketValue>;

export function getLearnedMarketValue(player: AiPlayer) {
  return learnedValues[String(player.id)];
}
