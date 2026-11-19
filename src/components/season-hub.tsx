"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function SeasonHub() {
  const router = useRouter();
  const [name, setName] = useState("Manager");
  useEffect(() => {
    const stored = window.localStorage.getItem("dugoutx_user");
    if (!stored) { router.replace("/account"); return; }
    try { setName(JSON.parse(stored).name || "Manager"); } catch { setName("Manager"); }
  }, [router]);
  return <div className="season-content">
    <p className="eyebrow">WELCOME BACK, {name.toUpperCase()}</p>
    <h1>ENTER THE<br /><em>DUGOUT.</em></h1>
    <p className="season-lede">Choose where your next cricket story begins.</p>
    <div className="season-grid">
      <button type="button" className="primary" onClick={()=>router.push("/seasons/create")}><span>01</span><i>＋</i><strong>Create new season</strong><small>Draft a squad and start from the auction.</small><b>Start fresh →</b></button>
      <button type="button"><span>02</span><i>▶</i><strong>Continue season</strong><small>Return to your latest campaign and next fixture.</small><b>Resume →</b></button>
      <button type="button" onClick={()=>router.push("/seasons/join")}><span>03</span><i>⌁</i><strong>Join a season</strong><small>Enter a league code and compete with friends.</small><b>Join league →</b></button>
    </div>
  </div>;
}
