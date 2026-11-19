import Link from "next/link";
import { CreateSeasonForm } from "@/components/create-season-form";

export default function CreateSeasonPage() {
  return <main className="flow-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark"><span /><span /><span /></span><span>DUGOUT<span className="brand-x">X</span></span></Link><Link href="/seasons">Back to seasons</Link></header><div className="create-layout"><div><p className="eyebrow">NEW SEASON</p><h1>CHOOSE YOUR<br /><em>FRANCHISE.</em></h1><p>Claim a team, secure the room and invite up to nine other managers. AI franchises fill any seats left open.</p></div><CreateSeasonForm /></div></main>;
}
