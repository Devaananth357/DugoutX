"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Player={id:number;name:string;role:string;batting:number;bowling:number;form:number;confidence:number;uncapped?:boolean};
type TeamRetention={team:string;manager:string|null;ai:boolean;roster:Player[];decision:{picks:{slot:number;cost:number;player:Player}[];auctionPurse:number}|null};
type Room={code:string;host:string;stage?:"lobby"|"retention"|"auction";players:{name:string;team:string;host:boolean}[];retentions?:TeamRetention[]};
const costs=[18,14,10,8,4];

export function RetentionRoom(){
  const {code}=useParams<{code:string}>();
  const router=useRouter();
  const [room,setRoom]=useState<Room|null>(null);
  const [manager,setManager]=useState("");
  const [selected,setSelected]=useState<number[]>([]);
  const [saving,setSaving]=useState(false);
  const [message,setMessage]=useState("");

  useEffect(()=>{
    const stored=localStorage.getItem("dugoutx_user");
    if(stored){try{setManager(JSON.parse(stored).name||"");}catch{setManager("");}}
    let active=true;
    const refresh=()=>fetch(`/api/rooms/${code}`,{cache:"no-store"}).then(async response=>{
      if(!response.ok){router.replace("/seasons");return;}
      const data=await response.json();
      if(data.room.stage==="auction"){router.replace(`/seasons/auction/${code}`);return;}
      if(data.room.stage!=="retention"){router.replace(`/seasons/room/${code}`);return;}
      if(active)setRoom(data.room);
    });
    refresh();const timer=window.setInterval(refresh,1800);return()=>{active=false;window.clearInterval(timer);};
  },[code,router]);

  if(!room)return <div className="room-loading">Opening retention room…</div>;
  const player=room.players.find(item=>item.name===manager);
  const teamState=room.retentions?.find(item=>item.team===player?.team);
  const confirmed=Boolean(teamState?.decision);
  const effectiveSelected=confirmed?teamState?.decision?.picks.map(pick=>pick.player.id)??[]:selected;
  const totalCost=costs.slice(0,effectiveSelected.length).reduce((sum,cost)=>sum+cost,0);

  function toggle(item:Player){
    if(confirmed)return;
    setMessage("");
    if(selected.includes(item.id)){setSelected(value=>value.filter(id=>id!==item.id));return;}
    if(selected.length>=5){setMessage("Maximum five players can be retained.");return;}
    if(selected.length===4&&!item.uncapped){setMessage("The fifth retention must be an uncapped player.");return;}
    setSelected(value=>[...value,item.id]);
  }

  async function confirm(){
    setSaving(true);setMessage("");
    const response=await fetch(`/api/rooms/${code}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"retain",name:manager,playerIds:selected})});
    const data=await response.json();setSaving(false);
    if(!response.ok){setMessage(data.error);return;}
    if(data.room.stage==="auction"){router.push(`/seasons/auction/${code}`);return;}
    setRoom(data.room);
  }

  return <section className="retention-shell">
    <div className="retention-heading"><p className="eyebrow">SEASON PHASE 01 · {player?.team??"TEAM"}</p><h1>BUILD YOUR<br/><em>CORE.</em></h1><p>You are viewing only your franchise roster. Other human managers see their own teams, while unclaimed franchises have already made their AI retention choices.</p></div>
    <div className="retention-board">
      <div className="panel-heading"><span>{player?.team??"YOUR TEAM"} RETENTION</span><b>MAX PURSE · ₹120 CR</b></div>
      <div className="retention-costs">{costs.map((cost,index)=><article className={effectiveSelected[index]?"filled":""} key={cost}><span>{String(index+1).padStart(2,"0")}</span><strong>₹{cost} CR</strong><small>{effectiveSelected[index]?teamState?.roster.find(item=>item.id===effectiveSelected[index])?.name:index===4?"UNCAPPED PLAYER ONLY":`${index+1}${index===0?"ST":index===1?"ND":index===2?"RD":"TH"} RETENTION`}</small></article>)}</div>
      {teamState?<div className="team-roster">
        <header><div><span>YOUR CURRENT ROSTER</span><strong>{confirmed?"Your retention list is locked":"Tap a player card to select or remove"}</strong></div><b>{teamState.roster.length} PLAYERS</b></header>
        <div className="roster-grid">{teamState.roster.map((item,index)=>{const selectedIndex=effectiveSelected.indexOf(item.id);const lockedOut=!item.uncapped&&effectiveSelected.length===4&&selectedIndex<0;return <button type="button" disabled={confirmed||lockedOut} onClick={()=>toggle(item)} className={`roster-card${selectedIndex>=0?" selected":""}`} key={item.id}><div className="roster-avatar">{item.name.split(" ").map(part=>part[0]).slice(-2).join("")}</div><div className="roster-identity"><span>{selectedIndex>=0?`RETENTION ${selectedIndex+1}`:`${String(index+1).padStart(2,"0")} · ${item.role}`}</span><strong>{item.name}</strong><small>FORM {item.form} · CONF {item.confidence}</small></div><div className="roster-ratings"><span><small>BAT</small><b>{item.batting}</b></span><span><small>BOWL</small><b>{item.bowling}</b></span></div>{item.uncapped&&<i>UNCAPPED</i>}<em>{selectedIndex>=0?"✓":"＋"}</em></button>})}</div>
        <footer className={`retention-action${confirmed?" confirmed":""}`}>
          <div className="retention-metric"><span>PLAYERS RETAINED</span><strong>{effectiveSelected.length}<small>/ 5</small></strong></div>
          <div className="retention-metric purse"><span>AUCTION PURSE</span><strong>₹{120-totalCost}<small> CR</small></strong></div>
          <button type="button" disabled={saving||confirmed} onClick={confirm}><i>{confirmed?"✓":"→"}</i><span><b>{confirmed?"RETENTIONS LOCKED":saving?"SAVING…":"CONFIRM RETENTIONS"}</b><small>{confirmed?"Selections saved for the auction":"Lock your final player list"}</small></span></button>
        </footer>
        {message&&!confirmed&&<p className="retention-message">{message}</p>}
      </div>:<div className="retention-status"><strong>No franchise assigned</strong><p>Return to the lobby and join the room with a team before retention begins.</p></div>}
      <div className="retention-status"><span>AI STATUS</span><strong>{room.retentions?.filter(item=>item.ai&&item.decision).length??0} AI teams have retained their core</strong><p>Each AI decision and its reduced auction purse is stored with the room. Released players will enter the shared auction pool.</p></div>
    </div>
  </section>;
}
