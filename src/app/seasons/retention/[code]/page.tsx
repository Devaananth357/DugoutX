import Link from "next/link";
import { Suspense } from "react";
import { RetentionRoom } from "@/components/retention-room";

export default function RetentionPage(){return <main className="retention-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>DUGOUT<span className="brand-x">X</span></span></Link><span>RETENTION ROOM</span></header><Suspense fallback={<div className="room-loading">Opening retention room…</div>}><RetentionRoom/></Suspense></main>}
