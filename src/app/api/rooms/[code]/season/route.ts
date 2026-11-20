import { getSeasonRoom } from "@/lib/local-db";
import { displayTeamCode,teamRepresentative } from "@/lib/team-representatives";
import { notModified, snapshotJson, snapshotTag } from "@/lib/live-response";
type Context={params:Promise<{code:string}>};

export async function GET(request:Request,{params}:Context){
  const {code}=await params;const room=await getSeasonRoom(code);if(!room)return Response.json({error:"Season not found."},{status:404});
  const table=(room.retentions??[]).map(team=>{const completed=room.season!.fixtures.filter(match=>match.status==="complete"&&(match.home===team.team||match.away===team.team));let runsFor=0,runsAgainst=0;for(const match of completed){if(!match.result)continue;const own=match.result.first.team===team.team?match.result.first:match.result.second;const other=match.result.first.team===team.team?match.result.second:match.result.first;runsFor+=own.runs;runsAgainst+=other.runs;}const won=completed.filter(match=>match.winner===team.team).length;return{team:team.team,display:displayTeamCode(team.team),owner:team.manager??teamRepresentative(team.team),played:completed.length,won,lost:completed.length-won,nr:0,points:won*2,nrr:completed.length?((runsFor-runsAgainst)/(completed.length*20)).toFixed(3):"0.000"};}).sort((a,b)=>b.points-a.points||Number(b.nrr)-Number(a.nrr));
  const fixtures=room.season!.fixtures.map(({id,round,home,away,status,homeScore,awayScore,winner})=>({id,round,home,away,status,homeScore,awayScore,winner}));
  const payload={code:room.code,host:room.host,testSeason:Boolean(room.testSeason),players:room.players,fixtures,currentMatch:room.season!.currentMatch,table,leaders:{orange:null,purple:null,mvp:null,sixes:null}};
  const tag=snapshotTag(payload);
  return notModified(request,tag)??snapshotJson(payload,tag);
}
