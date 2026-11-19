import Link from "next/link";
import { Suspense } from "react";
import { RoomLobby } from "@/components/room-lobby";

export default function RoomPage() {
  return <main className="room-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>DUGOUT<span className="brand-x">X</span></span></Link><Link href="/seasons">Exit lobby</Link></header><Suspense fallback={<div className="room-loading">Preparing the dugout…</div>}><RoomLobby /></Suspense></main>;
}
