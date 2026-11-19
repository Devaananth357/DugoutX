import Link from "next/link";
import { Suspense } from "react";
import { AuctionRoom } from "@/components/auction-room";

export default function AuctionPage(){return <main className="auction-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span/><span/><span/></span><span>DUGOUT<span className="brand-x">X</span></span></Link><span>LIVE AUCTION ROOM</span></header><Suspense fallback={<div className="room-loading">Preparing auction…</div>}><AuctionRoom/></Suspense></main>}
