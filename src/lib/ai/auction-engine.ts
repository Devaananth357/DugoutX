import { decideAuctionBid } from "./auction";
import { decideRetentions, MAX_AUCTION_PURSE } from "./retention";
import { seededUnit } from "./math";
import { isOpener, squadBalanceViolations } from "./squad-balance";
import { SHEET_PLAYERS } from "./sheet-data";
import { selectLineup } from "./lineup";
import auctionOrder from "../../../data/ai/auction-order.json";
import type { AiDifficulty, AiPlayer, PlayerRole } from "./types";

export type AuctionTeam={id:string;difficulty:AiDifficulty;budget:number;squad:AiPlayer[];spent:number};
export type AuctionResult={teams:AuctionTeam[];sold:number;unsold:number;averagePrice:number;violations:string[]};
const rolePattern:PlayerRole[]=["BAT","BAT","BAT","WK","AR","AR","PACE","PACE","PACE","SPIN","SPIN"];

export function createCalibrationPool(seed:string,size=240):AiPlayer[]{
  return Array.from({length:size},(_,index)=>{const unit=seededUnit(`${seed}:quality:${index}`);const quality=Math.round(55+Math.pow(unit,1.8)*40);const role=rolePattern[index%rolePattern.length];const batting=role==="BAT"||role==="WK"?quality:role==="AR"?quality-3:Math.round(40+unit*25);const bowling=role==="PACE"||role==="SPIN"?quality:role==="AR"?quality-2:Math.round(25+unit*25);return{id:index+1,name:`Calibration Player ${index+1}`,role,battingPosition:role==="BAT"||role==="WK"||role==="AR"?index%3===0?1:index%3===1?2:5:11,overseas:index%4===0,uncapped:quality<72&&index%3===0,batting,bowling,fielding:Math.round(60+seededUnit(`${seed}:field:${index}`)*30),keeping:role==="WK"?quality:undefined,form:Math.round(62+seededUnit(`${seed}:form:${index}`)*30),confidence:Math.round(62+seededUnit(`${seed}:confidence:${index}`)*30),fitness:Math.round(72+seededUnit(`${seed}:fitness:${index}`)*25)};});
}

export function runAiAuction(players:AiPlayer[],seed:string,difficulties:AiDifficulty[]=["Competitive"],initialTeams?:AuctionTeam[],preserveOrder=false):AuctionResult{
  const teams:AuctionTeam[]=initialTeams??Array.from({length:10},(_,index)=>({id:`AI-${index+1}`,difficulty:difficulties[index%difficulties.length],budget:MAX_AUCTION_PURSE,squad:[],spent:0}));
  let sold=0,totalPrice=0;const ordered=preserveOrder?[...players]:[...players].sort((a,b)=>seededUnit(`${seed}:order:${a.id}`)-seededUnit(`${seed}:order:${b.id}`));
  for(const player of ordered){if(teams.every(team=>team.squad.length>=25))break;const base=player.role==="AR"?1.5:1;const increment=.25;
    const candidates=teams.filter(team=>team.squad.length<25).map(team=>{const decision=decideAuctionBid(player,{budget:team.budget,currentBid:base-increment,increment,squad:team.squad,squadLimit:25,overseasLimit:8,seed:`${seed}:${team.id}`},team.difficulty);return{team,decision};}).filter(item=>item.decision.bid).sort((a,b)=>b.decision.maxBid-a.decision.maxBid||seededUnit(`${seed}:tie:${player.id}:${a.team.id}`)-seededUnit(`${seed}:tie:${player.id}:${b.team.id}`));
    if(!candidates.length)continue;const winner=candidates[0];const second=candidates[1]?.decision.maxBid??base;const price=Math.min(winner.decision.maxBid,Math.max(base,Math.ceil((second+increment)*4)/4));if(price>winner.team.budget)continue;
    winner.team.squad.push(player);winner.team.budget=Math.round((winner.team.budget-price)*100)/100;winner.team.spent=Math.round((winner.team.spent+price)*100)/100;sold++;totalPrice+=price;
  }
  const violations:string[]=[];for(const team of teams){if(team.squad.length<18||team.squad.length>25)violations.push(`${team.id}: invalid squad ${team.squad.length}`);violations.push(...squadBalanceViolations(team.squad).map(problem=>`${team.id}: ${problem}`));if(team.squad.filter(player=>player.overseas).length>8)violations.push(`${team.id}: overseas limit`);if(team.budget<0)violations.push(`${team.id}: negative budget`);if(team.squad.length>=11){const lineup=selectLineup(team.squad,"Flat",team.difficulty);const xi=lineup.playerIds.map(id=>team.squad.find(player=>player.id===id)!);const count=(role:PlayerRole)=>xi.filter(player=>player.role===role).length;if(xi.length!==11||new Set(lineup.playerIds).size!==11)violations.push(`${team.id}: invalid playing XI`);if(xi.filter(isOpener).length<2||!lineup.battingOrder.slice(0,2).every(id=>isOpener(team.squad.find(player=>player.id===id)!)))violations.push(`${team.id}: missing opening pair in XI`);if(count("WK")<1||count("AR")<1||count("PACE")<2||count("SPIN")<1)violations.push(`${team.id}: unbalanced playing XI`);}}
  return{teams,sold,unsold:players.length-sold,averagePrice:sold?Math.round(totalPrice/sold*100)/100:0,violations};
}

export function runRetentionAuction(seed:string):AuctionResult{
  const entirePool=createCalibrationPool(`${seed}:all`,340);const previousRosters=Array.from({length:10},(_,index)=>entirePool.slice(index*18,index*18+18));
  const retainedIds=new Set<number>();const initialTeams:AuctionTeam[]=previousRosters.map((roster,index)=>{const difficulty=(["Balanced","Competitive","Expert"] as AiDifficulty[])[index%3];const decision=decideRetentions(roster,difficulty,`${seed}:team:${index}`);decision.picks.forEach(pick=>retainedIds.add(pick.player.id));return{id:`AI-${index+1}`,difficulty,budget:decision.auctionPurse,squad:decision.picks.map(pick=>pick.player),spent:0};});
  const auctionPool=entirePool.filter(player=>!retainedIds.has(player.id));return runAiAuction(auctionPool,seed,["Balanced","Competitive","Expert"],initialTeams);
}

export function runSheetRetentionAuction(seed:string):AuctionResult{
  const teamCodes=["CSK","RCB","MI","KKR","DC","SRH","PBKS","RR","LSG","GT"];
  const retainedIds=new Set<number>();
  const initialTeams:AuctionTeam[]=teamCodes.map((id,index)=>{
    const difficulty=(["Balanced","Competitive","Expert"] as AiDifficulty[])[index%3];
    const roster=SHEET_PLAYERS.filter(player=>player.team===id);
    const decision=decideRetentions(roster,difficulty,`${seed}:team:${id}`);
    decision.picks.forEach(pick=>retainedIds.add(pick.player.id));
    return{id,difficulty,budget:decision.auctionPurse,squad:decision.picks.map(pick=>pick.player),spent:0};
  });
  const byId=new Map(SHEET_PLAYERS.map(player=>[player.id,player]));
  const players=auctionOrder.sets.flatMap(set=>set.playerIds.map(id=>byId.get(id)).filter((player):player is AiPlayer=>!!player&&!retainedIds.has(player.id)));
  return runAiAuction(players,seed,["Balanced","Competitive","Expert"],initialTeams,true);
}

export function calibrateSheetAuction(runs=100):CalibrationReport{
  let legal=0,complete=0,budget=0,price=0,totalTeams=0;
  const examples:string[]=[];
  for(let run=0;run<runs;run++){
    const result=runSheetRetentionAuction(`sheet-auction-${run}`);
    price+=result.averagePrice;
    for(const team of result.teams){
      totalTeams++;budget+=team.budget;
      const problems=result.violations.filter(item=>item.startsWith(team.id+":"));
      if(!problems.length)legal++;
      if(team.squad.length>=18&&team.squad.length<=25)complete++;
      if(examples.length<8)examples.push(...problems.slice(0,8-examples.length).map(problem=>`run ${run}: ${problem} (${team.squad.length} players, ₹${team.budget} left)`));
    }
  }
  const violationRate=1-legal/totalTeams;
  const averageRemainingBudget=Math.round(budget/totalTeams*100)/100;
  return{runs,legalSquads:legal,completeSquads:complete,averageRemainingBudget,averagePrice:Math.round(price/runs*100)/100,violationRate:Math.round(violationRate*10000)/10000,passed:violationRate===0&&complete===totalTeams&&averageRemainingBudget<1,examples};
}

export function calibrateRetentionAuction(runs=100):CalibrationReport{
  let legal=0,complete=0,budget=0,price=0,totalTeams=0;const examples:string[]=[];for(let run=0;run<runs;run++){const result=runRetentionAuction(`retention-auction-${run}`);price+=result.averagePrice;for(const team of result.teams){totalTeams++;budget+=team.budget;const problems=result.violations.filter(item=>item.startsWith(team.id+":"));if(!problems.length)legal++;if(team.squad.length>=18&&team.squad.length<=25)complete++;if(examples.length<8)examples.push(...problems.slice(0,8-examples.length));}}const violationRate=1-legal/totalTeams;const averageRemainingBudget=Math.round(budget/totalTeams*100)/100;return{runs,legalSquads:legal,completeSquads:complete,averageRemainingBudget,averagePrice:Math.round(price/runs*100)/100,violationRate:Math.round(violationRate*10000)/10000,passed:violationRate===0&&complete===totalTeams&&averageRemainingBudget<1,examples};
}

export type CalibrationReport={runs:number;legalSquads:number;completeSquads:number;averageRemainingBudget:number;averagePrice:number;violationRate:number;passed:boolean;examples:string[]};
export function calibrateAuctionAi(runs=100):CalibrationReport{
  let legal=0,complete=0,budget=0,price=0,totalTeams=0;const examples:string[]=[];
  for(let run=0;run<runs;run++){const seed=`calibration-${run}`;const result=runAiAuction(createCalibrationPool(seed,340),seed,["Balanced","Competitive","Expert"]);price+=result.averagePrice;for(const team of result.teams){totalTeams++;budget+=team.budget;const teamViolations=result.violations.filter(item=>item.startsWith(team.id+":"));if(!teamViolations.length)legal++;if(team.squad.length>=18&&team.squad.length<=25)complete++;if(examples.length<8)examples.push(...teamViolations.slice(0,8-examples.length));}}
  const violationRate=1-legal/totalTeams;return{runs,legalSquads:legal,completeSquads:complete,averageRemainingBudget:Math.round(budget/totalTeams*100)/100,averagePrice:Math.round(price/runs*100)/100,violationRate:Math.round(violationRate*10000)/10000,passed:violationRate<=.03&&complete/totalTeams>=.9,examples};
}
