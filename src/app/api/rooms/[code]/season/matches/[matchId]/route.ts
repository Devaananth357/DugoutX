import { getSeasonMatchRoom,simulateSeasonMatch,updateMatchPreparation } from "@/lib/local-db";
import { getAuctionPlayer } from "@/lib/auction-order";
import { displayTeamCode,teamRepresentative } from "@/lib/team-representatives";
import { playerOfMatchFromWinner } from "@/lib/ai/player-of-match";
import { notModified, snapshotJson, snapshotTag } from "@/lib/live-response";

type Context={params:Promise<{code:string;matchId:string}>};
type MatchRoom=NonNullable<Awaited<ReturnType<typeof getSeasonMatchRoom>>>;
function matchResponse(room:MatchRoom,matchId:number){
  const fixture=room.season!.fixtures.find(item=>item.id===matchId);if(!fixture)return null;
  const teamData=(team:string)=>{const retention=room.retentions?.find(item=>item.team===team);const retained=retention?.decision?.picks.map(pick=>({...pick.player,...(getAuctionPlayer(pick.player.id)??{}),price:pick.cost,retained:true}))??[];const bought=room.auction?.purchases.filter(item=>item.team===team).map(item=>({...getAuctionPlayer(item.playerId)!,price:item.price,retained:false}))??[];return{team,display:displayTeamCode(team),owner:retention?.manager??teamRepresentative(team),players:[...retained,...bought]};};
  const result=fixture.result;
  const hasFigures=result&&Array.isArray(result.first?.batting)&&Array.isArray(result.second?.batting)&&Array.isArray(result.first?.bowling)&&Array.isArray(result.second?.bowling);
  const matchFixture=hasFigures?{...fixture,result:{...result,playerOfMatch:playerOfMatchFromWinner(result.winner,result.first,result.second)}}:fixture;
  return{code:room.code,host:room.host,players:room.players,fixture:matchFixture,home:teamData(fixture.home),away:teamData(fixture.away),currentMatch:room.season!.currentMatch};
}
const snapshots=new Map<string,{tag:string;payload:NonNullable<ReturnType<typeof matchResponse>>}>();
function matchSnapshot(room:MatchRoom,matchId:number){
  const fixture=room.season!.fixtures.find(item=>item.id===matchId);
  if(!fixture)return null;
  const tag=snapshotTag([room.stage,room.players,room.season!.currentMatch,fixture]);
  const key=`${room.code}:${matchId}`;
  let cached=snapshots.get(key);
  if(cached?.tag!==tag){
    const payload=matchResponse(room,matchId);
    if(!payload)return null;
    cached={tag,payload};
    snapshots.set(key,cached);
    if(snapshots.size>24)snapshots.delete(snapshots.keys().next().value!);
  }
  return cached;
}
export async function GET(request:Request,{params}:Context){
  const {code,matchId}=await params;
  const id=Number(matchId);
  const room=await getSeasonMatchRoom(code,id);
  if(!room)return Response.json({error:"Match not found."},{status:404});
  const fixture=room.season!.fixtures.find(item=>item.id===id);
  if(!fixture)return Response.json({error:"Match not found."},{status:404});
  const tag=snapshotTag([room.stage,room.players,room.season!.currentMatch,fixture]);
  const unchanged=notModified(request,tag);
  if(unchanged)return unchanged;
  const snapshot=matchSnapshot(room,id);
  return snapshot?snapshotJson(snapshot.payload,tag):Response.json({error:"Match not found."},{status:404});
}
export async function PATCH(request:Request,{params}:Context){const {code,matchId}=await params;const input=await request.json();try{const room=input.action==="simulate"?await simulateSeasonMatch(code,Number(matchId),String(input.name??"")):await updateMatchPreparation(code,Number(matchId),String(input.name??""),input.action,input);const snapshot=matchSnapshot(room,Number(matchId));return snapshot?snapshotJson(snapshot.payload,snapshot.tag):Response.json({error:"Match not found."},{status:404});}catch(error){const key=error instanceof Error?error.message:"";const errors:Record<string,string>={HOST_ONLY:"Only the season creator can simulate the match.",HOME_ONLY:"Only the home-team manager can prepare the pitch.",NOT_PARTICIPANT:"Only managers in this match can make that decision.",AWAY_CALL_ONLY:"Only the away-team manager can call heads or tails.",INVALID_COIN_CALL:"Choose heads or tails.",INVALID_TACTICS:"Choose valid tactics and players from your XI.",WRONG_STAGE:"Complete the current match preparation step first.",INVALID_PITCH:"Choose a valid pitch type.",INVALID_LINEUP:"Select exactly 11 players from your squad.",UNBALANCED_LINEUP:"Your XI needs a wicketkeeper and at least four bowling options.",TOSS_DONE:"The toss has already been completed.",TOSS_WINNER_ONLY:"Only the toss winner can choose to bat or bowl.",MATCH_NOT_READY:"Complete pitch, XI selection and toss before simulating.",MATCH_OUT_OF_SYNC:"Another ball was played. Score refreshed; try again.",SEASON_NOT_FOUND:"Season not found.",MATCH_NOT_FOUND:"Match not found."};return Response.json({error:errors[key]??"Could not update this match."},{status:key==="HOST_ONLY"||key==="HOME_ONLY"||key==="NOT_PARTICIPANT"||key==="AWAY_CALL_ONLY"?403:409});}}
