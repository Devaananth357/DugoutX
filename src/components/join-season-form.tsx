"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const teams = [["BLR","Bengaluru"],["CHE","Chennai"],["MUM","Mumbai"],["KOL","Kolkata"],["DEL","Delhi"],["HYD","Hyderabad"],["PUN","Punjab"],["RAJ","Rajasthan"],["LKN","Lucknow"],["GUJ","Gujarat"]] as const;
type Room = { code:string; host:string; passwordHash:string; players:{name:string;team:string;host:boolean}[] };


export function JoinSeasonForm() {
  const router = useRouter();
  const [manager, setManager] = useState("Manager");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [team, setTeam] = useState("");
  const [error, setError] = useState("");
  const available = useMemo(() => room ? teams.filter(([id]) => !room.players.some(player => player.team === id)) : [], [room]);
  useEffect(() => {
    const user = localStorage.getItem("dugoutx_user");
    if (!user) { router.replace("/account"); return; }
    try { setManager(JSON.parse(user).name || "Manager"); } catch { setManager("Manager"); }
  }, [router]);
  async function findRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const normalized = code.trim().toUpperCase();
    const response=await fetch("/api/rooms/join",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"lookup",code:normalized,password})});
    const data=await response.json(); if(!response.ok){setError(data.error||"Room not found.");return;} const found:Room=data.room;
    if (found.players.length >= 10) { setError("This season is already full."); return; }
    const existing = found.players.find(player => player.name === manager);
    if (existing) { router.push(`/seasons/room/${normalized}`); return; }
    const firstAvailable = teams.find(([id]) => !found.players.some(player => player.team === id));
    setCode(normalized); setRoom(found); setTeam(firstAvailable?.[0] || "");
  }
  async function join() {
    if (!room || !team) return;
    const response=await fetch("/api/rooms/join",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"join",code:room.code,password,name:manager,team})});
    const data=await response.json();if(!response.ok){setError(data.error||"Could not join room.");return;}
    localStorage.setItem("dugoutx_latest_room", room.code);
    router.push(`/seasons/room/${room.code}`);
  }
  if (!room) return <form className="join-form" onSubmit={findRoom}><span>JOIN PRIVATE SEASON</span><h2>Enter the room</h2><label>ROOM CODE<input value={code} onChange={event=>setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6))} required minLength={6} maxLength={6} placeholder="ABC234" autoCapitalize="characters" /></label><label>ROOM PASSWORD<input value={password} onChange={event=>setPassword(event.target.value)} required type="password" placeholder="Enter room password" /></label>{error&&<p className="join-error">{error}</p>}<button type="submit">Find season <b>→</b></button></form>;
  return <div className="join-form choose-team"><span>ROOM {room.code} · HOSTED BY {room.host.toUpperCase()}</span><h2>Choose your team</h2><p>{available.length} franchises are still available.</p><div className="join-team-grid">{available.map(([id,name])=><button type="button" onClick={()=>setTeam(id)} className={team===id?"active":""} key={id}><strong>{id}</strong><small>{name}</small></button>)}</div><button className="join-room-button" type="button" onClick={join}>Join as {team} <b>→</b></button><button className="change-room" type="button" onClick={()=>{setRoom(null);setPassword("");}}>Use another code</button></div>;
}
