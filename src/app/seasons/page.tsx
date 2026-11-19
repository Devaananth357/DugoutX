import Link from "next/link";
import { SeasonHub } from "@/components/season-hub";

export default function SeasonsPage() {
  return <main className="season-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>DUGOUT<span className="brand-x">X</span></span></Link><span>SEASON CONTROL</span></header><SeasonHub /></main>;
}
