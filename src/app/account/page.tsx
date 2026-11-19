import Link from "next/link";
import { SignupForm } from "@/components/signup-form";

export default function AccountPage() {
  return <main className="auth-page"><header className="flow-header"><Link className="brand" href="/"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span>DUGOUT<span className="brand-x">X</span></span></Link><Link href="/">Back home</Link></header><section className="auth-layout"><div><p className="eyebrow">YOUR CAREER STARTS HERE</p><h1>BUILD THE TEAM.<br /><em>OWN THE SEASON.</em></h1><p>Create your manager profile once, then use the same account from your Mac, PC or mobile.</p></div><div className="auth-panel"><span>MANAGER ACCESS</span><h2>Enter the dugout</h2><SignupForm /></div></section></main>;
}
