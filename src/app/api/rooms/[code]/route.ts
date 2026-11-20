import { getRoom, saveRetentions, shiftPlayer, startRoom } from "@/lib/local-db";
import { notModified, snapshotJson, snapshotTag } from "@/lib/live-response";
type Context={params:Promise<{code:string}>};
export async function GET(request:Request,{params}:Context){
  const {code}=await params;
  const room=await getRoom(code);
  if(!room)return Response.json({error:"Room not found."},{status:404});
  const url=new URL(request.url);
  const view=url.searchParams.get("view");
  const player=room.players.find(item=>item.name===url.searchParams.get("manager"));
  const safeRoom=view==="lobby"
    ?{code:room.code,host:room.host,team:room.team,difficulty:room.difficulty,fillWithAi:room.fillWithAi,players:room.players,stage:room.stage}
    :view==="retention"
      ?{code:room.code,host:room.host,players:room.players,stage:room.stage,retentions:room.retentions?.map(team=>team.team===player?.team?team:{team:team.team,manager:team.manager,ai:team.ai,roster:[],decision:team.decision?{picks:[],auctionPurse:team.decision.auctionPurse}:null})}
      :{...room,passwordHash:undefined};
  const payload={room:safeRoom};
  const tag=snapshotTag(payload);
  return notModified(request,tag)??snapshotJson(payload,tag);
}
export async function PATCH(request:Request,{params}:Context){const {code}=await params;const input=await request.json();try{const room=input.action==="start"?await startRoom(code,input.name):input.action==="retain"?await saveRetentions(code,input.name,input.playerIds):await shiftPlayer(code,input.name,input.team);return Response.json({room:{...room,passwordHash:undefined}});}catch(error){const message=error instanceof Error?error.message:"";return Response.json({error:message==="TEAM_TAKEN"?"That franchise was just claimed.":message==="HOST_ONLY"?"Only the season creator can start it.":message==="FIFTH_MUST_BE_UNCAPPED"?"Your fifth retention must be an uncapped player.":message==="INVALID_SELECTION"?"That retention selection is invalid.":"Could not update the season."},{status:message==="HOST_ONLY"?403:409});}}
