"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const teams = [
  ["BLR", "Bengaluru"], ["CHE", "Chennai"], ["MUM", "Mumbai"], ["KOL", "Kolkata"], ["DEL", "Delhi"],
  ["HYD", "Hyderabad"], ["PUN", "Punjab"], ["RAJ", "Rajasthan"], ["LKN", "Lucknow"], ["GUJ", "Gujarat"],
] as const;

export function CreateSeasonForm() {
  const router = useRouter();
  const [manager, setManager] = useState("Manager");
  const [team, setTeam] = useState("BLR");
  const [difficulty, setDifficulty] = useState("Competitive");
  const [password, setPassword] = useState("");
  const [fillWithAi, setFillWithAi] = useState(true);
  useEffect(() => {
    const user = localStorage.getItem("dugoutx_user");
    if (!user) { router.replace("/account"); return; }
    try { setManager(JSON.parse(user).name || "Manager"); } catch { setManager("Manager"); }
  }, [router]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response=await fetch("/api/rooms",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({host:manager,team,difficulty,fillWithAi,password})});
    const data=await response.json(); if(!response.ok)return;
    localStorage.setItem("dugoutx_latest_room", data.room.code);
    router.push(`/seasons/room/${data.room.code}`);
  }
  return <form className="create-season-form" onSubmit={create}>
    <div className="create-field"><label>YOUR FRANCHISE</label><div className="team-picker">{teams.map(([code,name])=><button key={code} type="button" onClick={()=>setTeam(code)} className={team===code?"active":""}><strong>{code}</strong><span>{name}</span></button>)}</div></div>
    <div className="create-row"><label>ROOM PASSWORD<input type="password" minLength={4} required value={password} onChange={event=>setPassword(event.target.value)} placeholder="Minimum 4 characters" /></label><label>AI DIFFICULTY<select value={difficulty} onChange={event=>setDifficulty(event.target.value)}><option>Balanced</option><option>Competitive</option><option>Expert</option></select></label></div>
    <label className="ai-toggle"><input type="checkbox" checked={fillWithAi} onChange={event=>setFillWithAi(event.target.checked)} /><span><strong>Fill empty franchises with AI</strong><small>Unclaimed teams become AI-controlled when the host starts.</small></span></label>
    <button className="create-room-button" type="submit">Create private room <span>→</span></button>
  </form>;
}
