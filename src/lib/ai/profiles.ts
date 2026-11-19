import type { AiDifficulty } from "./types";

export type AiProfile = { valuationError:number; riskTolerance:number; futurePlanning:number; adaptation:number };
export const AI_PROFILES:Record<AiDifficulty,AiProfile> = {
  Balanced:{valuationError:.09,riskTolerance:.46,futurePlanning:1,adaptation:.55},
  Competitive:{valuationError:.04,riskTolerance:.53,futurePlanning:2,adaptation:.78},
  Expert:{valuationError:.015,riskTolerance:.57,futurePlanning:3,adaptation:.94},
};
