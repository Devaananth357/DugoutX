import { MatchPreview } from "@/components/match-preview";
import { PlayNowButton } from "@/components/play-now-button";

function Mark() {
  return <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>;
}

export default function Home() {
  return (
    <main>
      <section className="hero" id="top">
        <header className="site-header">
          <a className="brand" href="#top" aria-label="DugoutX home"><Mark /><span>DUGOUT<span className="brand-x">X</span></span></a>
          <nav aria-label="Primary navigation"><a href="#game">The game</a><a href="#features">Features</a><a href="#about">About</a></nav>
          <a className="sign-in" href="/account">Sign in <span>→</span></a>
        </header>

        <div className="hero-layout">
          <div className="hero-copy">
            <p className="eyebrow"><span className="status-dot" /> The tactical cricket simulator</p>
            <h1>DON’T WATCH<br />THE MATCH.<br /><em>SHAPE IT.</em></h1>
            <p className="hero-lede">Build your XI. Read the pitch. Set the field. Make every ball count in the cricket simulation where your decisions change the match.</p>
            <div className="hero-actions"><PlayNowButton /></div>
            <div className="hero-stats"><div><strong>300+</strong><span>Rated players</span></div><div><strong>∞</strong><span>Match possibilities</span></div><div><strong>1</strong><span>Decision at a time</span></div></div>
          </div>
          <div className="hero-game" id="game"><MatchPreview /></div>
        </div>
        <div className="scroll-cue"><span>Scroll to explore</span><i>↓</i></div>
      </section>

      <section className="feature-strip" id="features"><span>Pitch intelligence</span><i>✦</i><span>Player form</span><i>✦</i><span>Field control</span><i>✦</i><span>Ball-by-ball tactics</span></section>
      <section className="about-section" id="about"><p className="eyebrow">EVERY BALL HAS A REASON</p><h2>CRICKET ISN’T RANDOM.<br /><em>IT’S PRESSURE.</em></h2><p>Player quality sets the level. Form, confidence, matchups and your tactics decide what happens next.</p></section>
    </main>
  );
}
