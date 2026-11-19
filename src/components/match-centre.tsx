"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { batterMatchConfidence } from "@/lib/ai/batter-confidence";

type Player = {
  id: number;
  name: string;
  role: string;
  batting: number;
  bowling: number;
  confidence?: number;
  fielding: number;
  retained: boolean;
};
type Team = { team: string; display: string; owner: string; players: Player[] };
type BatterStat = {
  playerId: number;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  dismissal: string;
  strikeRate: number;
};
type BowlerStat = {
  playerId: number;
  name: string;
  balls: number;
  runs: number;
  wickets: number;
  economy: number;
};
type Innings = {
  team: string;
  runs: number;
  wickets: number;
  overs: string;
  batting: BatterStat[];
  bowling: BowlerStat[];
  fallOfWickets?: string[];
};
type TeamTactics = {
  battingApproach: "Defend" | "Rotate" | "Attack";
  batterApproaches?: Record<number, "Defend" | "Rotate" | "Attack">;
  bowlingApproach: "Attack" | "Balanced" | "Contain";
  field: "Attacking" | "Balanced" | "Defensive";
  nextBatter?: number;
  nextBowler?: number;
};
type LiveMatch = {
  innings: 1 | 2;
  battingTeam: string;
  bowlingTeam: string;
  runs: number;
  wickets: number;
  balls: number;
  target?: number;
  striker: number;
  nonStriker: number;
  next: number;
  bowler: number;
  batters: Record<
    number,
    { runs: number; balls: number; fours: number; sixes: number; out: boolean }
  >;
  bowlers: Record<number, { balls: number; runs: number; wickets: number }>;
  recent: string[];
  commentary: string;
  awaitingBatter?: boolean;
  completed?: boolean;
};
type Setup = {
  stage: "pitch" | "lineup" | "toss" | "live";
  pitch?: string;
  lineups: Record<string, number[]>;
  tactics?: Record<string, TeamTactics>;
  coinCall?: "heads" | "tails";
  coinResult?: "heads" | "tails";
  tossWinner?: string;
  tossDecision?: string;
  battingFirst?: string;
  pace?: "ball" | "over";
  started?: boolean;
  live?: LiveMatch;
};
type Fixture = {
  id: number;
  round: number;
  home: string;
  away: string;
  status: string;
  setup?: Setup;
  result?: {
    pitch: string;
    venue: string;
    first: Innings;
    second: Innings;
    winner: string;
    summary: string;
    playerOfMatch: string;
  };
};
type MatchData = {
  code: string;
  host: string;
  players: { name: string; team: string; host: boolean }[];
  fixture: Fixture;
  home: Team;
  away: Team;
  currentMatch: number;
};

function newerMatch(current: MatchData | null, incoming: MatchData): MatchData {
  if (!current || current.code !== incoming.code || current.fixture.id !== incoming.fixture.id)
    return incoming;
  if (current.fixture.result && !incoming.fixture.result) return current;
  if (incoming.fixture.result) return incoming;
  const stages = { pitch: 0, lineup: 1, toss: 2, live: 3 };
  const oldSetup = current.fixture.setup;
  const newSetup = incoming.fixture.setup;
  if (oldSetup && (!newSetup || stages[newSetup.stage] < stages[oldSetup.stage]))
    return current;
  const oldLive = oldSetup?.live;
  const newLive = newSetup?.live;
  if (oldLive && !newLive) return current;
  if (oldLive && newLive) {
    if (newLive.innings < oldLive.innings) return current;
    if (newLive.innings === oldLive.innings &&
        (newLive.balls < oldLive.balls ||
          (newLive.balls === oldLive.balls &&
            (newLive.runs < oldLive.runs || newLive.wickets < oldLive.wickets))))
      return current;
  }
  return incoming;
}

function battingScorecard(innings: Innings, lineup: number[], roster: Player[]) {
  const byId = new Map(innings.batting.map((stat) => [stat.playerId, stat]));
  const ordered = lineup.length ? lineup : innings.batting.map((stat) => stat.playerId);
  return [
    ...ordered.map((id) => {
      const stat = byId.get(id);
      if (stat) return stat;
      return {
        playerId: id,
        name: roster.find((player) => player.id === id)?.name ?? "Player",
        runs: 0,
        balls: 0,
        fours: 0,
        sixes: 0,
        dismissal: "did not bat",
        strikeRate: 0,
      };
    }),
    ...innings.batting.filter((stat) => !ordered.includes(stat.playerId)),
  ];
}

export function MatchCentre() {
  const { code, matchId } = useParams<{ code: string; matchId: string }>();
  const router = useRouter();
  const [data, setData] = useState<MatchData | null>(null);
  const [manager, setManager] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [battingApproach, setBattingApproach] =
    useState<TeamTactics["battingApproach"]>("Rotate");
  const [bowlingApproach, setBowlingApproach] =
    useState<TeamTactics["bowlingApproach"]>("Balanced");
  const [field, setField] = useState<TeamTactics["field"]>("Balanced");
  const [nextBowler, setNextBowler] = useState<number | undefined>();
  const pollVersion = useRef(0);
  const mutationPending = useRef(false);
  useEffect(() => {
    const stored = localStorage.getItem("dugoutx_user");
    if (stored)
      try {
        setManager(JSON.parse(stored).name || "");
      } catch {}
    let active = true;
    let pollInFlight = false;
    const refresh = async () => {
      if (pollInFlight || mutationPending.current) return;
      pollInFlight = true;
      const version = pollVersion.current;
      try {
        const response = await fetch(`/api/rooms/${code}/season/matches/${matchId}`, {
          cache: "no-store",
        });
        if (!active || mutationPending.current || version !== pollVersion.current) return;
        if (!response.ok) {
          router.replace(`/seasons/dashboard/${code}`);
          return;
        }
        const result: MatchData = await response.json();
        if (active && !mutationPending.current && version === pollVersion.current)
          setData((current) => newerMatch(current, result));
      } catch {
        // The next poll can recover from a temporary network failure.
      } finally {
        pollInFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 1800);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [code, matchId, router]);
  useEffect(() => {
    if (!data || !manager || selectedIds.length) return;
    const team = data.players.find((player) => player.name === manager)?.team;
    const saved = data.fixture.setup?.lineups[team ?? ""];
    if (saved?.length) setSelectedIds(saved);
  }, [data, manager, selectedIds.length]);
  async function simulate() {
    if (mutationPending.current) return;
    mutationPending.current = true;
    pollVersion.current++;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/rooms/${code}/season/matches/${matchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simulate", name: manager }),
      });
      const result = await response.json();
      if (!response.ok) setMessage(result.error);
      else setData((current) => newerMatch(current, result));
    } catch {
      setMessage("Connection lost. Try again.");
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }
  async function update(action: string, payload: Record<string, unknown> = {}) {
    if (mutationPending.current) return;
    mutationPending.current = true;
    pollVersion.current++;
    setBusy(true);
    setMessage("");
    try {
      const live = data?.fixture.setup?.live;
      const response = await fetch(`/api/rooms/${code}/season/matches/${matchId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          name: manager,
          ...payload,
          ...(action === "advance" && live
            ? { expectedInnings: live.innings, expectedBalls: live.balls }
            : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result.error);
        if (response.status === 409) {
          const latest = await fetch(`/api/rooms/${code}/season/matches/${matchId}`, {
            cache: "no-store",
          });
          if (latest.ok) {
            const latestResult: MatchData = await latest.json();
            setData((current) => newerMatch(current, latestResult));
          }
        }
      } else setData((current) => newerMatch(current, result));
    } catch {
      setMessage("Connection lost. Try again.");
    } finally {
      mutationPending.current = false;
      setBusy(false);
    }
  }
  if (!data) return <div className="room-loading">Opening match centre…</div>;
  const viewer = data.players.find((player) => player.name === manager);
  const isHost = data.host === manager && Boolean(viewer?.host);
  const result = data.fixture.result;
  const setup = data.fixture.setup;
  const myTeam =
    viewer?.team === data.home.team
      ? data.home
      : viewer?.team === data.away.team
        ? data.away
        : null;
  const teamFor = (code: string) =>
    code === data.home.team ? data.home : data.away;
  const myLineup = myTeam && setup?.lineups[myTeam.team];
  const live = setup?.live,
    battingLive = live ? teamFor(live.battingTeam) : null,
    bowlingLive = live ? teamFor(live.bowlingTeam) : null,
    batIds = live ? (setup?.lineups[live.battingTeam] ?? []) : [],
    striker = live
      ? battingLive?.players.find(
          (player) => player.id === batIds[live.striker],
        )
      : null,
    nonStriker = live
      ? battingLive?.players.find(
          (player) => player.id === batIds[live.nonStriker],
        )
      : null,
    currentBowler = live
      ? bowlingLive?.players.find((player) => player.id === live.bowler)
      : null;
  const confidenceFor = (player: Player | null | undefined) => {
    if (!player || !live) return 0;
    const stat = live.batters[player.id];
    if (!stat) return 0;
    return batterMatchConfidence({
      playerId: player.id,
      batting: player.batting,
      baseConfidence: player.confidence ?? 70,
      role: player.role,
      pitch: setup?.pitch ?? "Flat",
      battingPosition: batIds.indexOf(player.id) + 1,
      balls: stat.balls,
      runs: stat.runs,
      fours: stat.fours,
      sixes: stat.sixes,
      inningsSeed: `${data.code}:${data.fixture.id}:${live.innings}`,
    }).value;
  };
  const waiting = (title: string, copy: string) => (
    <div className="mc-control">
      <span>SPECTATOR MODE</span>
      <h2>{title}</h2>
      <p>{copy}</p>
      <div className="mc-waiting">
        <i /> CONNECTED TO LIVE ROOM
      </div>
    </div>
  );
  let preparation = waiting(
    "MATCH PREPARATION",
    "The participating managers are preparing for the match.",
  );
  if (setup?.stage === "pitch")
    preparation =
      viewer?.team === data.home.team ? (
        <div className="mc-prep">
          <span>HOME ADVANTAGE</span>
          <h2>PREPARE THE PITCH</h2>
          <p>
            Choose the surface for this home fixture. Conditions will affect
            every player matchup.
          </p>
          <div className="pitch-choice-grid">
            {["Flat", "Green", "Dry", "Bouncy", "Slow"].map((pitch) => (
              <button
                disabled={busy}
                onClick={() => update("pitch", { pitch })}
                key={pitch}
              >
                <b>{pitch}</b>
                <small>
                  {pitch === "Flat"
                    ? "True bounce · high scoring"
                    : pitch === "Green"
                      ? "Swing and seam movement"
                      : pitch === "Dry"
                        ? "Turn increases through the match"
                        : pitch === "Bouncy"
                          ? "Extra carry for fast bowlers"
                          : "Grip, cutters and spin"}
                </small>
              </button>
            ))}
          </div>
          {message && <em>{message}</em>}
        </div>
      ) : (
        waiting(
          "HOME TEAM PREPARING",
          "The home manager is choosing the match surface.",
        )
      );
  if (setup?.stage === "lineup")
    preparation =
      myTeam && !myLineup ? (
        <div className="mc-prep lineup-prep">
          <span>
            {setup.pitch?.toUpperCase()} PITCH · {selectedIds.length}/11
          </span>
          <h2>BUILD YOUR PLAYING XI</h2>
          <p>
            Select players in batting order. Positions 1–2 open, 3–5 form the
            middle order, and the remaining slots complete the XI.
          </p>
          <div className="team-sheet">
            <div className="xi-slots">
              {Array.from({ length: 11 }, (_, index) => {
                const player = myTeam.players.find(
                  (item) => item.id === selectedIds[index],
                );
                return (
                  <article key={index} className={player ? "filled" : ""}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    <span>
                      <strong>{player?.name ?? "EMPTY POSITION"}</strong>
                      <small>
                        {player
                          ? `${player.role} · BAT ${player.batting} · BOWL ${player.bowling}`
                          : index < 2
                            ? "OPENER"
                            : index < 5
                              ? "MIDDLE ORDER"
                              : "PLAYING XI"}
                      </small>
                    </span>
                    {player && (
                      <button
                        onClick={() =>
                          setSelectedIds((ids) =>
                            ids.filter((id) => id !== player.id),
                          )
                        }
                      >
                        ×
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="squad-picker">
              {myTeam.players
                .filter((player) => !selectedIds.includes(player.id))
                .map((player) => (
                  <button
                    disabled={selectedIds.length >= 11}
                    onClick={() => setSelectedIds((ids) => [...ids, player.id])}
                    key={player.id}
                  >
                    <i>{player.role}</i>
                    <span>
                      <b>{player.name}</b>
                      <small>
                        BAT {player.batting} · BOWL {player.bowling} · FIELD{" "}
                        {player.fielding}
                      </small>
                    </span>
                    <strong>+</strong>
                  </button>
                ))}
            </div>
          </div>
          <button
            className="lock-xi"
            disabled={busy || selectedIds.length !== 11}
            onClick={() => update("lineup", { playerIds: selectedIds })}
          >
            LOCK XI & BATTING ORDER <b>→</b>
          </button>
          {message && <em>{message}</em>}
        </div>
      ) : (
        waiting(
          myLineup ? "XI LOCKED" : "WAITING FOR TEAM SHEETS",
          myLineup
            ? "Your team sheet is confirmed. Waiting for the other franchise."
            : "The participating managers are selecting their playing elevens.",
        )
      );
  if (setup?.stage === "toss")
    preparation = !setup.tossWinner ? (
      viewer?.team === data.away.team ? (
        <div className="mc-control">
          <span>AWAY CAPTAIN'S CALL</span>
          <h2>HEADS OR TAILS?</h2>
          <p>The coin is ready. Make your call before it is tossed.</p>
          <div className="toss-actions">
            <button
              disabled={busy}
              onClick={() => update("toss", { coinCall: "heads" })}
            >
              HEADS
            </button>
            <button
              disabled={busy}
              onClick={() => update("toss", { coinCall: "tails" })}
            >
              TAILS
            </button>
          </div>
          {message && <em>{message}</em>}
        </div>
      ) : (
        waiting(
          "AWAY TEAM TO CALL",
          `${data.away.display} must call heads or tails.`,
        )
      )
    ) : setup.tossWinner === viewer?.team ? (
      <div className="mc-control">
        <span>
          {setup.coinCall?.toUpperCase()} CALLED ·{" "}
          {setup.coinResult?.toUpperCase()} LANDED
        </span>
        <h2>YOU WON — BAT OR BOWL?</h2>
        <p>Only your team can make this decision.</p>
        <div className="toss-actions">
          <button
            disabled={busy}
            onClick={() => update("decision", { decision: "bat" })}
          >
            BAT FIRST
          </button>
          <button
            disabled={busy}
            onClick={() => update("decision", { decision: "bowl" })}
          >
            BOWL FIRST
          </button>
        </div>
        {message && <em>{message}</em>}
      </div>
    ) : (
      waiting(
        `${teamFor(setup.tossWinner).display} WON THE TOSS`,
        "Waiting for the winning manager or AI to choose.",
      )
    );
  if (setup?.stage === "live")
    preparation = !myTeam ? (
      <div className="mc-prep live-console spectator-console">
        <span>LIVE SPECTATOR · {setup.pitch?.toUpperCase()} PITCH</span>
        <h2>{data.home.display} VS {data.away.display}</h2>
        {live && <section className="live-scoreboard">
          <header>
            <div><small>INNINGS {live.innings}</small><strong>{battingLive?.display}</strong></div>
            <div className="score-total"><h2>{live.runs}<i>/{live.wickets}</i></h2><span className="score-rates"><b>CR {live.balls ? ((live.runs * 6) / live.balls).toFixed(2) : "0.00"}</b>{live.target && <b>RR {((Math.max(0, live.target - live.runs) * 6) / Math.max(1, 120 - live.balls)).toFixed(2)}</b>}</span></div>
            <div><small>OVERS</small><strong>{Math.floor(live.balls / 6)}.{live.balls % 6}</strong>{live.target && <b>TARGET {live.target}</b>}</div>
          </header>
          <div className="live-players">
            {[{ label: "STRIKER", player: striker }, { label: "NON-STRIKER", player: nonStriker }].map(({ label, player }) => <article key={label}><small>{label}</small><strong>{player?.name ?? "—"}</strong><b>{player ? live.batters[player.id]?.runs ?? 0 : 0} <i>({player ? live.batters[player.id]?.balls ?? 0 : 0})</i></b>{player && <div className="batter-confidence"><span>CONFIDENCE <b>{confidenceFor(player)}%</b></span><progress max="100" value={confidenceFor(player)} aria-label={`${player.name} in-match confidence`} /></div>}</article>)}
            <article><small>CURRENT BOWLER</small><strong>{currentBowler?.name ?? "—"}</strong><b>{currentBowler ? live.bowlers[currentBowler.id]?.wickets ?? 0 : 0}/{currentBowler ? live.bowlers[currentBowler.id]?.runs ?? 0 : 0}<i> ({currentBowler ? `${Math.floor((live.bowlers[currentBowler.id]?.balls ?? 0) / 6)}.${(live.bowlers[currentBowler.id]?.balls ?? 0) % 6} OV` : "0.0 OV"})</i></b></article>
          </div>
          <footer><div>{live.recent.map((ball, index) => <i className={ball === "W" ? "wicket" : ball === "4" || ball === "6" ? "boundary" : ""} key={index}>{ball}</i>)}</div><p>{live.commentary}</p></footer>
        </section>}
        {!live && <p>Waiting for the teams to enter the stadium.</p>}
        {isHost && !data.players.some(player => player.team === data.home.team || player.team === data.away.team) && (
          <button disabled={busy} onClick={simulate}>
            {busy ? "SIMULATING…" : "SIMULATE AI MATCH"}
            <b>→</b>
          </button>
        )}
      </div>
    ) : (
      <div className="mc-prep live-console">
        <span>TACTICAL COMMAND · {setup.pitch?.toUpperCase()} PITCH</span>
        <h2>
          {teamFor(setup.battingFirst ?? data.home.team).display} BAT FIRST
        </h2>
        {live && (
          <section className="live-scoreboard">
            <header>
              <div>
                <small>INNINGS {live.innings}</small>
                <strong>{battingLive?.display}</strong>
              </div>
              <div className="score-total">
                <h2>
                  {live.runs}
                  <i>/{live.wickets}</i>
                </h2>
                <span className="score-rates">
                  <b>
                    CR{" "}
                    {live.balls
                      ? ((live.runs * 6) / live.balls).toFixed(2)
                      : "0.00"}
                  </b>
                  {live.innings === 2 && live.target && (
                    <b>
                      RR{" "}
                      {(
                        (Math.max(0, live.target - live.runs) * 6) /
                        Math.max(1, 120 - live.balls)
                      ).toFixed(2)}
                    </b>
                  )}
                </span>
              </div>
              <div>
                <small>OVERS</small>
                <strong>
                  {Math.floor(live.balls / 6)}.{live.balls % 6}
                </strong>
                {live.target && <b>TARGET {live.target}</b>}
              </div>
            </header>
            <div className="live-players">
              <article>
                <small>STRIKER</small>
                <strong>{striker?.name}</strong>
                <b>
                  {striker ? live.batters[striker.id]?.runs : 0}{" "}
                  <i>({striker ? live.batters[striker.id]?.balls : 0})</i>
                </b>
                {striker && <div className="batter-confidence"><span>CONFIDENCE <b>{confidenceFor(striker)}%</b></span><progress max="100" value={confidenceFor(striker)} aria-label={`${striker.name} in-match confidence`} /></div>}
              </article>
              <article>
                <small>NON-STRIKER</small>
                <strong>{nonStriker?.name}</strong>
                <b>
                  {nonStriker ? live.batters[nonStriker.id]?.runs : 0}{" "}
                  <i>({nonStriker ? live.batters[nonStriker.id]?.balls : 0})</i>
                </b>
                {nonStriker && <div className="batter-confidence"><span>CONFIDENCE <b>{confidenceFor(nonStriker)}%</b></span><progress max="100" value={confidenceFor(nonStriker)} aria-label={`${nonStriker.name} in-match confidence`} /></div>}
              </article>
              <article>
                <small>CURRENT BOWLER</small>
                <strong>{currentBowler?.name}</strong>
                <b>
                  {currentBowler
                    ? (live.bowlers[currentBowler.id]?.wickets ?? 0)
                    : 0}
                  /
                  {currentBowler
                    ? (live.bowlers[currentBowler.id]?.runs ?? 0)
                    : 0}
                  <i>
                    {" "}
                    (
                    {currentBowler
                      ? `${Math.floor((live.bowlers[currentBowler.id]?.balls ?? 0) / 6)}.${(live.bowlers[currentBowler.id]?.balls ?? 0) % 6} OV`
                      : "0.0 OV"}
                    )
                  </i>
                </b>
              </article>
            </div>
            <footer>
              <div>
                {live.recent.map((ball, index) => (
                  <i
                    className={
                      ball === "W"
                        ? "wicket"
                        : ball === "4" || ball === "6"
                          ? "boundary"
                          : ""
                    }
                    key={index}
                  >
                    {ball}
                  </i>
                ))}
              </div>
              <p>{live.commentary}</p>
            </footer>
          </section>
        )}
        <button
          className="start-live score-advance"
          disabled={busy || live?.completed || live?.awaitingBatter}
          onClick={() => update("advance")}
        >
          {busy
            ? "PLAYING…"
            : setup.pace === "over"
              ? "PLAY NEXT OVER"
              : "PLAY NEXT BALL"}{" "}
          <b>→</b>
        </button>
        {live?.awaitingBatter && viewer?.team === live.battingTeam && (
          <div className="bowler-modal batter-modal">
            <section>
              <span>
                WICKET · {live.runs}/{live.wickets}
              </span>
              <h3>CHOOSE THE NEXT BATTER</h3>
              <p>Select any available batter from your playing XI.</p>
              <div>
                {myTeam.players
                  .filter(
                    (player) =>
                      myLineup?.includes(player.id) &&
                      !live.batters[player.id]?.out &&
                      live.batters[player.id]?.balls === 0 &&
                      player.id !== batIds[live.striker] &&
                      player.id !== batIds[live.nonStriker],
                  )
                  .map((player) => (
                    <button
                      onClick={() =>
                        update("nextBatter", { batterId: player.id })
                      }
                      key={player.id}
                    >
                      <strong>{player.name}</strong>
                      <small>
                        BAT {player.batting} · {player.role}
                      </small>
                    </button>
                  ))}
              </div>
            </section>
          </div>
        )}
        <div className="tactics-grid">
          {live && viewer?.team === live.battingTeam && (
            <section>
              <label>INDIVIDUAL BATTER APPROACH</label>
              <div className="batter-intents">
                {[striker, nonStriker]
                  .filter((player): player is Player => Boolean(player))
                  .map((player) => {
                    const selected =
                      setup.tactics?.[live.battingTeam]?.batterApproaches?.[
                        player.id
                      ] ?? "Rotate";
                    return (
                      <article key={player.id}>
                        <header>
                          <strong>{player.name}</strong>
                          <small>
                            {player.id === striker?.id
                              ? "ON STRIKE"
                              : "NON-STRIKER"}
                          </small>
                        </header>
                        <div>
                          {(["Defend", "Rotate", "Attack"] as const).map(
                            (value) => (
                              <button
                                className={selected === value ? "active" : ""}
                                onClick={() =>
                                  update("batterApproach", {
                                    batterId: player.id,
                                    batterApproach: value,
                                  })
                                }
                                key={value}
                              >
                                {value}
                              </button>
                            ),
                          )}
                        </div>
                        <footer>
                          <span>
                            RUN POTENTIAL{" "}
                            <b>
                              {selected === "Attack"
                                ? "82%"
                                : selected === "Rotate"
                                  ? "55%"
                                  : "30%"}
                            </b>
                          </span>
                          <span>
                            WICKET RISK{" "}
                            <b>
                              {selected === "Attack"
                                ? "70%"
                                : selected === "Rotate"
                                  ? "35%"
                                  : "15%"}
                            </b>
                          </span>
                        </footer>
                      </article>
                    );
                  })}
              </div>
            </section>
          )}
          {viewer?.team === live?.bowlingTeam && (
            <section>
              <label>BOWLING APPROACH</label>
              <div>
                {(["Attack", "Balanced", "Contain"] as const).map((value) => (
                  <button
                    className={bowlingApproach === value ? "active" : ""}
                    onClick={() => setBowlingApproach(value)}
                    key={value}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className="approach-impact">
                <span>
                  RUN RISK{" "}
                  <b>
                    {bowlingApproach === "Attack"
                      ? "72%"
                      : bowlingApproach === "Balanced"
                        ? "50%"
                        : "30%"}
                  </b>
                </span>
                <span>
                  WICKET CHANCE{" "}
                  <b>
                    {bowlingApproach === "Attack"
                      ? "78%"
                      : bowlingApproach === "Balanced"
                        ? "54%"
                        : "28%"}
                  </b>
                </span>
              </div>
              <label>FIELD SETTING</label>
              <div>
                {(["Attacking", "Balanced", "Defensive"] as const).map(
                  (value) => (
                    <button
                      className={field === value ? "active" : ""}
                      onClick={() => setField(value)}
                      key={value}
                    >
                      {value}
                    </button>
                  ),
                )}
              </div>
              <div className={`field-preview ${field.toLowerCase()}`}>
                <span className="field-boundary" />
                <span className="field-ring" />
                <span className="field-pitch" />
                {Array.from({ length: 9 }, (_, index) => (
                  <i key={index}>{index + 1}</i>
                ))}
                <b>{field.toUpperCase()} FIELD</b>
              </div>
              <div className="field-impact">
                <span>
                  RUN RISK{" "}
                  <b>
                    {field === "Attacking"
                      ? "75%"
                      : field === "Balanced"
                        ? "50%"
                        : "24%"}
                  </b>
                </span>
                <span>
                  WICKET CHANCE{" "}
                  <b>
                    {field === "Attacking"
                      ? "80%"
                      : field === "Balanced"
                        ? "55%"
                        : "18%"}
                  </b>
                </span>
              </div>
              {(live?.balls ?? 0) % 6 >= 4 && (
                <>
                  <label>NEXT OVER BOWLER</label>
                  <select
                    value={nextBowler ?? ""}
                    onChange={(event) =>
                      setNextBowler(Number(event.target.value) || undefined)
                    }
                  >
                    <option value="">AUTO SELECT</option>
                    {myTeam.players
                      .filter(
                        (player) =>
                          myLineup?.includes(player.id) &&
                          (player.role === "PACE" ||
                            player.role === "SPIN" ||
                            player.role === "AR"),
                      )
                      .map((player) => (
                        <option value={player.id} key={player.id}>
                          {player.name}
                        </option>
                      ))}
                  </select>
                </>
              )}
            </section>
          )}
        </div>
        <button
          className="save-plan"
          disabled={busy}
          onClick={() =>
            update("tactics", {
              battingApproach,
              bowlingApproach,
              field,
              nextBowler,
            })
          }
        >
          APPLY TO NEXT DELIVERY
        </button>
        <div className="pace-actions">
          <button
            className={setup.pace === "ball" ? "active" : ""}
            onClick={() => update("pace", { pace: "ball" })}
          >
            BALL BY BALL
          </button>
          <button
            className={setup.pace === "over" ? "active" : ""}
            onClick={() => update("pace", { pace: "over" })}
          >
            OVER BY OVER
          </button>
        </div>
        {live &&
          viewer?.team === live.bowlingTeam &&
          live.balls > 0 &&
          live.balls % 6 === 0 &&
          (!setup.tactics?.[live.bowlingTeam]?.nextBowler ||
            setup.tactics?.[live.bowlingTeam]?.nextBowler === live.bowler ||
            (live.bowlers[setup.tactics?.[live.bowlingTeam]?.nextBowler ?? -1]
              ?.balls ?? 0) >= 24) && (
            <div className="bowler-modal">
              <section>
                <span>OVER {live.balls / 6} COMPLETE</span>
                <h3>CHOOSE THE NEXT BOWLER</h3>
                <p>The previous bowler cannot bowl consecutive overs.</p>
                <div>
                  {myTeam.players
                    .filter(
                      (player) =>
                        myLineup?.includes(player.id) &&
                        player.id !== live.bowler &&
                        (live.bowlers[player.id]?.balls ?? 0) < 24 &&
                        (player.role === "PACE" ||
                          player.role === "SPIN" ||
                          player.role === "AR"),
                    )
                    .map((player) => {
                      const figures = live.bowlers[player.id];
                      return (
                        <button
                          className={nextBowler === player.id ? "active" : ""}
                          onClick={() => setNextBowler(player.id)}
                          key={player.id}
                        >
                          <strong>{player.name}</strong>
                          <small>
                            {figures
                              ? `${Math.floor(figures.balls / 6)}.${figures.balls % 6} OV · ${figures.wickets}/${figures.runs}`
                              : "YET TO BOWL"}
                          </small>
                        </button>
                      );
                    })}
                </div>
                <button
                  disabled={!nextBowler || busy}
                  onClick={() =>
                    update("tactics", {
                      battingApproach,
                      bowlingApproach,
                      field,
                      nextBowler,
                    })
                  }
                >
                  CONFIRM BOWLER <b>→</b>
                </button>
              </section>
            </div>
          )}
        {message && <em>{message}</em>}
      </div>
    );
  if (setup?.stage === "live" && !setup.started)
    preparation = !myTeam ? (
      <div className="mc-control live-ready">
        <span>AI FIXTURE · {setup.pitch?.toUpperCase()} PITCH</span>
        <h2>AUTOMATED MATCH</h2>
        <p>
          AI versus AI matches are simulated without human tactical controls.
        </p>
        {isHost && (
          <button disabled={busy} onClick={simulate}>
            SIMULATE AI MATCH <b>→</b>
          </button>
        )}
      </div>
    ) : (
      <div className="mc-control live-ready">
        <span>MATCH READY · {setup.pitch?.toUpperCase()} PITCH</span>
        <h2>
          {teamFor(setup.battingFirst ?? data.home.team).display} BAT FIRST
        </h2>
        <p>
          Enter the stadium first. Viewing pace and every tactical decision are
          controlled from inside the live match.
        </p>
        <button disabled={busy} onClick={() => update("start")}>
          ENTER LIVE MATCH <b>→</b>
        </button>
      </div>
    );
  if (setup?.started && live && !result)
    return (
      <section className="mc-shell live-match-shell">
        <header className="mc-top">
          <button onClick={() => router.push(`/seasons/dashboard/${code}`)}>
            ← SEASON HUB
          </button>
          <div>
            <span>
              LIVE · {battingLive?.display} vs {bowlingLive?.display}
            </span>
            <strong>
              {setup.pitch?.toUpperCase()} PITCH · INNINGS {live.innings}
            </strong>
          </div>
          <b>
            {Math.floor(live.balls / 6)}.{live.balls % 6} OVERS
          </b>
        </header>
        <main className="live-only-stage">{preparation}</main>
      </section>
    );
  return (
    <section className="mc-shell">
      <header className="mc-top">
        <button onClick={() => router.push(`/seasons/dashboard/${code}`)}>
          ← SEASON HUB
        </button>
        <div>
          <span>LIVE MATCH CENTRE</span>
          <strong>ROOM {code}</strong>
        </div>
        <b>
          MATCH {String(data.fixture.id).padStart(2, "0")} · ROUND{" "}
          {data.fixture.round}
        </b>
      </header>
      <main className={`mc-stage${result ? " mc-stage-result" : ""}`}>
        <section className="mc-scoreboard">
          <header>
            <span className={result ? "complete" : "ready"}>
              <i />
              {result ? "FULL TIME" : "READY TO BEGIN"}
            </span>
            <b>LEAGUE STAGE</b>
          </header>
          <div className="mc-matchup">
            <article>
              <small>HOME</small>
              <strong>{data.home.display}</strong>
              <span>{data.home.owner}</span>
              {result && (
                <b>
                  {data.fixture.result?.first.team === data.home.team
                    ? result.first.runs
                    : result.second.runs}
                  <i>
                    /
                    {data.fixture.result?.first.team === data.home.team
                      ? result.first.wickets
                      : result.second.wickets}
                  </i>
                </b>
              )}
            </article>
            <div className="mc-vs">
              <span>VS</span>
              <i />
            </div>
            <article>
              <small>AWAY</small>
              <strong>{data.away.display}</strong>
              <span>{data.away.owner}</span>
              {result && (
                <b>
                  {data.fixture.result?.first.team === data.away.team
                    ? result.first.runs
                    : result.second.runs}
                  <i>
                    /
                    {data.fixture.result?.first.team === data.away.team
                      ? result.first.wickets
                      : result.second.wickets}
                  </i>
                </b>
              )}
            </article>
          </div>
          {result ? (
            <div className="mc-result">
              <span>MATCH RESULT · {result.pitch?.toUpperCase()} PITCH</span>
              <h1>{result.summary}</h1>
              <p>
                {result.venue} · PLAYER OF THE MATCH{" "}
                <b>{result.playerOfMatch}</b>
              </p>
              <div className="mc-innings-summary">
                {[result.first, result.second].map((innings) => (
                  <article key={innings.team}>
                    <span>{teamFor(innings.team).display}</span>
                    <strong>
                      {innings.runs}/{innings.wickets}
                    </strong>
                    <small>{innings.overs} OVERS</small>
                  </article>
                ))}
              </div>
              {Array.isArray(result.first.batting) && Array.isArray(result.second.batting) && Array.isArray(result.first.bowling) && Array.isArray(result.second.bowling) ? <section className="mc-full-scorecard" aria-label="Full match scorecard">
                {[result.first, result.second].map((innings, index) => {
                  const battingTeam = teamFor(innings.team);
                  const bowlingTeam = teamFor(
                    innings.team === data.home.team ? data.away.team : data.home.team,
                  );
                  const lineup = setup?.lineups[innings.team] ?? [];
                  const batters = battingScorecard(
                    innings,
                    lineup,
                    battingTeam.players,
                  );
                  const extras = Math.max(
                    0,
                    innings.runs - innings.batting.reduce((sum, stat) => sum + stat.runs, 0),
                  );
                  return (
                    <article className="mc-innings-card" key={innings.team}>
                      <header>
                        <div><small>INNINGS {index + 1}</small><strong>{battingTeam.display} BATTING</strong></div>
                        <div><strong>{innings.runs}/{innings.wickets}</strong><small>{innings.overs} OVERS</small></div>
                      </header>
                      <div className="mc-stat-scroll">
                        <table>
                          <thead><tr><th>BATTER</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
                          <tbody>
                            {batters.map((stat) => (
                              <tr key={stat.playerId}>
                                <td><strong>{stat.name}</strong><small>{stat.dismissal}</small></td>
                                <td className="mc-stat-emphasis">{stat.dismissal === "did not bat" ? "—" : stat.runs}</td>
                                <td>{stat.dismissal === "did not bat" ? "—" : stat.balls}</td>
                                <td>{stat.dismissal === "did not bat" ? "—" : stat.fours}</td>
                                <td>{stat.dismissal === "did not bat" ? "—" : stat.sixes}</td>
                                <td>{stat.dismissal === "did not bat" ? "—" : stat.strikeRate.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {!lineup.length && batters.length < 11 && <p className="mc-scorecard-note">The complete playing XI was not recorded for this older match.</p>}
                      <div className="mc-scorecard-total"><span>EXTRAS <b>{extras}</b></span><strong>TOTAL <b>{innings.runs}/{innings.wickets}</b> <small>({innings.overs} OV)</small></strong></div>
                      <div className="mc-bowling-title">{bowlingTeam.display} BOWLING</div>
                      <div className="mc-stat-scroll">
                        <table>
                          <thead><tr><th>BOWLER</th><th>O</th><th>R</th><th>W</th><th>ECON</th></tr></thead>
                          <tbody>
                            {innings.bowling.map((stat) => (
                              <tr key={stat.playerId}>
                                <td><strong>{stat.name}</strong></td>
                                <td>{Math.floor(stat.balls / 6)}.{stat.balls % 6}</td>
                                <td>{stat.runs}</td>
                                <td className="mc-stat-emphasis">{stat.wickets}</td>
                                <td>{stat.economy.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {Boolean(innings.fallOfWickets?.length) && (
                        <div className="mc-fall-of-wickets"><strong>FALL OF WICKETS</strong><span>{innings.fallOfWickets!.join("  ·  ")}</span></div>
                      )}
                    </article>
                  );
                })}
              </section> : <p className="mc-legacy-scorecard">Detailed player figures were not recorded for this older match.</p>}
            </div>
          ) : (
            preparation
          )}
        </section>
        {!result && <aside className="mc-squads">
          <header>
            <span>MATCH SQUADS</span>
            <strong>AUCTION ROSTERS</strong>
          </header>
          {[data.home, data.away].map((team) => (
            <section key={team.team}>
              <header>
                <strong>{team.display}</strong>
                <span>{team.players.length} PLAYERS</span>
              </header>
              <div>
                {team.players.slice(0, 11).map((player, index) => (
                  <article key={player.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{player.name}</strong>
                      <small>
                        {player.role} · BAT {player.batting} · BOWL{" "}
                        {player.bowling}
                      </small>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </aside>}
      </main>
    </section>
  );
}
