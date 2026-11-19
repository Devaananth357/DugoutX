import { AI_PROFILES } from "./profiles";
import { average, clamp, seededUnit } from "./math";
import type { AiDifficulty, BattingDecision, BowlingDecision, MatchSituation } from "./types";

export function decideBattingIntent(state:MatchSituation,difficulty:AiDifficulty):BattingDecision{
  const profile=AI_PROFILES[difficulty]; const required=state.target?Math.max(0,state.target-state.score)/(state.ballsRemaining/6):0;
  const recent=average(state.recentRuns.slice(-6)); const wicketsInHand=10-state.wickets;
  const matchup=(state.batter.batting-state.bowler.bowling)/20; let attack=.38+profile.riskTolerance*.18+matchup*.1;
  if(state.phase==="Death")attack+=.22;if(required>10)attack+=.2;if(required>13)attack+=.15;if(wicketsInHand<=3)attack-=.24;if(recent<.7)attack+=.08;
  const jitter=(seededUnit(`${state.seed}:bat`)-.5)*(1-profile.adaptation)*.16; attack=clamp(attack+jitter,0,1);
  const intent=attack>.68?"Attack":attack<.32?"Defend":"Rotate";
  return{intent,confidence:clamp(.62+profile.adaptation*.28-Math.abs(jitter),.5,.96),reasons:[required?`Required rate ${required.toFixed(2)}`:"Setting a first-innings total",`${wicketsInHand} wickets in hand`,matchup>.3?"Batter has the matchup edge":matchup<-.3?"Bowler has the matchup edge":"Even player matchup",`${state.phase} phase`]};
}

export function decideBowlingPlan(state:MatchSituation,difficulty:AiDifficulty):BowlingDecision{
  const profile=AI_PROFILES[difficulty]; const required=state.target?Math.max(0,state.target-state.score)/(state.ballsRemaining/6):0; const isPace=state.bowler.role==="PACE";
  let length:BowlingDecision["length"]="Good",line:BowlingDecision["line"]="Off stump",variation:BowlingDecision["variation"]=isPace?"Seam":"Turn",field:BowlingDecision["field"]="Balanced";
  if(state.phase==="Death"){length=isPace?"Yorker":"Full";line="Wide outside off";variation=isPace?"Slower ball":"Flight";field="Protect";}
  else if(state.pitch==="Bouncy"&&isPace){length="Back of length";line="Body";variation="Stock";field="Attack";}
  else if(state.pitch==="Green"&&isPace){length="Good";variation="Swing";field="Attack";}
  else if((state.pitch==="Dry"||state.pitch==="Slow")&&!isPace){length="Full";variation="Flight";field="Attack";}
  if(required>12)field="Protect";else if(required<6&&state.phase!=="Death")field="Attack";
  return{line,length,variation,field,confidence:clamp(.6+profile.adaptation*.32,.55,.95),reasons:[`${state.pitch} pitch`,`${state.phase} phase`,required?`Required rate ${required.toFixed(2)}`:"First-innings pressure",isPace?"Pace-bowling plan":"Spin-bowling plan"]};
}
