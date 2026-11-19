import order from "../../data/ai/auction-order.json";
import { SHEET_PLAYERS } from "@/lib/ai";
import type { AiPlayer } from "@/lib/ai";

const playersById=new Map(SHEET_PLAYERS.map(player=>[player.id,player]));

export type AuctionLot=AiPlayer&{setName:string;basePrice:number};

export function getAuctionPool(retainedIds:Set<number>):AuctionLot[]{
  return order.sets.flatMap(set=>set.playerIds.map(id=>{
    const player=playersById.get(id);if(!player||retainedIds.has(id))return null;
    const quality=Math.max(player.batting,player.bowling);
    const basePrice=player.baseSalary??(quality>=85?2:quality>=75?1.5:.5);
    return{...player,setName:set.name,basePrice};
  }).filter((player):player is AuctionLot=>player!==null));
}

export function getAuctionPlayer(id:number){return playersById.get(id)??null;}
