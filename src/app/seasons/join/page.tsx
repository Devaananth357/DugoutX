import Link from "next/link";
import { JoinSeasonForm } from "@/components/join-season-form";

export default function JoinSeasonPage() {
  return <main className="join-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>DUGOUT<span className="brand-x">X</span></span></Link><Link href="/seasons">Back to seasons</Link></header><div className="join-layout"><div><p className="eyebrow">MULTIPLAYER SEASON</p><h1>JOIN THE<br /><em>RIVALRY.</em></h1><p>Use the host’s private room code and password, then claim any franchise still available.</p><ul><li>Up to ten human managers</li><li>AI fills every unclaimed team</li><li>One shared auction and season</li></ul></div><JoinSeasonForm /></div></main>;
}
