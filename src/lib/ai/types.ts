export type AiDifficulty = "Balanced" | "Competitive" | "Expert";
export type PlayerRole = "WK" | "BAT" | "AR" | "PACE" | "SPIN";
export type BattingIntent = "Defend" | "Rotate" | "Attack";
export type MatchPhase = "Powerplay" | "Middle" | "Death";
export type PitchType = "Flat" | "Slow" | "Dry" | "Green" | "Bouncy";

export type AiPlayer = {
  id:number; name:string; role:PlayerRole; overseas:boolean; uncapped?:boolean;
  team?:string; nationality?:string; baseSalary?:number; battingStyle?:string; bowlingStyle?:string; consistencyType?:string; battingPosition?:number;
  batting:number; bowling:number; fielding:number; keeping?:number;
  form:number; confidence:number; fitness:number;
  paceRating?:number; spinRating?:number; pitchRatings?:Partial<Record<PitchType,number>>;
  weaknesses?:Array<{type:string;bowlingStyle:string;pitch:string;phase:string;severity:number;activationAfterBalls:number;maximumWicketModifier:number}>;
};

export type AuctionState = {
  budget:number; currentBid:number; increment:number; squad:AiPlayer[];
  squadLimit:number; overseasLimit:number; seed:string;
};
export type AuctionDecision = { bid:boolean; amount:number|null; maxBid:number; valuation:number; confidence:number; reasons:string[] };
export type RetentionPick = { slot:1|2|3|4|5; player:AiPlayer; cost:number; estimatedAuctionValue:number; reasons:string[] };
export type RetentionDecision = { picks:RetentionPick[]; totalCost:number; auctionPurse:number; releasedPlayerIds:number[]; reasons:string[] };

export type MatchSituation = {
  innings:1|2; phase:MatchPhase; over:number; ball:number; score:number; wickets:number;
  target?:number; ballsRemaining:number; pitch:PitchType; dew:number;
  batter:AiPlayer; bowler:AiPlayer; recentRuns:number[]; seed:string;
};
export type BattingDecision = { intent:BattingIntent; confidence:number; reasons:string[] };
export type BowlingDecision = {
  line:"Off stump"|"Middle stump"|"Wide outside off"|"Body";
  length:"Yorker"|"Full"|"Good"|"Back of length"|"Short";
  variation:"Stock"|"Slower ball"|"Swing"|"Seam"|"Turn"|"Flight";
  field:"Attack"|"Balanced"|"Protect"; confidence:number; reasons:string[];
};

export type LineupDecision = { playerIds:number[]; battingOrder:number[]; captainId:number; wicketkeeperId:number; reasons:string[] };
