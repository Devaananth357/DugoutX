"use client";

import { useEffect, useState } from "react";

const slides = [
  { label: "Auction room", title: "Build your squad" },
  { label: "Field control", title: "Move every fielder" },
  { label: "Match engine", title: "Call every ball" },
] as const;
const fielders = [[50,12],[26,23],[74,25],[17,48],[83,50],[31,70],[68,72],[14,82],[87,82]];

function AuctionSlide() {
  return <div className="showcase-scene auction-scene">
    <div className="auction-player"><span>LIVE LOT · 024</span><div className="player-avatar">VK</div><h3>VIRAT KOHLI</h3><p>TOP ORDER · RHB</p><div><span>BAT</span><strong>91</strong><span>FORM</span><strong>88</strong></div></div>
    <div className="bid-stage"><span>CURRENT BID</span><strong>₹18.25<small> CR</small></strong><p>ROYAL CHALLENGERS</p><div className="bid-pulse"><i /><i /><i /></div><button type="button">BID ₹18.50 CR <b>→</b></button></div>
    <div className="bid-history"><span>LAST BIDS</span><p><b>MUM</b> ₹17.75 CR</p><p><b>BLR</b> ₹18.25 CR</p><small>08 sec remaining</small></div>
  </div>;
}

function FieldSlide() {
  return <div className="showcase-scene field-scene">
    <div className="field-score"><span>12.4 OVERS</span><strong>112<small>/2</small></strong><p>Need 62 from 44</p></div>
    <div className="mini-field"><span className="field-boundary" /><span className="field-ring" /><span className="field-pitch"><i className="ball" /></span>{fielders.map(([left,top],i)=><span className="animated-fielder" style={{left:`${left}%`,top:`${top}%`}} key={i}>{i+1}</span>)}</div>
    <div className="field-plan"><span>ACTIVE PLAN</span><strong>Protect the leg side</strong><p>Boundary riders cover the slog.</p></div>
  </div>;
}

function SimulationSlide() {
  return <div className="showcase-scene sim-scene">
    <div className="sim-score"><span>CHASE · LIVE</span><strong>173<small>/5</small></strong><p>Need 2 runs · 1 ball</p></div>
    <div className="versus"><div><b>BLR</b><span>V. KOHLI</span><strong>84*</strong></div><i>VS</i><div><b>MUM</b><span>J. BUMRAH</span><strong>3/28</strong></div></div>
    <div className="ball-feed"><span>19.3 <b>1</b></span><span>19.4 <b>•</b></span><span>19.5 <b>2</b></span><span className="active">19.6 <b>?</b></span></div>
    <div className="sim-choice"><span>YOUR CALL</span><div><button type="button">DEFEND</button><button type="button" className="active">ATTACK</button></div></div>
  </div>;
}

export function MatchPreview() {
  const [active, setActive] = useState(0);
  useEffect(() => { const timer = window.setInterval(() => setActive(value => (value + 1) % slides.length), 5200); return () => window.clearInterval(timer); }, []);
  return <div className="feature-showcase">
    <div className="showcase-top"><span>FEATURE DISPLAY</span><strong>0{active + 1} / 03</strong></div>
    <div className="showcase-copy"><p>{slides[active].label}</p><h2>{slides[active].title}</h2></div>
    <div className="slide-window">{active === 0 ? <AuctionSlide /> : active === 1 ? <FieldSlide /> : <SimulationSlide />}</div>
    <div className="showcase-nav">{slides.map((slide,index)=><button type="button" onClick={()=>setActive(index)} className={active===index?"active":""} key={slide.label}><i /><span>0{index+1}</span>{slide.label}</button>)}</div>
  </div>;
}
