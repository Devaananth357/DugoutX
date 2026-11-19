import Link from "next/link";
import { Suspense } from "react";
import { MatchCentre } from "@/components/match-centre";

export default function MatchPage(){return <main className="match-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span/><span/><span/></span><span>DUGOUT<span className="brand-x">X</span></span></Link><span>SEASON MATCHDAY</span></header><Suspense fallback={<div className="room-loading">Preparing match centre…</div>}><MatchCentre/></Suspense></main>}
