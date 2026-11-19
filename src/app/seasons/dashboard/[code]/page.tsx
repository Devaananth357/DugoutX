import Link from "next/link";
import { Suspense } from "react";
import { SeasonDashboard } from "@/components/season-dashboard";

export default function SeasonDashboardPage(){return <main className="season-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span/><span/><span/></span><span>DUGOUT<span className="brand-x">X</span></span></Link><span>SEASON COMMAND CENTRE</span></header><Suspense fallback={<div className="room-loading">Preparing the season…</div>}><SeasonDashboard/></Suspense></main>}
