import { AI_PROFILES } from "./profiles";
import { clamp, seededUnit } from "./math";
import { getLearnedMarketValue } from "./market-model";
import { isOpener, minimumPlacesNeeded, squadCounts, squadGaps, SQUAD_MINIMUMS } from "./squad-balance";
import type { AiDifficulty, AiPlayer, AuctionDecision, AuctionState, PlayerRole } from "./types";

const targets: Record<PlayerRole, number> = { WK: 2, BAT: 6, AR: 3, PACE: 5, SPIN: 3 };

export function decideAuctionBid(player: AiPlayer, state: AuctionState, difficulty: AiDifficulty): AuctionDecision {
  const profile = AI_PROFILES[difficulty];
  const counts = squadCounts(state.squad);
  const gaps = squadGaps(state.squad);
  const roleGap = gaps.roleGaps[player.role];
  const helpsOpener = isOpener(player) && gaps.openerGap > 0;
  const need = clamp((targets[player.role] - counts.roles[player.role]) / targets[player.role], -.35, 1);
  const quality = player.role === "BAT" || player.role === "WK" ? player.batting :
    player.role === "AR" ? (player.batting + player.bowling) / 2 : player.bowling;
  const condition = player.form * .45 + player.confidence * .35 + player.fitness * .2;
  const criticalBoost = roleGap > 0 ? (player.role === "WK" ? 1.24 : 1.13) : helpsOpener ? 1.14 : 1;
  const noise = (seededUnit(`${state.seed}:${player.id}`) - .5) * 2 * profile.valuationError;
  const valuation = clamp((quality * .72 + condition * .28) * (1 + need * .45) * criticalBoost * (1 + noise), 1, 100);

  const slotsLeft = Math.max(1, state.squadLimit - state.squad.length);
  const minimumSlotCost = 1.25;
  const overseasBlocked = player.overseas && state.squad.filter(item => item.overseas).length >= state.overseasLimit;
  const squadFull = state.squad.length >= state.squadLimit;
  const slotsAfter = state.squadLimit - state.squad.length - 1;
  const neededAfter = minimumPlacesNeeded([...state.squad, player]);
  const compositionBlocked = neededAfter > slotsAfter;
  const mandatoryReserve = Math.max(0, slotsAfter) * minimumSlotCost + neededAfter * .75;
  const maxAffordable = Math.max(0, state.budget - mandatoryReserve);

  const playerLevel = quality * .78 + condition * .22;
  const qualityBand = clamp((playerLevel - 50) / 50, 0, 1);
  const learned = getLearnedMarketValue(player);
  const marketSwing = .97 + seededUnit(`${state.seed}:market:${player.id}`) * .12;
  const needMultiplier = clamp(.92 + Math.max(0, need) * .28, .92, 1.2);
  const rolePremium = player.role === "AR" ? 1.05 : player.role === "WK" && roleGap > 0 ? 1.08 : 1;
  const baseFairValue = learned?.marketValue ?? (.5 + Math.pow(qualityBand, 2.1) * 17.5);
  // Each room and bidder values a lot slightly differently. The range favours
  // a modest premium, while a lower result stays close to the model estimate.
  const priceVariation =
    (-.5 + seededUnit(`${state.seed}:lot-price:${player.id}`) * 2) *
    clamp(baseFairValue / 11.5, .25, 1);
  const auctionFloor = learned?.minValue ?? .5;
  const exceptionalStar = learned?.labelSource === "EXPERT_ANCHOR" && learned.marketValue >= 18;
  const auctionCeiling = Math.max(
    auctionFloor,
    Math.min(exceptionalStar ? 21 : 20, (learned?.maxValue ?? 18) + priceVariation),
  );
  const scarcityPremium: Record<PlayerRole, number> = { BAT: 1.08, WK: 1.35, AR: 1.25, PACE: 1.1, SPIN: 1.2 };
  const surplusOpenerFactor = isOpener(player) && !helpsOpener ? .85 : 1;
  const fairValue = clamp(baseFairValue * marketSwing * needMultiplier * rolePremium * (roleGap > 0 ? scarcityPremium[player.role] : 1) * (helpsOpener ? 1.35 : 1) * surplusOpenerFactor + priceVariation, auctionFloor, auctionCeiling);
  const budgetPerOpenSlot = state.budget / slotsLeft;
  const squadPlanningFactor = 1.35 + qualityBand * 3.05;
  const rawPortfolioCap = budgetPerOpenSlot * squadPlanningFactor * (.92 + Math.max(0, need) * .22) + priceVariation;
  const portfolioCap = learned?.labelSource === "EXPERT_ANCHOR" ? Math.max(auctionFloor, rawPortfolioCap) : rawPortfolioCap;
  const urgency = slotsLeft <= 4 ? 1.05 : 1;
  const maxBid = Math.round(Math.min(maxAffordable, fairValue * urgency, portfolioCap, auctionCeiling) * 100) / 100;
  const nextBid = state.currentBid + state.increment;
  const bid = !overseasBlocked && !squadFull && !compositionBlocked && nextBid <= maxBid;
  const reasons = [
    `${player.role} need: ${need > .35 ? "high" : need > 0 ? "moderate" : "covered"}`,
    learned ? `ML market range: ₹${learned.minValue}-${learned.maxValue} crore` : `Player valuation: ${valuation.toFixed(1)}/100`,
    slotsLeft > 1 ? `Reserving at least ${mandatoryReserve.toFixed(2)} for ${slotsLeft - 1} slots` : "Final squad slot",
  ];
  if (helpsOpener) reasons.unshift("Opening batter needed");
  if (roleGap > 0) reasons.unshift(`${player.role} squad minimum: ${SQUAD_MINIMUMS[player.role]}`);
  if (overseasBlocked) reasons.unshift("Overseas-player limit reached");
  if (squadFull) reasons.unshift("Squad is full");
  if (compositionBlocked) reasons.unshift("Remaining places reserved for missing squad roles");
  return { bid, amount: bid ? nextBid : null, maxBid, valuation: Math.round(valuation * 10) / 10,
    confidence: clamp(.65 + profile.adaptation * .25 - Math.abs(noise), .45, .95), reasons };
}
