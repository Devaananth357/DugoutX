"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

const teams = [["BLR","Bengaluru"],["CHE","Chennai"],["MUM","Mumbai"],["KOL","Kolkata"],["DEL","Delhi"],["HYD","Hyderabad"],["PUN","Punjab"],["RAJ","Rajasthan"],["LKN","Lucknow"],["GUJ","Gujarat"]] as const;
type Room = { code:string; host:string; team:string; difficulty:string; fillWithAi:boolean; stage?:"lobby"|"retention"|"auction"; players:{name:string;team:string;host:boolean}[] };

export function RoomLobby() {
  const { code } = useParams<{code:string}>();
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [copied, setCopied] = useState(false);
  const [manager, setManager] = useState("");
  const [changing, setChanging] = useState(false);
  const [shiftError, setShiftError] = useState("");
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    const user=localStorage.getItem("dugoutx_user"); if(user){try{setManager(JSON.parse(user).name||"");}catch{setManager("");}}
    let active=true;
    const refresh=()=>fetch(`/api/rooms/${code}`,{cache:"no-store"}).then(async response=>{if(!response.ok){router.replace("/seasons");return;}const data=await response.json();if(data.room.stage==="auction"){router.replace(`/seasons/auction/${code}`);return;}if(data.room.stage==="retention"){router.replace(`/seasons/retention/${code}`);return;}if(active)setRoom(data.room);});
    refresh(); const timer=window.setInterval(refresh,1800); return()=>{active=false;window.clearInterval(timer);};
  }, [code, router]);
  if (!room) return <div className="room-loading">Preparing the dugout…</div>;
  async function copyCode() { await navigator.clipboard.writeText(room!.code); setCopied(true); window.setTimeout(()=>setCopied(false), 1400); }
  async function shift(team:string){setShiftError("");const response=await fetch(`/api/rooms/${room!.code}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:manager,team})});const data=await response.json();if(!response.ok){setShiftError(data.error);return;}setRoom(data.room);setChanging(false);}
  async function startSeason(){setStarting(true);setShiftError("");const response=await fetch(`/api/rooms/${room!.code}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"start",name:manager})});const data=await response.json();if(!response.ok){setShiftError(data.error);setStarting(false);return;}router.push(`/seasons/retention/${room!.code}`);}
  const currentPlayer=room.players.find(player=>player.name===manager);
  const isHost=currentPlayer?.host===true&&room.host===manager;
  return <div className="room-shell">
    <div className="room-heading"><div><p className="eyebrow">PRIVATE SEASON LOBBY</p><h1>ASSEMBLE<br /><em>THE LEAGUE.</em></h1></div><div className="room-code"><span>ROOM CODE</span><strong>{room.code}</strong><button type="button" onClick={copyCode}>{copied?"Copied":"Copy code"}</button></div></div>
    <div className="lobby-grid"><section className="franchise-panel"><div className="panel-heading"><span>FRANCHISE SLOTS · LIVE</span><b>{room.players.length} / 10 HUMAN</b></div>{currentPlayer&&<div className="shift-control"><div><span>YOUR FRANCHISE</span><strong>{currentPlayer.team}</strong></div><button type="button" onClick={()=>setChanging(!changing)}>{changing?"Cancel":"Change franchise"}</button></div>}{changing&&<div className="shift-picker">{teams.map(([team,name])=>{const occupied=room.players.some(player=>player.team===team&&player.name!==manager);return <button type="button" disabled={occupied} className={currentPlayer?.team===team?"active":""} onClick={()=>shift(team)} key={team}><strong>{team}</strong><small>{occupied?"Claimed":name}</small></button>})}{shiftError&&<p>{shiftError}</p>}</div>}<div className="franchise-grid">{teams.map(([team,name],index)=>{const human=room.players.find(player=>player.team===team);return <article className={human?"human":"ai"} key={team}><span>{String(index+1).padStart(2,"0")}</span><strong>{team}</strong><p>{name}</p><small>{human?`${human.name}${human.host?" · HOST":" · HUMAN"}`:room.fillWithAi?"AI ON START":"OPEN SLOT"}</small></article>})}</div></section>
      <aside className="ai-rules"><div className="panel-heading"><span>AI GOVERNANCE</span><b>{room.difficulty}</b></div><h2>Same rules.<br />No hidden boost.</h2><ol><li><b>AUCTION</b><span>Values players by role, form and remaining budget; reserves 20% for squad balance.</span></li><li><b>SQUAD</b><span>Meets role quotas and obeys overseas-player limits before chasing star ratings.</span></li><li><b>MATCHES</b><span>Uses pitch, matchup, confidence and game state—the same inputs available to you.</span></li><li><b>DECISIONS</b><span>Responds within two seconds and cannot see future simulation outcomes.</span></li></ol>{isHost?<button type="button" disabled={starting} onClick={startSeason}>{starting?"Starting season…":"Start season"} <span>→</span></button>:<p className="waiting-host">Waiting for {room.host} to start the season…</p>}{shiftError&&<p className="lobby-error">{shiftError}</p>}</aside>
    </div>
  </div>;
}
