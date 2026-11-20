import { getAiAuctionInterest,getAuctionRoom,updateAuction } from "@/lib/local-db";
import { getAuctionPlayer,getAuctionPool } from "@/lib/auction-order";
import { teamRepresentative } from "@/lib/team-representatives";
import { notModified, snapshotJson, snapshotTag } from "@/lib/live-response";
type Context={params:Promise<{code:string}>};
type AuctionRoom=NonNullable<Awaited<ReturnType<typeof getAuctionRoom>>>;

function responseRoom(room:AuctionRoom){
  const retainedIds=new Set(room.retentions?.flatMap(team=>team.decision?.picks.map(pick=>pick.player.id)??[])??[]);
  const pool=getAuctionPool(retainedIds);const auction=room.auction!;const currentId=auction.playerIds[auction.cursor];
  const teams=room.retentions?.map(team=>{const bought=auction.purchases.filter(item=>item.team===team.team);return{team:team.team,manager:team.manager,owner:team.manager??teamRepresentative(team.team),ai:team.ai,interested:team.ai?getAiAuctionInterest(room,team.team):(auction.interestByTeam?.[team.team]??null),purse:Math.round(((team.decision?.auctionPurse??120)-bought.reduce((sum,item)=>sum+item.price,0))*100)/100,players:[...(team.decision?.picks.map(pick=>({...pick.player,price:pick.cost,retained:true}))??[]),...bought.map(item=>({...getAuctionPlayer(item.playerId)!,price:item.price,retained:false}))]};})??[];
  const currentManager=auction.currentManager==="AI MANAGER"&&auction.currentTeam?teamRepresentative(auction.currentTeam):auction.currentManager;
  const lastSale=auction.lastSale?{...auction.lastSale,playerName:getAuctionPlayer(auction.lastSale.playerId)?.name??"Player"}:null;
  const history=auction.saleHistory??auction.purchases.map((item,index)=>({playerId:item.playerId,team:item.team,price:item.price,unsold:false,soldAt:index}));const recentSales=history.slice(-12).reverse().map(sale=>({...sale,playerName:getAuctionPlayer(sale.playerId)?.name??"Player"}));
  const lastSetResult=auction.lastSetResult?{...auction.lastSetResult,sales:auction.lastSetResult.sales.map(sale=>({...sale,playerName:getAuctionPlayer(sale.playerId)?.name??"Player"}))}:null;
  return{code:room.code,host:room.host,stage:room.stage,players:room.players,auction:{...auction,currentManager,lastSale,lastSetResult,recentSales,total:auction.playerIds.length,current:currentId==null?null:pool.find(player=>player.id===currentId)??getAuctionPlayer(currentId),upcoming:auction.playerIds.slice(auction.cursor+1,auction.cursor+7).map(getAuctionPlayer).filter(Boolean),teams}};
}

const snapshots=new Map<string,{tag:string;payload:ReturnType<typeof responseRoom>}>();
function auctionSnapshot(room:AuctionRoom){
  const tag=snapshotTag([room.stage,room.players,room.auction]);
  let cached=snapshots.get(room.code);
  if(cached?.tag!==tag){
    cached={tag,payload:responseRoom(room)};
    snapshots.set(room.code,cached);
    if(snapshots.size>16)snapshots.delete(snapshots.keys().next().value!);
  }
  return cached;
}
export async function GET(request:Request,{params}:Context){
  const {code}=await params;
  const room=await getAuctionRoom(code);
  if(!room)return Response.json({error:"Auction room not found."},{status:404});
  const tag=snapshotTag([room.stage,room.players,room.auction]);
  return notModified(request,tag)??snapshotJson(auctionSnapshot(room).payload,tag);
}
export async function PATCH(request:Request,{params}:Context){const {code}=await params;const input=await request.json();try{const room=await updateAuction(code,input.name,input.action,input.interested);const snapshot=auctionSnapshot(room);return snapshotJson(snapshot.payload,snapshot.tag);}catch(error){const key=error instanceof Error?error.message:"";const errors:Record<string,string>={HOST_ONLY:"Only the season creator can control the auction.",AUCTION_PAUSED:"The auction is currently paused.",AUCTION_NOT_COMPLETE:"Complete the auction before starting the season.",TEST_SQUAD_UNAVAILABLE:"Could not build balanced test squads from the remaining players.",SET_NOT_FOUND:"The current auction set could not be processed.",ALREADY_LEADING:"Your team already has the highest bid.",INSUFFICIENT_PURSE:"Your team does not have enough purse for that bid.",HUMANS_STILL_INTERESTED:"Quick sell unlocks only after every human manager has passed.",NO_AI_INTEREST:"No AI franchise wants this player at its valid valuation.",AUCTION_COMPLETE:"The auction is complete."};return Response.json({error:errors[key]??"Could not update the auction."},{status:key==="HOST_ONLY"?403:409});}}
