"use client";

import { useEffect,useMemo,useRef,useState } from "react";
import { useParams,useRouter } from "next/navigation";
import { displayTeamCode } from "@/lib/team-representatives";

type Player={id:number;name:string;role:string;batting:number;bowling:number;fielding:number;form:number;confidence:number;overseas?:boolean;uncapped?:boolean;setName?:string;basePrice?:number;price?:number;retained?:boolean};
type Team={team:string;manager:string|null;owner:string;ai:boolean;interested:boolean|null;purse:number;players:Player[]};
type Sale={playerId:number;playerName:string;team:string|null;price:number|null;unsold:boolean;soldAt:number};
type SetResult={setName:string;processedAt:number;sales:Sale[]};
type Auction={cursor:number;total:number;currentBid:number|null;currentTeam:string|null;currentManager:string|null;pendingAiBid?:{team:string;amount:number;executeAt:number}|null;paused?:boolean;lastSale?:Sale|null;lastSetResult?:SetResult|null;recentSales?:Sale[];current:Player|null;upcoming:Player[];teams:Team[]};
type AuctionRoomData={code:string;host:string;stage?:string;players:{name:string;team:string;host:boolean}[];auction:Auction};

export function AuctionRoom(){
  const {code}=useParams<{code:string}>();const router=useRouter();const [data,setData]=useState<AuctionRoomData|null>(null);const [manager]=useState(()=>{if(typeof window==="undefined")return "";try{return JSON.parse(localStorage.getItem("dugoutx_user")||"{}").name||"";}catch{return "";}});const [tab,setTab]=useState<"team"|"upcoming"|"recent"|"table">("upcoming");const [selectedTeam,setSelectedTeam]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState("");const [salePopup,setSalePopup]=useState<Sale|null>(null);const [setPopup,setSetPopup]=useState<SetResult|null>(null);const [confirmSkip,setConfirmSkip]=useState(false);const [confirmTest,setConfirmTest]=useState(false);const seenSale=useRef(0);const seenSet=useRef(0);const actionVersion=useRef(0);const actionPending=useRef(false);
  useEffect(() => {
    let active=true;
    let timer:ReturnType<typeof setTimeout>;
    const refresh=async()=>{
      if(!active)return;
      if(actionPending.current){timer=setTimeout(refresh,1500);return;}
      const version=actionVersion.current;
      try{
        const response=await fetch(`/api/rooms/${code}/auction`,{cache:"no-store"});
        if(!active||version!==actionVersion.current)return;
        if(response.status===404){
          const season=await fetch(`/api/rooms/${code}/season`,{cache:"no-store"});
          if(!active||version!==actionVersion.current)return;
          if(season.ok){router.replace(`/seasons/dashboard/${code}`);return;}
        }
        if(!response.ok)throw new Error("Auction refresh failed");
        const result:AuctionRoomData=await response.json();
        if(!active||version!==actionVersion.current)return;
        if(result.stage==="season"){router.replace(`/seasons/dashboard/${code}`);return;}
        setData(result);
        setMessage(previous=>previous==="Connection interrupted. Reconnecting…"?"":previous);
      }catch{
        if(active)setMessage("Connection interrupted. Reconnecting…");
      }finally{
        if(active)timer=setTimeout(refresh,1500);
      }
    };
    refresh();
    return()=>{active=false;clearTimeout(timer);};
  },[code,router]);
  const lastSaleAt=data?.auction.lastSale?.soldAt;
  useEffect(()=>{const sale=data?.auction.lastSale;if(!sale||data?.auction.lastSetResult?.processedAt===sale.soldAt||sale.soldAt===seenSale.current||Date.now()-sale.soldAt>4000)return;seenSale.current=sale.soldAt;setSalePopup(sale);const timer=window.setTimeout(()=>setSalePopup(null),Math.max(300,2500-(Date.now()-sale.soldAt)));return()=>window.clearTimeout(timer);},[lastSaleAt]);
  const lastSetAt=data?.auction.lastSetResult?.processedAt;
  useEffect(()=>{const result=data?.auction.lastSetResult;if(!result||result.processedAt===seenSet.current||Date.now()-result.processedAt>8000)return;seenSet.current=result.processedAt;setSetPopup(result);const timer=window.setTimeout(()=>setSetPopup(null),Math.max(1200,6000-(Date.now()-result.processedAt)));return()=>window.clearTimeout(timer);},[lastSetAt]);
  const viewer=useMemo(()=>data?.players.find(player=>player.name===manager),[data,manager]);const myTeam=data?.auction.teams.find(team=>team.team===viewer?.team);const isHost=Boolean(viewer?.host&&data?.host===manager);
  async function act(action:"bid"|"sell"|"interest"|"quickSellAi"|"skipSet"|"skipAuctionForTesting"|"pause"|"startSeason",interested?:boolean){
    actionVersion.current++;
    actionPending.current=true;
    setBusy(true);
    setMessage("");
    try{
      const response=await fetch(`/api/rooms/${code}/auction`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,name:manager,interested})});
      const result=await response.json();
      if(!response.ok){setMessage(result.error??"Could not update the auction. Try again.");setConfirmTest(false);return;}
      if(result.stage==="season"){router.push(`/seasons/dashboard/${code}`);return;}
      setConfirmSkip(false);
      setData(result);
    }catch{
      setMessage("Connection interrupted. Reconnecting…");
    }finally{
      actionVersion.current++;
      actionPending.current=false;
      setBusy(false);
    }
  }
  if(!data)return <div className="room-loading">Opening live auction…{message&&<p role="status">{message}</p>}</div>;
  const {auction}=data;const player=auction.current;const progress=auction.total?Math.round(auction.cursor/auction.total*100):100;const tableTeam=auction.teams.find(team=>team.team===selectedTeam)??auction.teams[0];const humanTeams=auction.teams.filter(team=>!team.ai);const allHumansPassed=humanTeams.length>0&&humanTeams.every(team=>team.interested===false);
  return <section className="live-auction">
    <header className={`auction-status${isHost?" host-status":""}`}><div className="auction-room-status"><span>LIVE AUCTION · ROOM {data.code}</span><strong>{player?.setName??(player?"PLAYER SET":"AUCTION COMPLETE")}</strong></div><div className="auction-progress"><span>{auction.cursor+Math.min(1,auction.total-auction.cursor)} / {auction.total}</span><i><b style={{width:`${progress}%`}}/></i></div><div className="franchise-status"><span>YOUR FRANCHISE</span><strong>{myTeam?.team??"SPECTATOR"} · ₹{myTeam?.purse??0} CR</strong></div>{isHost&&<div className="auction-host-controls"><button className={`host-skip${confirmSkip?" confirm":""}`} disabled={busy||auction.paused||!player} onClick={()=>confirmSkip?act("skipSet"):setConfirmSkip(true)}><i>{confirmSkip?"!":"↠"}</i><span><small>{confirmSkip?"IRREVERSIBLE ACTION":"SET CONTROL"}</small><b>{confirmSkip?`CONFIRM ${player?.setName??"SET"}`:"SKIP SET"}</b></span></button><button className={`host-pause${auction.paused?" paused":""}`} disabled={busy} onClick={()=>act("pause")}><i>{auction.paused?"▶":"Ⅱ"}</i><span><small>{auction.paused?"AUCTION STOPPED":"AUCTION CONTROL"}</small><b>{auction.paused?"RESUME":"PAUSE"}</b></span></button></div>}</header>
    {auction.paused&&<div className="auction-paused"><i/> AUCTION PAUSED BY THE CREATOR</div>}
    {message&&<p className="auction-message" role="status">{message}</p>}
    <div className="auction-stage">
      <aside className="auction-player-card">{player?<><div className="lot-label">LOT {String(auction.cursor+1).padStart(3,"0")} <b>{player.role}</b></div><div className="auction-avatar">{player.name.split(" ").map(part=>part[0]).slice(-2).join("")}</div><p>{player.overseas?"OVERSEAS":"INDIAN"} · {player.uncapped?"UNCAPPED":"CAPPED"}</p><h1>{player.name}</h1><div className="player-auction-ratings"><span><small>BATTING</small><b>{player.batting}</b></span><span><small>BOWLING</small><b>{player.bowling}</b></span><span><small>FIELDING</small><b>{player.fielding}</b></span></div><div className="form-strip"><span>FORM <b>{player.form}</b></span><span>CONFIDENCE <b>{player.confidence}</b></span></div></>:<div className="auction-finished"><span>✓</span><h1>Auction complete</h1><p>Every player in the auction list has been processed.</p></div>}</aside>
      <main className="auction-bid-console">{player?<><div className="bid-copy"><span>{auction.currentTeam?"CURRENT HIGHEST BID":"BASE PRICE"}</span><strong>₹{auction.currentBid??player.basePrice??.5}<small> CR</small></strong><p>{auction.currentTeam?<><b>{auction.currentTeam}</b> · {auction.currentManager}</>:"Waiting for the opening bid"}</p></div>{viewer&&<div className="interest-buttons"><span>YOUR INTEREST</span><button className={myTeam?.interested===true?"active yes":""} disabled={busy||auction.paused} onClick={()=>act("interest",true)}><i/> INTERESTED</button><button className={myTeam?.interested===false?"active no":""} disabled={busy||auction.paused} onClick={()=>act("interest",false)}><i/> PASS</button></div>}<div className="bid-actions"><button disabled={busy||auction.paused||!viewer||auction.currentTeam===viewer.team} onClick={()=>act("bid")}><span>{busy?"UPDATING…":"PLACE BID"}</span><b>₹{auction.currentBid==null?(player.basePrice??.5):auction.currentBid>=10?auction.currentBid+1:auction.currentBid+.5} CR ↗</b></button>{isHost&&<><button className="fast-sell" disabled={busy||auction.paused||Boolean(auction.pendingAiBid)} onClick={()=>act("sell")}><span>{auction.pendingAiBid?"BIDDING ACTIVE":auction.currentTeam?"SELL NOW":"NO INTEREST"}</span><b>{auction.pendingAiBid?"WAIT FOR BIDS":auction.currentTeam?`SOLD TO ${auction.currentTeam}`:"MARK UNSOLD & NEXT"} →</b></button><button className="quick-ai-sell" disabled={busy||auction.paused||!allHumansPassed} onClick={()=>act("quickSellAi")}><span>ALL HUMANS PASSED</span><b>{allHumansPassed?"QUICK SELL TO HIGHEST AI":"WAITING FOR HUMAN TEAMS"} ⚡</b></button></>}</div><div className="auction-hint"><span>LIVE AUCTION PACE</span><p>{isHost?"Quick Sell unlocks after every human manager passes and awards the lot to the highest valid AI valuation.":"The highest bid and current franchise update live."}</p></div>{isHost&&<div className="test-season-shortcut"><div><span>READY TO TEST THE MATCH ENGINE?</span><p>Skip the remaining auction. Build balanced 22-player squads and bring your team into match one.</p></div><button type="button" disabled={busy} onClick={()=>setConfirmTest(true)}>START TEST SEASON <b>→</b></button></div>}</>:<div className="bid-copy"><span>FINAL STATUS</span><strong>{auction.total}<small> LOTS</small></strong><p>The complete auction record is saved to this season.</p>{isHost?<button className="start-season-button" disabled={busy} onClick={()=>act("startSeason")}><span>{busy?"CREATING FIXTURES…":"START THE SEASON"}</span><b>FIXTURES & MATCHES →</b></button>:<div className="waiting-season">Waiting for the creator to start the season…</div>}</div>}</main>
      <aside className="auction-side-panel"><nav className={isHost?"creator-tabs":"player-tabs"}><button className={tab==="upcoming"?"active":""} onClick={()=>setTab("upcoming")}>UPCOMING</button><button className={tab==="recent"?"active":""} onClick={()=>setTab("recent")}>RECENTLY SOLD</button><button className={tab==="team"?"active":""} onClick={()=>setTab("team")}>MY TEAM</button>{isHost&&<button className={tab==="table"?"active":""} onClick={()=>setTab("table")}>AUCTION TABLE</button>}</nav>{tab==="upcoming"?<div className="upcoming-list">{auction.upcoming.map((item,index)=><article key={item.id}><span>{String(auction.cursor+index+2).padStart(3,"0")}</span><div><strong>{item.name}</strong><small>{item.role} · BAT {item.batting} · BOWL {item.bowling}</small></div></article>)}{!auction.upcoming.length&&<p>No more upcoming players.</p>}</div>:tab==="recent"?<div className="recent-sales">{auction.recentSales?.map((sale,index)=><article className={sale.unsold?"unsold":""} key={`${sale.playerId}-${sale.soldAt}-${index}`}><span>{String(index+1).padStart(2,"0")}</span><div><strong>{sale.playerName}</strong><small>{sale.unsold?"UNSOLD":`SOLD TO ${displayTeamCode(sale.team??"")}`}</small></div><b>{sale.unsold?"—":`₹${sale.price} CR`}</b></article>)}{!auction.recentSales?.length&&<p>No completed lots yet.</p>}</div>:tab==="table"&&isHost?<div className="creator-table"><div className="franchise-interest-list">{auction.teams.map(team=><button className={tableTeam?.team===team.team?"active":""} onClick={()=>setSelectedTeam(team.team)} key={team.team}><i className={team.interested===true?"yes":team.interested===false?"no":"idle"}/><span><b>{team.team}</b><small>{team.owner}</small></span><em>{team.ai?"AI":"HUMAN"}</em></button>)}</div><div className="table-roster"><header><div><span>{tableTeam?.team}</span><strong>{tableTeam?.owner}</strong></div><b>₹{tableTeam?.purse} CR</b></header><div>{tableTeam?.players.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.role} · {item.retained?"RETAINED":"BOUGHT"}</small></div><b>₹{item.price} CR</b></article>)}{!tableTeam?.players.length&&<p>No players in this roster yet.</p>}</div></div></div>:<div className="my-auction-team"><header><div><span>{myTeam?.team??"NO TEAM"}</span><strong>₹{myTeam?.purse??0} CR LEFT</strong></div><b>{myTeam?.players.length??0} PLAYERS</b></header><div>{myTeam?.players.map(item=><article key={item.id}><div><strong>{item.name}</strong><small>{item.role} · {item.retained?"RETAINED":"BOUGHT"}</small></div><b>₹{item.price} CR</b></article>)}</div></div>}</aside>
    </div>
    {salePopup&&<div className={`sale-result${salePopup.unsold?" unsold":""}`} role="status"><div className="sale-hammer">{salePopup.unsold?"×":"✓"}</div><span>{salePopup.unsold?"LOT CLOSED":"SOLD"}</span><h2>{salePopup.playerName}</h2>{salePopup.unsold?<p>UNSOLD</p>:<><p>SOLD TO <b>{displayTeamCode(salePopup.team??"")}</b></p><strong>₹{salePopup.price} CR</strong></>}<small>NEXT PLAYER IN A MOMENT</small></div>}
    {setPopup&&<div className="set-result" role="status"><header><div><span>SET COMPLETE</span><h2>{setPopup.setName}</h2></div><button onClick={()=>setSetPopup(null)}>CONTINUE →</button></header><div>{setPopup.sales.map(sale=><article className={sale.unsold?"unsold":""} key={sale.playerId}><strong>{sale.playerName}</strong>{sale.unsold?<span>UNSOLD</span>:<><span>SOLD TO <b>{displayTeamCode(sale.team??"")}</b></span><em>₹{sale.price} CR</em></>}</article>)}</div><footer>{setPopup.sales.filter(sale=>!sale.unsold).length} SOLD · {setPopup.sales.filter(sale=>sale.unsold).length} UNSOLD</footer></div>}
    {confirmTest&&<div className="test-season-overlay" role="presentation" onClick={()=>setConfirmTest(false)}><div className="test-season-dialog" role="dialog" aria-modal="true" aria-labelledby="test-season-title" onClick={event=>event.stopPropagation()}><span>CREATOR CONTROL · TEST MODE</span><h2 id="test-season-title">SKIP TO THE SEASON?</h2><p>The remaining auction will close. Every team gets a balanced test squad with batting, keeping, pace and spin options. Retained and already bought players stay with their teams.</p><div><button type="button" disabled={busy} onClick={()=>setConfirmTest(false)}>KEEP AUCTION</button><button type="button" disabled={busy} onClick={()=>act("skipAuctionForTesting")}>{busy?"BUILDING SQUADS…":"BUILD SQUADS & START"} <b>→</b></button></div></div></div>}
  </section>;
}
