import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  decideAuctionBid,
  decideRetentions,
  getTeamRoster,
  selectLineup,
  SHEET_PLAYERS,
} from "@/lib/ai";
import type {
  AiDifficulty,
  AiPlayer,
  PitchType,
  RetentionDecision,
} from "@/lib/ai";
import auctionOrder from "../../data/ai/auction-order.json";
import { getAuctionPlayer } from "@/lib/auction-order";
import { teamRepresentative } from "@/lib/team-representatives";
import {
  isPowerplaySpinRisk,
  liveDeliveryProbabilities,
  simulateT20Match,
} from "@/lib/ai/match-simulator";
import type { SimInnings } from "@/lib/ai/match-simulator";
import { getServerFirestore } from "@/lib/firebase-admin";
import { seededUnit } from "@/lib/ai/math";
import { playerOfMatchFromWinner } from "@/lib/ai/player-of-match";
import { isOpener, SQUAD_MINIMUMS, squadBalanceViolations } from "@/lib/ai/squad-balance";
import { createSeasonFixtures, upgradeSeasonFixtures } from "@/lib/season-schedule";

export type Player = { name: string; team: string; host: boolean };
export type TeamRetention = {
  team: string;
  manager: string | null;
  ai: boolean;
  roster: AiPlayer[];
  decision: RetentionDecision | null;
};
export type AuctionPurchase = { playerId: number; team: string; price: number };
export type PendingAiBid = { team: string; amount: number; executeAt: number };
export type AuctionSale = {
  playerId: number;
  team: string | null;
  price: number | null;
  unsold: boolean;
  soldAt: number;
};
export type SetResult = {
  setName: string;
  processedAt: number;
  sales: AuctionSale[];
};
export type MatchInnings = SimInnings;
export type MatchResult = {
  pitch: string;
  venue: string;
  first: MatchInnings;
  second: MatchInnings;
  winner: string;
  summary: string;
  playerOfMatch: string;
};
export type TeamTactics = {
  battingApproach: "Defend" | "Rotate" | "Attack";
  batterApproaches?: Record<number, "Defend" | "Rotate" | "Attack">;
  bowlingApproach: "Attack" | "Balanced" | "Contain";
  field: "Attacking" | "Balanced" | "Defensive";
  nextBatter?: number;
  nextBowler?: number;
};
export type LiveMatch = {
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
    { runs: number; balls: number; fours: number; sixes: number; out: boolean; dismissal?: string }
  >;
  bowlers: Record<number, { balls: number; runs: number; wickets: number }>;
  recent: string[];
  fallOfWickets?: string[];
  matchupBalls?: Record<string, number>;
  commentary: string;
  awaitingBatter?: boolean;
  completed?: boolean;
  firstInnings?: {
    team: string;
    runs: number;
    wickets: number;
    balls: number;
    batters: LiveMatch["batters"];
    bowlers: LiveMatch["bowlers"];
    fallOfWickets?: string[];
  };
};
export type MatchSetup = {
  stage: "pitch" | "lineup" | "toss" | "live";
  pitch?: PitchType;
  lineups: Record<string, number[]>;
  tactics?: Record<string, TeamTactics>;
  coinCall?: "heads" | "tails";
  coinResult?: "heads" | "tails";
  tossWinner?: string;
  tossDecision?: "bat" | "bowl";
  battingFirst?: string;
  pace?: "ball" | "over";
  started?: boolean;
  live?: LiveMatch;
};
export type SeasonFixture = {
  id: number;
  round: number;
  home: string;
  away: string;
  status: "upcoming" | "live" | "complete";
  homeScore?: string;
  awayScore?: string;
  winner?: string;
  result?: MatchResult;
  setup?: MatchSetup;
};
export type SeasonState = {
  fixtures: SeasonFixture[];
  currentMatch: number;
  startedAt: string;
};
export type RoomAuction = {
  playerIds: number[];
  cursor: number;
  currentBid: number | null;
  currentTeam: string | null;
  currentManager: string | null;
  purchases: AuctionPurchase[];
  unsoldPlayerIds: number[];
  pendingAiBid?: PendingAiBid | null;
  interestByTeam?: Record<string, boolean>;
  paused?: boolean;
  nextLotAt?: number;
  lastSale?: AuctionSale | null;
  saleHistory?: AuctionSale[];
  lastSetResult?: SetResult | null;
};
export type Room = {
  code: string;
  host: string;
  createdAt: string;
  team: string;
  difficulty: string;
  fillWithAi: boolean;
  passwordHash: string;
  players: Player[];
  stage?: "lobby" | "retention" | "auction" | "season";
  retentions?: TeamRetention[];
  auction?: RoomAuction;
  season?: SeasonState;
  testSeason?: boolean;
};
type User = { id: string; name: string; email: string; passwordHash: string };
type Database = { users: User[]; rooms: Room[] };
const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "dev-db.json");
const backupDataFile = path.join(dataDirectory, "dev-db.backup.json");
const roomTeams = [
  "BLR",
  "CHE",
  "MUM",
  "KOL",
  "DEL",
  "HYD",
  "PUN",
  "RAJ",
  "LKN",
  "GUJ",
];
function createRoomRetentions(room: Room) {
  const difficulty = (
    room.difficulty === "Expert" || room.difficulty === "Balanced"
      ? room.difficulty
      : "Competitive"
  ) as AiDifficulty;
  return roomTeams.map((team) => {
    const human = room.players.find((item) => item.team === team);
    const roster = getTeamRoster(team);
    return {
      team,
      manager: human?.name ?? null,
      ai: !human,
      roster,
      decision: human
        ? null
        : decideRetentions(
            roster,
            difficulty,
            `${room.code}:${team}:retention`,
          ),
    };
  });
}

async function readLocalDatabase(): Promise<Database> {
  try {
    return JSON.parse(await readFile(dataFile, "utf8"));
  } catch (error) {
    try {
      return JSON.parse(await readFile(backupDataFile, "utf8"));
    } catch {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { users: [], rooms: [] };
      }
      throw new Error("DATABASE_CORRUPT", { cause: error });
    }
  }
}
async function writeLocalDatabase(database: Database) {
  await mkdir(dataDirectory, { recursive: true });
  const contents = JSON.stringify(database, null, 2);
  const temporaryFile = path.join(
    dataDirectory,
    `.dev-db.${process.pid}.${randomUUID()}.tmp`,
  );
  await writeFile(temporaryFile, contents, "utf8");
  try {
    const current = await readFile(dataFile, "utf8");
    JSON.parse(current);
    await writeFile(backupDataFile, current, "utf8");
  } catch {
    // Keep the last valid backup when the current file is unavailable or damaged.
  }
  await rename(temporaryFile, dataFile);
}

let cachedDatabase: Database | null = null;
let databaseInitialization: Promise<Database> | null = null;
let databaseWriteQueue: Promise<void> = Promise.resolve();
const persistedDocuments = new Map<string, string>();

function rememberDocument(key: string, value: unknown) {
  persistedDocuments.set(key, JSON.stringify(value));
}

async function readFirestoreDatabase(): Promise<Database | null> {
  const firestore = await getServerFirestore();
  const roomsSnapshot = await firestore.collection("rooms").get();
  if (roomsSnapshot.empty) return null;
  const usersSnapshot = await firestore.doc("appState/legacyUsers").get();
  rememberDocument("appState/legacyUsers", usersSnapshot.data() ?? { users: [] });
  const rooms = await Promise.all(
    roomsSnapshot.docs.map(async (roomDocument) => {
      const room = roomDocument.data() as Room;
      rememberDocument(`rooms/${roomDocument.id}`, room);
      if (!room.season) return room;
      const fixturesSnapshot = await roomDocument.ref
        .collection("fixtures")
        .orderBy("id")
        .get();
      const fixtures = fixturesSnapshot.docs.map((fixtureDocument) => {
        const fixture = fixtureDocument.data() as SeasonFixture;
        rememberDocument(
          `rooms/${roomDocument.id}/fixtures/${fixtureDocument.id}`,
          fixture,
        );
        return fixture;
      });
      return {
        ...room,
        season: {
          ...room.season,
          fixtures,
        },
      };
    }),
  );
  return {
    users: (usersSnapshot.data()?.users as User[] | undefined) ?? [],
    rooms,
  };
}

async function writeFirestoreDatabase(database: Database) {
  const firestore = await getServerFirestore();
  const writer = firestore.bulkWriter();
  const completedDocuments = new Map<string, string>();
  const pendingWrites: Promise<unknown>[] = [];
  let writes = 0;
  const save = (key: string, reference: FirebaseFirestore.DocumentReference, value: unknown) => {
    const cleanValue = JSON.parse(JSON.stringify(value));
    const serialized = JSON.stringify(cleanValue);
    if (persistedDocuments.get(key) === serialized) return;
    completedDocuments.set(key, serialized);
    pendingWrites.push(writer.set(reference, cleanValue));
    writes += 1;
  };
  save(
    "appState/legacyUsers",
    firestore.doc("appState/legacyUsers"),
    { users: database.users },
  );
  for (const room of database.rooms) {
    const roomReference = firestore.collection("rooms").doc(room.code);
    const storedRoom = room.season
      ? {
          ...room,
          season: {
            currentMatch: room.season.currentMatch,
            startedAt: room.season.startedAt,
          },
        }
      : room;
    save(`rooms/${room.code}`, roomReference, storedRoom);
    for (const fixture of room.season?.fixtures ?? []) {
      save(
        `rooms/${room.code}/fixtures/${fixture.id}`,
        roomReference.collection("fixtures").doc(String(fixture.id)),
        fixture,
      );
    }
  }
  if (writes) {
    const completions = Promise.allSettled(pendingWrites);
    await writer.close();
    const results = await completions;
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    for (const [key, serialized] of completedDocuments) {
      persistedDocuments.set(key, serialized);
    }
  }
}

async function readDatabase(): Promise<Database> {
  if (cachedDatabase) return cachedDatabase;
  databaseInitialization ??= (async () => {
    try {
      const cloudDatabase = await readFirestoreDatabase();
      if (cloudDatabase) return cloudDatabase;
      const localDatabase = await readLocalDatabase();
      if (localDatabase.rooms.length || localDatabase.users.length) {
        await writeFirestoreDatabase(localDatabase);
      }
      return localDatabase;
    } catch (error) {
      if (process.env.RENDER === "true") throw error;
      console.error("Firestore read failed; using the protected local mirror.", error);
      return readLocalDatabase();
    }
  })();
  cachedDatabase = await databaseInitialization;
  return cachedDatabase;
}

async function writeDatabase(database: Database) {
  cachedDatabase = database;
  const snapshot = structuredClone(database);
  databaseWriteQueue = databaseWriteQueue
    .catch(() => undefined)
    .then(async () => {
      if (process.env.RENDER === "true") {
        await writeFirestoreDatabase(snapshot);
      } else {
        await Promise.all([
          writeFirestoreDatabase(snapshot),
          writeLocalDatabase(snapshot),
        ]);
      }
    });
  await databaseWriteQueue;
}
export function hashSecret(
  secret: string,
  salt = randomBytes(16).toString("hex"),
) {
  return `${salt}:${scryptSync(secret, salt, 32).toString("hex")}`;
}
export function verifySecret(secret: string, stored: string) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return timingSafeEqual(
    Buffer.from(hash, "hex"),
    scryptSync(secret, salt, 32),
  );
}
export async function createUser(
  name: string,
  email: string,
  password: string,
) {
  const database = await readDatabase();
  if (database.users.some((user) => user.email === email.toLowerCase()))
    throw new Error("EMAIL_EXISTS");
  const user = {
    id: randomUUID(),
    name,
    email: email.toLowerCase(),
    passwordHash: hashSecret(password),
  };
  database.users.push(user);
  await writeDatabase(database);
  return { id: user.id, name: user.name, email: user.email };
}
export async function signInUser(email: string, password: string) {
  const database = await readDatabase();
  const user = database.users.find(
    (item) => item.email === email.toLowerCase(),
  );
  if (!user || !verifySecret(password, user.passwordHash)) return null;
  return { id: user.id, name: user.name, email: user.email };
}
export async function createRoom(
  input: Omit<Room, "code" | "createdAt" | "passwordHash"> & {
    password: string;
  },
) {
  const database = await readDatabase();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(
      randomBytes(6),
      (byte) => chars[byte % chars.length],
    ).join("");
  } while (database.rooms.some((room) => room.code === code));
  const { password, ...details } = input;
  const room: Room = {
    ...details,
    code,
    createdAt: new Date().toISOString(),
    passwordHash: hashSecret(password),
    stage: "lobby",
  };
  database.rooms.push(room);
  await writeDatabase(database);
  return room;
}
export async function getRoom(code: string) {
  const database = await readDatabase();
  const room =
    database.rooms.find((item) => item.code === code.toUpperCase()) || null;
  let changed = false;
  if (
    room?.stage === "retention" &&
    room.retentions?.some((state) =>
      state.roster.some((player) => /^\w+ Player \d+$/.test(player.name)),
    )
  ) {
    room.retentions = createRoomRetentions(room);
    changed = true;
  }
  if (
    room?.stage === "retention" &&
    room.retentions?.length === 10 &&
    room.retentions.every((team) => team.decision !== null)
  ) {
    room.stage = "auction";
    changed = true;
  }
  if (changed) await writeDatabase(database);
  return room;
}
export async function validateRoom(code: string, password: string) {
  const room = await getRoom(code);
  return room && verifySecret(password, room.passwordHash) ? room : null;
}
export async function joinRoom(code: string, password: string, player: Player) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || !verifySecret(password, room.passwordHash))
    throw new Error("INVALID_ROOM");
  if (room.players.length >= 10) throw new Error("ROOM_FULL");
  if (room.players.some((item) => item.name === player.name)) return room;
  if (room.players.some((item) => item.team === player.team))
    throw new Error("TEAM_TAKEN");
  room.players.push(player);
  await writeDatabase(database);
  return room;
}
export async function shiftPlayer(code: string, name: string, team: string) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const player = room.players.find((item) => item.name === name);
  if (!player) throw new Error("PLAYER_NOT_FOUND");
  if (room.players.some((item) => item.team === team && item.name !== name))
    throw new Error("TEAM_TAKEN");
  player.team = team;
  if (player.host) room.team = team;
  await writeDatabase(database);
  return room;
}
export async function startRoom(code: string, name: string) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room) throw new Error("ROOM_NOT_FOUND");
  const player = room.players.find((item) => item.name === name);
  if (!player?.host || room.host !== name) throw new Error("HOST_ONLY");
  if (room.stage !== "retention") {
    room.retentions = createRoomRetentions(room);
    room.stage = "retention";
  }
  await writeDatabase(database);
  return room;
}
export async function saveRetentions(
  code: string,
  name: string,
  playerIds: number[],
) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || room.stage !== "retention") throw new Error("ROOM_NOT_FOUND");
  const manager = room.players.find((item) => item.name === name);
  if (!manager) throw new Error("PLAYER_NOT_FOUND");
  const state = room.retentions?.find(
    (item) => item.team === manager.team && !item.ai,
  );
  if (!state) throw new Error("TEAM_NOT_FOUND");
  if (playerIds.length > 5 || new Set(playerIds).size !== playerIds.length)
    throw new Error("INVALID_SELECTION");
  const selected = playerIds.map((id) =>
    state.roster.find((player) => player.id === id),
  );
  if (selected.some((player) => !player)) throw new Error("INVALID_SELECTION");
  if (selected[4] && !selected[4].uncapped)
    throw new Error("FIFTH_MUST_BE_UNCAPPED");
  const costs = [18, 14, 10, 8, 4];
  const picks = selected.map((player, index) => ({
    slot: (index + 1) as 1 | 2 | 3 | 4 | 5,
    cost: costs[index],
    player: player!,
    estimatedAuctionValue: 0,
    reasons: ["Selected by human manager"],
  }));
  const totalCost = picks.reduce((sum, pick) => sum + pick.cost, 0);
  state.decision = {
    picks,
    totalCost,
    auctionPurse: 120 - totalCost,
    releasedPlayerIds: state.roster
      .filter((player) => !playerIds.includes(player.id))
      .map((player) => player.id),
    reasons: ["Confirmed by human manager"],
  };
  if (room.retentions?.every((team) => team.decision !== null))
    room.stage = "auction";
  await writeDatabase(database);
  return room;
}

function ensureAuction(room: Room) {
  if (room.auction) return room.auction;
  const retained = new Set(
    room.retentions?.flatMap(
      (team) => team.decision?.picks.map((pick) => pick.player.id) ?? [],
    ) ?? [],
  );
  // Keep the spreadsheet order stable while removing retained players.
  room.auction = {
    playerIds: auctionOrder.sets
      .flatMap((set) => set.playerIds)
      .filter((id) => !retained.has(id)),
    cursor: 0,
    currentBid: null,
    currentTeam: null,
    currentManager: null,
    purchases: [],
    unsoldPlayerIds: [],
  };
  return room.auction;
}

function fixtureSeed(code: string, home: string, away: string, index: number) {
  return [...`${code}:${home}:${away}:${index}`].reduce(
    (sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0,
    2166136261,
  );
}
function createSeason(code: string, firstTeam?: string): SeasonState {
  return {
    fixtures: createSeasonFixtures(code, roomTeams, firstTeam),
    currentMatch: 0,
    startedAt: new Date().toISOString(),
  };
}

function ensureSeasonSchedule(room: Room) {
  if (room.stage !== "season" || room.season?.fixtures.length !== 70) return false;
  room.season.fixtures = upgradeSeasonFixtures(room.code, roomTeams, room.season.fixtures);
  room.season.currentMatch = room.season.fixtures.findIndex(
    fixture => fixture.status !== "complete",
  );
  return true;
}

function startSeasonWhenAuctionIsReady(room: Room) {
  const auction = room.auction;
  if (!auction || auction.cursor < auction.playerIds.length) return false;
  // Keep the final sold/set summary visible before moving every connected manager on.
  if ((auction.nextLotAt ?? 0) > Date.now()) return false;
  room.season ??= createSeason(room.code);
  room.stage = "season";
  return true;
}

function bidIncrement(amount: number) {
  return amount >= 10 ? 1 : 0.5;
}
function playerBasePrice(player: AiPlayer) {
  const quality = Math.max(player.batting, player.bowling);
  return player.baseSalary ?? (quality >= 85 ? 2 : quality >= 75 ? 1.5 : 0.5);
}
function teamAuctionSquad(room: Room, team: string) {
  const retained =
    room.retentions
      ?.find((item) => item.team === team)
      ?.decision?.picks.map((pick) => getAuctionPlayer(pick.player.id) ?? pick.player) ?? [];
  const bought =
    room.auction?.purchases
      .filter((item) => item.team === team)
      .map((item) => getAuctionPlayer(item.playerId))
      .filter((player): player is AiPlayer => player !== null) ?? [];
  return [...retained, ...bought];
}
export function buildTestSeasonSquads(room: Room): AuctionPurchase[] {
  const alreadyAssigned = new Set(
    roomTeams.flatMap(team => teamAuctionSquad(room, team).map(player => player.id)),
  );
  const additions: AuctionPurchase[] = [];
  for (const team of roomTeams) {
    const squad = [...teamAuctionSquad(room, team)];
    const homeIds = new Set(getTeamRoster(team).map(player => player.id));
    if (squad.length > 25 || squad.filter(player => player.overseas).length > 8)
      throw new Error("TEST_SQUAD_UNAVAILABLE");
    const available = () => SHEET_PLAYERS
      .filter(player => !alreadyAssigned.has(player.id) &&
        (!player.overseas || squad.filter(member => member.overseas).length < 8))
      .sort((a, b) => {
        const quality = (player: AiPlayer) =>
          player.role === "BAT" || player.role === "WK" ? player.batting :
          player.role === "AR" ? (player.batting + player.bowling) / 2 : player.bowling;
        const score = (player: AiPlayer) =>
          quality(player) + player.form * .08 + player.confidence * .05;
        const priority = (player: AiPlayer) =>
          homeIds.has(player.id) ? 2 : player.team === "FREE_AGENT" ? 1 : 0;
        return priority(b) - priority(a) || score(b) - score(a) || a.id - b.id;
      });
    const add = (predicate: (player: AiPlayer) => boolean, target: number) => {
      while (squad.length < 22 && squad.filter(predicate).length < target) {
        const player = available().find(predicate);
        if (!player) throw new Error("TEST_SQUAD_UNAVAILABLE");
        squad.push(player);
        alreadyAssigned.add(player.id);
        additions.push({ playerId: player.id, team, price: 0 });
      }
    };
    add(isOpener, 2);
    for (const role of ["WK", "BAT", "AR", "PACE", "SPIN"] as const)
      add(player => player.role === role, SQUAD_MINIMUMS[role]);
    while (squad.length < 22) {
      const player = available()[0];
      if (!player) throw new Error("TEST_SQUAD_UNAVAILABLE");
      squad.push(player);
      alreadyAssigned.add(player.id);
      additions.push({ playerId: player.id, team, price: 0 });
    }
    if (squadBalanceViolations(squad).length)
      throw new Error("TEST_SQUAD_UNAVAILABLE");
  }
  return additions;
}
function teamAuctionPurse(room: Room, team: string) {
  const starting =
    room.retentions?.find((item) => item.team === team)?.decision
      ?.auctionPurse ?? 120;
  const spent =
    room.auction?.purchases
      .filter((item) => item.team === team)
      .reduce((sum, item) => sum + item.price, 0) ?? 0;
  return Math.round((starting - spent) * 100) / 100;
}
function scheduleAiBid(room: Room) {
  const auction = ensureAuction(room);
  const playerId = auction.playerIds[auction.cursor];
  if (playerId == null) return;
  if (
    auction.paused ||
    auction.pendingAiBid ||
    (auction.nextLotAt ?? 0) > Date.now()
  )
    return;
  const player = getAuctionPlayer(playerId);
  if (!player) return;
  const base = playerBasePrice(player);
  const current = auction.currentBid ?? base - bidIncrement(base);
  const difficulty = (
    room.difficulty === "Expert" || room.difficulty === "Balanced"
      ? room.difficulty
      : "Competitive"
  ) as AiDifficulty;
  const candidates = (room.retentions ?? [])
    .filter((team) => team.ai && team.team !== auction.currentTeam)
    .map((team) => ({
      team,
      decision: decideAuctionBid(
        player,
        {
          budget: teamAuctionPurse(room, team.team),
          currentBid: current,
          increment: bidIncrement(current),
          squad: teamAuctionSquad(room, team.team),
          squadLimit: 25,
          overseasLimit: 8,
          seed: `${room.code}:${team.team}:auction`,
        },
        difficulty,
      ),
    }))
    .filter((item) => item.decision.bid)
    .sort(
      (a, b) =>
        b.decision.maxBid - a.decision.maxBid ||
        a.team.team.localeCompare(b.team.team),
    );
  if (!candidates.length) return;
  const bidder = candidates[0];
  const amount = Math.round((current + bidIncrement(current)) * 100) / 100;
  const delay =
    1800 +
    ((player.id * 31 +
      bidder.team.team.charCodeAt(0) * 17 +
      Math.round(amount * 10)) %
      1700);
  auction.pendingAiBid = {
    team: bidder.team.team,
    amount,
    executeAt: Date.now() + delay,
  };
}
function processAuctionTick(room: Room) {
  const auction = ensureAuction(room);
  const pending = auction.pendingAiBid;
  if (pending && pending.executeAt <= Date.now()) {
    auction.currentBid = pending.amount;
    auction.currentTeam = pending.team;
    auction.currentManager = teamRepresentative(pending.team);
    auction.pendingAiBid = null;
  }
  scheduleAiBid(room);
}

export function getAiAuctionInterest(room: Room, teamCode: string) {
  const team = room.retentions?.find((item) => item.team === teamCode);
  const auction = room.auction;
  if (!team?.ai || !auction) return null;
  if (
    auction.currentTeam === teamCode ||
    auction.pendingAiBid?.team === teamCode
  )
    return true;
  const playerId = auction.playerIds[auction.cursor];
  const player = getAuctionPlayer(playerId);
  if (!player) return false;
  const base = playerBasePrice(player);
  const current = auction.currentBid ?? base - bidIncrement(base);
  const difficulty = (
    room.difficulty === "Expert" || room.difficulty === "Balanced"
      ? room.difficulty
      : "Competitive"
  ) as AiDifficulty;
  return decideAuctionBid(
    player,
    {
      budget: teamAuctionPurse(room, teamCode),
      currentBid: current,
      increment: bidIncrement(current),
      squad: teamAuctionSquad(room, teamCode),
      squadLimit: 25,
      overseasLimit: 8,
      seed: `${room.code}:${teamCode}:auction`,
    },
    difficulty,
  ).bid;
}

function bestAiPurchase(room: Room, player: AiPlayer) {
  const base = playerBasePrice(player);
  const difficulty = (
    room.difficulty === "Expert" || room.difficulty === "Balanced"
      ? room.difficulty
      : "Competitive"
  ) as AiDifficulty;
  const candidates = (room.retentions ?? [])
    .filter((team) => team.ai)
    .map((team) => ({
      team,
      decision: decideAuctionBid(
        player,
        {
          budget: teamAuctionPurse(room, team.team),
          currentBid: base - bidIncrement(base),
          increment: bidIncrement(base),
          squad: teamAuctionSquad(room, team.team),
          squadLimit: 25,
          overseasLimit: 8,
          seed: `${room.code}:${team.team}:auction`,
        },
        difficulty,
      ),
    }))
    .filter((item) => item.decision.bid)
    .sort((a, b) => b.decision.maxBid - a.decision.maxBid);
  if (!candidates.length) return null;
  const winner = candidates[0];
  const second = candidates[1]?.decision.maxBid ?? base;
  const priceVariation =
    (-0.5 + seededUnit(`${room.code}:quick-sale:${player.id}`) * 2) *
    Math.max(0.25, Math.min(1, (second || base) / 11.5));
  const competitivePrice =
    Math.ceil((second + bidIncrement(second) + priceVariation) * 2) / 2;
  const price = Math.max(
    base,
    Math.min(winner.decision.maxBid, competitivePrice),
  );
  return { team: winner.team.team, price: Math.floor(price * 2) / 2 };
}

export async function getAuctionRoom(code: string) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || room.stage !== "auction") return null;
  const previousAuction = JSON.stringify(room.auction);
  const auction = ensureAuction(room);
  if (!auction.paused) processAuctionTick(room);
  const seasonStarted = startSeasonWhenAuctionIsReady(room);
  if (seasonStarted || JSON.stringify(room.auction) !== previousAuction) {
    await writeDatabase(database);
  }
  return room;
}

export async function updateAuction(
  code: string,
  name: string,
  action:
    | "bid"
    | "sell"
    | "interest"
    | "quickSellAi"
    | "skipSet"
    | "skipAuctionForTesting"
    | "pause"
    | "startSeason",
  interested?: boolean,
) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || room.stage !== "auction") throw new Error("ROOM_NOT_FOUND");
  const auction = ensureAuction(room);
  const manager = room.players.find((item) => item.name === name);
  if (!manager) throw new Error("PLAYER_NOT_FOUND");
  if (action === "startSeason") {
    if (!manager.host || room.host !== name) throw new Error("HOST_ONLY");
    if (auction.cursor < auction.playerIds.length)
      throw new Error("AUCTION_NOT_COMPLETE");
    room.season = createSeason(room.code);
    room.stage = "season";
    await writeDatabase(database);
    return room;
  }
  if (action === "skipAuctionForTesting") {
    if (!manager.host || room.host !== name) throw new Error("HOST_ONLY");
    const additions = buildTestSeasonSquads(room);
    auction.purchases.push(...additions);
    auction.cursor = auction.playerIds.length;
    auction.pendingAiBid = null;
    auction.nextLotAt = 0;
    room.season = createSeason(room.code, manager.team);
    room.testSeason = true;
    room.stage = "season";
    await writeDatabase(database);
    return room;
  }
  if (action === "pause") {
    if (!manager.host || room.host !== name) throw new Error("HOST_ONLY");
    auction.paused = !auction.paused;
    auction.pendingAiBid = null;
    if (!auction.paused) scheduleAiBid(room);
    await writeDatabase(database);
    return room;
  }
  if (auction.paused) throw new Error("AUCTION_PAUSED");
  const playerId = auction.playerIds[auction.cursor];
  if (playerId == null) throw new Error("AUCTION_COMPLETE");
  if (action === "skipSet") {
    if (!manager.host || room.host !== name) throw new Error("HOST_ONLY");
    const currentSet = auctionOrder.sets.find((set) =>
      set.playerIds.includes(playerId),
    );
    if (!currentSet) throw new Error("SET_NOT_FOUND");
    const remainingIds = auction.playerIds
      .slice(auction.cursor)
      .filter((id) => currentSet.playerIds.includes(id));
    if (!remainingIds.length) throw new Error("SET_NOT_FOUND");
    const processedAt = Date.now();
    const setSales: AuctionSale[] = [];
    for (const id of remainingIds) {
      const player = getAuctionPlayer(id);
      if (!player) continue;
      const purchase = bestAiPurchase(room, player);
      const sale: AuctionSale = purchase
        ? {
            playerId: id,
            team: purchase.team,
            price: purchase.price,
            unsold: false,
            soldAt: processedAt,
          }
        : {
            playerId: id,
            team: null,
            price: null,
            unsold: true,
            soldAt: processedAt,
          };
      if (purchase) auction.purchases.push({ playerId: id, ...purchase });
      else auction.unsoldPlayerIds.push(id);
      auction.lastSale = sale;
      auction.saleHistory = [...(auction.saleHistory ?? []), sale];
      setSales.push(sale);
    }
    auction.lastSetResult = {
      setName: currentSet.name,
      processedAt,
      sales: setSales,
    };
    auction.cursor += remainingIds.length;
    auction.nextLotAt = Date.now() + 6000;
    auction.currentBid = null;
    auction.currentTeam = null;
    auction.currentManager = null;
    auction.pendingAiBid = null;
    auction.interestByTeam = {};
    scheduleAiBid(room);
  } else if (action === "quickSellAi") {
    if (!manager.host || room.host !== name) throw new Error("HOST_ONLY");
    const humanTeams = (room.retentions ?? []).filter((team) => !team.ai);
    if (
      !humanTeams.length ||
      !humanTeams.every((team) => auction.interestByTeam?.[team.team] === false)
    )
      throw new Error("HUMANS_STILL_INTERESTED");
    const player = getAuctionPlayer(playerId);
    if (!player) throw new Error("PLAYER_NOT_FOUND");
    const purchase = bestAiPurchase(room, player);
    if (!purchase) throw new Error("NO_AI_INTEREST");
    auction.purchases.push({ playerId, ...purchase });
    auction.lastSale = {
      playerId,
      team: purchase.team,
      price: purchase.price,
      unsold: false,
      soldAt: Date.now(),
    };
    auction.saleHistory = [...(auction.saleHistory ?? []), auction.lastSale!];
    auction.nextLotAt = Date.now() + 2500;
    auction.cursor++;
    auction.currentBid = null;
    auction.currentTeam = null;
    auction.currentManager = null;
    auction.pendingAiBid = null;
    auction.interestByTeam = {};
    scheduleAiBid(room);
  } else if (action === "interest") {
    auction.interestByTeam = {
      ...(auction.interestByTeam ?? {}),
      [manager.team]: Boolean(interested),
    };
  } else if (action === "bid") {
    const retention = room.retentions?.find(
      (team) => team.team === manager.team,
    );
    const spent = auction.purchases
      .filter((item) => item.team === manager.team)
      .reduce((sum, item) => sum + item.price, 0);
    const purse = (retention?.decision?.auctionPurse ?? 120) - spent;
    const currentPlayer = getAuctionPlayer(playerId);
    const base = currentPlayer ? playerBasePrice(currentPlayer) : 0.5;
    const next =
      auction.currentBid == null
        ? base
        : Math.round(
            (auction.currentBid + (auction.currentBid >= 10 ? 1 : 0.5)) * 100,
          ) / 100;
    if (auction.currentTeam === manager.team)
      throw new Error("ALREADY_LEADING");
    if (next > purse) throw new Error("INSUFFICIENT_PURSE");
    auction.interestByTeam = {
      ...(auction.interestByTeam ?? {}),
      [manager.team]: true,
    };
    auction.pendingAiBid = null;
    auction.currentBid = next;
    auction.currentTeam = manager.team;
    auction.currentManager = name;
    scheduleAiBid(room);
  } else {
    if (!manager.host || room.host !== name) throw new Error("HOST_ONLY");
    // A scheduled AI bid has not appeared on screen yet; do not discard it on sale.
    if (!auction.currentTeam && auction.pendingAiBid) {
      const pending = auction.pendingAiBid;
      auction.currentBid = pending.amount;
      auction.currentTeam = pending.team;
      auction.currentManager = teamRepresentative(pending.team);
      auction.pendingAiBid = null;
    }
    if (auction.currentTeam && auction.currentBid != null) {
      auction.purchases.push({
        playerId,
        team: auction.currentTeam,
        price: auction.currentBid,
      });
      auction.lastSale = {
        playerId,
        team: auction.currentTeam,
        price: auction.currentBid,
        unsold: false,
        soldAt: Date.now(),
      };
    } else {
      auction.unsoldPlayerIds.push(playerId);
      auction.lastSale = {
        playerId,
        team: null,
        price: null,
        unsold: true,
        soldAt: Date.now(),
      };
    }
    auction.saleHistory = [...(auction.saleHistory ?? []), auction.lastSale!];
    auction.nextLotAt = Date.now() + 2500;
    auction.cursor++;
    auction.currentBid = null;
    auction.currentTeam = null;
    auction.currentManager = null;
    auction.pendingAiBid = null;
    auction.interestByTeam = {};
    scheduleAiBid(room);
  }
  await writeDatabase(database);
  return room;
}

export async function getSeasonRoom(code: string) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (room && ensureSeasonSchedule(room)) await writeDatabase(database);
  return room?.stage === "season" && room.season ? room : null;
}

function isAiTeam(room: Room, team: string) {
  return room.retentions?.find((item) => item.team === team)?.ai ?? true;
}
function automaticPitch(code: string, matchId: number): PitchType {
  const values: PitchType[] = ["Flat", "Slow", "Dry", "Green", "Bouncy"];
  return values[fixtureSeed(code, "pitch", "surface", matchId) % values.length];
}
function automaticLineup(room: Room, team: string, pitch: PitchType) {
  const difficulty = (
    room.difficulty === "Expert" || room.difficulty === "Balanced"
      ? room.difficulty
      : "Competitive"
  ) as AiDifficulty;
  return selectLineup(teamAuctionSquad(room, team), pitch, difficulty)
    .battingOrder;
}
function openingBowler(room: Room, team: string, ids: number[]) {
  const squad = teamAuctionSquad(room, team);
  return ids.map(id => squad.find(player => player.id === id))
    .filter((player): player is AiPlayer => !!player && (player.role === "PACE" || player.role === "SPIN" || player.role === "AR"))
    .sort((a, b) => (b.bowling - (isPowerplaySpinRisk(b) ? 30 : 0)) - (a.bowling - (isPowerplaySpinRisk(a) ? 30 : 0)))[0]?.id ?? ids[0];
}
function liveSnapshotToInnings(
  room: Room,
  bowlingTeam: string,
  snapshot: {
    team: string;
    runs: number;
    wickets: number;
    balls: number;
    batters: LiveMatch["batters"];
    bowlers: LiveMatch["bowlers"];
    fallOfWickets?: string[];
  },
): SimInnings {
  const battingSquad = teamAuctionSquad(room, snapshot.team);
  const bowlingSquad = teamAuctionSquad(room, bowlingTeam);
  return {
    team: snapshot.team,
    runs: snapshot.runs,
    wickets: Math.min(10, snapshot.wickets),
    overs: `${Math.floor(snapshot.balls / 6)}.${snapshot.balls % 6}`,
    batting: Object.entries(snapshot.batters)
      .filter(([, stat]) => stat.balls > 0 || stat.out)
      .map(([id, stat]) => {
        const player = battingSquad.find((item) => item.id === Number(id));
        return {
          playerId: Number(id),
          name: player?.name ?? "Player",
          runs: stat.runs,
          balls: stat.balls,
          fours: stat.fours,
          sixes: stat.sixes,
          dismissal: stat.dismissal ?? (stat.out ? "out" : "not out"),
          strikeRate: stat.balls
            ? Math.round((stat.runs / stat.balls) * 10000) / 100
            : 0,
        };
      }),
    bowling: Object.entries(snapshot.bowlers).map(([id, stat]) => {
      const player = bowlingSquad.find((item) => item.id === Number(id));
      return {
        playerId: Number(id),
        name: player?.name ?? "Bowler",
        balls: stat.balls,
        runs: stat.runs,
        wickets: stat.wickets,
        economy: stat.balls
          ? Math.round((stat.runs / (stat.balls / 6)) * 100) / 100
          : 0,
      };
    }),
    fallOfWickets: snapshot.fallOfWickets ?? [],
  };
}
function ensureMatchSetup(room: Room, fixture: SeasonFixture) {
  if (fixture.result) return false;
  let changed = false;
  if (!fixture.setup) {
    fixture.setup = { stage: "pitch", lineups: {} };
    changed = true;
  }
  const setup = fixture.setup;
  if (!setup.pitch && isAiTeam(room, fixture.home)) {
    setup.pitch = automaticPitch(room.code, fixture.id);
    setup.stage = "lineup";
    changed = true;
  }
  if (setup.pitch) {
    for (const team of [fixture.home, fixture.away])
      if (isAiTeam(room, team) && !setup.started) {
        const ordered = automaticLineup(room, team, setup.pitch);
        if (setup.lineups[team]?.join(",") === ordered.join(",")) continue;
        setup.lineups[team] = ordered;
        changed = true;
      }
    if (setup.stage === "pitch") setup.stage = "lineup";
  }
  if (
    setup.pitch &&
    setup.lineups[fixture.home]?.length === 11 &&
    setup.lineups[fixture.away]?.length === 11 &&
    setup.stage === "lineup"
  ) {
    setup.stage = "toss";
    changed = true;
  }
  if (
    setup.stage === "toss" &&
    !setup.tossWinner &&
    isAiTeam(room, fixture.away)
  ) {
    setup.coinCall =
      fixtureSeed(room.code, fixture.away, "call", fixture.id) % 2
        ? "heads"
        : "tails";
    setup.coinResult =
      fixtureSeed(room.code, fixture.home, fixture.away, fixture.id) % 2
        ? "heads"
        : "tails";
    setup.tossWinner =
      setup.coinCall === setup.coinResult ? fixture.away : fixture.home;
    changed = true;
    if (isAiTeam(room, setup.tossWinner)) {
      setup.tossDecision =
        fixtureSeed(room.code, setup.tossWinner, "decision", fixture.id) % 2 ===
        0
          ? "bat"
          : "bowl";
      setup.battingFirst =
        setup.tossDecision === "bat"
          ? setup.tossWinner
          : setup.tossWinner === fixture.home
            ? fixture.away
            : fixture.home;
      setup.stage = "live";
      setup.pace = "over";
      fixture.status = "live";
    }
  }
  if (
    setup.stage === "live" &&
    setup.started &&
    !setup.live &&
    setup.battingFirst
  ) {
    const bat = setup.battingFirst,
      bowl = bat === fixture.home ? fixture.away : fixture.home,
      batIds = setup.lineups[bat] ?? [],
      bowlIds = setup.lineups[bowl] ?? [];
    setup.live = {
      innings: 1,
      battingTeam: bat,
      bowlingTeam: bowl,
      runs: 0,
      wickets: 0,
      balls: 0,
      striker: 0,
      nonStriker: 1,
      next: 2,
      bowler: openingBowler(room, bowl, bowlIds),
      batters: Object.fromEntries(
        batIds.map((id) => [
          id,
          { runs: 0, balls: 0, fours: 0, sixes: 0, out: false },
        ]),
      ),
      bowlers: {},
      recent: [],
      matchupBalls: {},
      commentary: "The opening batters take guard. The match begins.",
    };
    changed = true;
  }
  if (setup.live && setup.live.wickets > 10) {
    setup.live.wickets = 10;
    setup.live.completed = true;
    changed = true;
  }
  return changed;
}
export async function getSeasonMatchRoom(code: string, matchId: number) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || room.stage !== "season" || !room.season) return null;
  const scheduleChanged = ensureSeasonSchedule(room);
  const fixture = room.season.fixtures.find((item) => item.id === matchId);
  if (!fixture) return null;
  if (ensureMatchSetup(room, fixture) || scheduleChanged) await writeDatabase(database);
  return room;
}
export async function updateMatchPreparation(
  code: string,
  matchId: number,
  name: string,
  action:
    | "pitch"
    | "lineup"
    | "toss"
    | "decision"
    | "pace"
    | "start"
    | "advance"
    | "nextBatter"
    | "batterApproach"
    | "tactics",
  payload: {
    pitch?: PitchType;
    playerIds?: number[];
    decision?: "bat" | "bowl";
    pace?: "ball" | "over";
    coinCall?: "heads" | "tails";
    battingApproach?: TeamTactics["battingApproach"];
    batterId?: number;
    batterApproach?: TeamTactics["battingApproach"];
    bowlingApproach?: TeamTactics["bowlingApproach"];
    field?: TeamTactics["field"];
    nextBatter?: number;
    nextBowler?: number;
    expectedInnings?: number;
    expectedBalls?: number;
  },
) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || room.stage !== "season" || !room.season)
    throw new Error("SEASON_NOT_FOUND");
  ensureSeasonSchedule(room);
  const fixture = room.season.fixtures.find((item) => item.id === matchId);
  if (!fixture) throw new Error("MATCH_NOT_FOUND");
  ensureMatchSetup(room, fixture);
  const setup = fixture.setup!;
  const manager = room.players.find((player) => player.name === name);
  const participant =
    manager && (manager.team === fixture.home || manager.team === fixture.away);
  if (!participant && !manager?.host) throw new Error("NOT_PARTICIPANT");
  if (action === "pitch") {
    if (manager?.team !== fixture.home || isAiTeam(room, fixture.home))
      throw new Error("HOME_ONLY");
    if (setup.stage !== "pitch") throw new Error("WRONG_STAGE");
    const pitches: PitchType[] = ["Flat", "Slow", "Dry", "Green", "Bouncy"];
    if (!payload.pitch || !pitches.includes(payload.pitch))
      throw new Error("INVALID_PITCH");
    setup.pitch = payload.pitch;
    setup.stage = "lineup";
    for (const team of [fixture.home, fixture.away])
      if (isAiTeam(room, team))
        setup.lineups[team] = automaticLineup(room, team, setup.pitch);
  } else if (action === "lineup") {
    if (!participant || !setup.pitch || setup.stage !== "lineup")
      throw new Error("WRONG_STAGE");
    const ids = payload.playerIds ?? [],
      squad = teamAuctionSquad(room, manager!.team);
    if (
      ids.length !== 11 ||
      new Set(ids).size !== 11 ||
      ids.some((id) => !squad.some((player) => player.id === id))
    )
      throw new Error("INVALID_LINEUP");
    const selected = ids.map((id) => squad.find((player) => player.id === id)!);
    if (
      !selected.some(
        (player) => player.role === "WK" || (player.keeping ?? 0) >= 60,
      ) ||
      selected.filter(
        (player) =>
          player.role === "PACE" ||
          player.role === "SPIN" ||
          player.role === "AR",
      ).length < 4
    )
      throw new Error("UNBALANCED_LINEUP");
    setup.lineups[manager!.team] = ids;
  } else if (action === "toss") {
    if (
      setup.stage !== "toss" ||
      !setup.lineups[fixture.home] ||
      !setup.lineups[fixture.away]
    )
      throw new Error("WRONG_STAGE");
    if (setup.tossWinner) throw new Error("TOSS_DONE");
    if (manager?.team !== fixture.away || isAiTeam(room, fixture.away))
      throw new Error("AWAY_CALL_ONLY");
    if (payload.coinCall !== "heads" && payload.coinCall !== "tails")
      throw new Error("INVALID_COIN_CALL");
    setup.coinCall = payload.coinCall;
    setup.coinResult =
      fixtureSeed(room.code, fixture.home, fixture.away, fixture.id) % 2
        ? "heads"
        : "tails";
    setup.tossWinner =
      setup.coinCall === setup.coinResult ? fixture.away : fixture.home;
    if (isAiTeam(room, setup.tossWinner)) {
      setup.tossDecision =
        fixtureSeed(room.code, setup.tossWinner, "decision", fixture.id) % 2 ===
        0
          ? "bat"
          : "bowl";
      setup.battingFirst =
        setup.tossDecision === "bat"
          ? setup.tossWinner
          : setup.tossWinner === fixture.home
            ? fixture.away
            : fixture.home;
      setup.stage = "live";
      setup.pace = "over";
      fixture.status = "live";
    }
  } else if (action === "decision") {
    if (
      setup.stage !== "toss" ||
      setup.tossWinner !== manager?.team ||
      !payload.decision
    )
      throw new Error("TOSS_WINNER_ONLY");
    setup.tossDecision = payload.decision;
    setup.battingFirst =
      payload.decision === "bat"
        ? setup.tossWinner
        : setup.tossWinner === fixture.home
          ? fixture.away
          : fixture.home;
    setup.stage = "live";
    setup.pace = "ball";
    fixture.status = "live";
  } else if (action === "pace") {
    if (setup.stage !== "live" || !payload.pace) throw new Error("WRONG_STAGE");
    setup.pace = payload.pace;
  } else if (action === "start") {
    if (!participant || setup.stage !== "live")
      throw new Error("NOT_PARTICIPANT");
    setup.started = true;
    const bat = setup.battingFirst!,
      bowl = bat === fixture.home ? fixture.away : fixture.home,
      batIds = setup.lineups[bat],
      bowlIds = setup.lineups[bowl];
    setup.live = {
      innings: 1,
      battingTeam: bat,
      bowlingTeam: bowl,
      runs: 0,
      wickets: 0,
      balls: 0,
      striker: 0,
      nonStriker: 1,
      next: 2,
      bowler: openingBowler(room, bowl, bowlIds),
      batters: Object.fromEntries(
        batIds.map((id) => [
          id,
          { runs: 0, balls: 0, fours: 0, sixes: 0, out: false },
        ]),
      ),
      bowlers: {},
      recent: [],
      matchupBalls: {},
      commentary: "The players walk out. Match ready.",
    };
  } else if (action === "advance") {
    if (!setup.started || !setup.live || !participant)
      throw new Error("MATCH_NOT_STARTED");
    if (
      (payload.expectedInnings !== undefined &&
        payload.expectedInnings !== setup.live.innings) ||
      (payload.expectedBalls !== undefined &&
        payload.expectedBalls !== setup.live.balls)
    )
      throw new Error("MATCH_OUT_OF_SYNC");
    if (setup.live.completed || setup.live.awaitingBatter)
      throw new Error("MATCH_WAITING");
    const count = setup.pace === "over" ? 6 - (setup.live.balls % 6) : 1;
    for (let step = 0; step < count; step++) {
      const live: LiveMatch = setup.live!;
      const batIds: number[] = setup.lineups[live.battingTeam];
      const bowlIds: number[] = setup.lineups[live.bowlingTeam];
      if (
        live.batters[batIds[live.striker]]?.out ||
        live.batters[batIds[live.nonStriker]]?.out
      ) {
        live.awaitingBatter = true;
        live.commentary = "Choose the next batter.";
        break;
      }
      const batSquad = teamAuctionSquad(room, live.battingTeam);
      const bowlSquad = teamAuctionSquad(room, live.bowlingTeam);
      if (live.balls % 6 === 0) {
        const previousBowler = live.balls === 0 ? null : live.bowler;
        const preferred = setup.tactics?.[live.bowlingTeam]?.nextBowler;
        const eligible = bowlIds
          .filter((id) => {
            const player = bowlSquad.find((item) => item.id === id);
            return (
              (previousBowler === null || id !== previousBowler) &&
              (live.bowlers[id]?.balls ?? 0) < 24 &&
              player &&
              (player.role === "PACE" ||
                player.role === "SPIN" ||
                player.role === "AR")
            );
          })
          .sort(
            (a, b) =>
              (bowlSquad.find((item) => item.id === b)?.bowling ?? 0) -
              (bowlSquad.find((item) => item.id === a)?.bowling ?? 0),
          );
        const safePowerplay = live.balls < 36
          ? eligible.filter(id => {
              const player = bowlSquad.find(item => item.id === id);
              return player && !isPowerplaySpinRisk(player);
            })
          : [];
        const aiOptions = safePowerplay.length ? safePowerplay : eligible;
        if (
          live.balls > 0 &&
          !isAiTeam(room, live.bowlingTeam) &&
          (!preferred ||
            preferred === previousBowler ||
            !eligible.includes(preferred))
        )
          throw new Error("CHOOSE_NEXT_BOWLER");
        live.bowler =
          preferred && eligible.includes(preferred)
            ? preferred
            : live.balls === 0 && eligible.includes(live.bowler)
              ? live.bowler
              : (aiOptions[
                  Math.floor(live.balls / 6) % Math.max(1, aiOptions.length)
                ] ?? live.bowler);
      }
      const batterId = batIds[live.striker],
        batter = batSquad.find((x) => x.id === batterId)!,
        bowler = bowlSquad.find((x) => x.id === live.bowler)!,
        batStat = live.batters[batterId],
        bowlStat = (live.bowlers[live.bowler] ??= {
          balls: 0,
          runs: 0,
          wickets: 0,
        });
      live.bowlers[live.bowler] = bowlStat;
      const requiredRate = live.target
        ? (Math.max(0, live.target - live.runs) * 6) /
          Math.max(1, 120 - live.balls)
        : 0;
      const aiBatMode =
        isAiTeam(room, live.battingTeam) &&
        (requiredRate > 10 ||
          (Math.floor(live.balls / 6) >= 16 && live.wickets < 7))
          ? "Attack"
          : "Rotate";
      const batMode =
          setup.tactics?.[live.battingTeam]?.batterApproaches?.[batterId] ??
          setup.tactics?.[live.battingTeam]?.battingApproach ??
          aiBatMode,
        bowlMode =
          setup.tactics?.[live.bowlingTeam]?.bowlingApproach ?? "Balanced",
        fieldMode = setup.tactics?.[live.bowlingTeam]?.field ?? "Balanced";
      const model = liveDeliveryProbabilities({
        batter,
        bowler,
        pitch: setup.pitch!,
        over: Math.floor(live.balls / 6),
        ballsFaced: batStat.balls,
        runsScored: batStat.runs,
        fours: batStat.fours,
        sixes: batStat.sixes,
        inningsSeed: `${room.code}:${fixture.id}:${live.innings}`,
        ballsAgainstBowler: live.matchupBalls?.[`${batterId}:${live.bowler}`] ?? 0,
        battingPosition: live.striker + 1,
        ballsSinceWicket: live.recent.lastIndexOf("W") < 0
          ? 99
          : live.recent.length - 1 - live.recent.lastIndexOf("W"),
        battingApproach: batMode,
        bowlingApproach: bowlMode,
        field: fieldMode,
        fieldingRating:
          bowlSquad.reduce((sum, player) => sum + player.fielding, 0) /
          Math.max(1, bowlSquad.length),
        requiredRate: live.target ? requiredRate : undefined,
        wickets: live.wickets,
        bowlerRuns: bowlStat.runs,
      });
      const roll = seededUnit(
        `${room.code}:${fixture.id}:${live.innings}:${live.balls}:${live.runs}:${live.wickets}:${batter.id}:${bowler.id}`,
      );
      let cumulative = 0,
        outcome: "0" | "1" | "2" | "3" | "4" | "6" | "W" = "0";
      for (let index = 0; index < model.outcomes.length; index++) {
        cumulative += model.probabilities[index];
        if (roll <= cumulative) {
          outcome = model.outcomes[index];
          break;
        }
      }
      live.balls++;
      batStat.balls++;
      bowlStat.balls++;
      const matchupKey = `${batterId}:${live.bowler}`;
      live.matchupBalls ??= {};
      live.matchupBalls[matchupKey] = (live.matchupBalls[matchupKey] ?? 0) + 1;
      if (outcome === "W") {
        live.wickets++;
        batStat.out = true;
        const dismissalRoll = seededUnit(
          `${room.code}:${fixture.id}:${live.innings}:${live.balls}:${batterId}:dismissal`,
        );
        const fielders = bowlIds
          .filter((id) => id !== bowler.id)
          .map((id) => bowlSquad.find((player) => player.id === id))
          .filter((player): player is AiPlayer => Boolean(player));
        const catcher = fielders[Math.floor(dismissalRoll * fielders.length)]?.name ?? bowler.name;
        const keeper = fielders.find((player) => player.role === "WK")?.name ?? catcher;
        batStat.dismissal = dismissalRoll < 0.48
          ? `c ${catcher} b ${bowler.name}`
          : dismissalRoll < 0.68
            ? `b ${bowler.name}`
            : dismissalRoll < 0.84
              ? `lbw b ${bowler.name}`
              : dismissalRoll < 0.94
                ? `c ${keeper} b ${bowler.name}`
                : `run out (${catcher})`;
        if (dismissalRoll < 0.94) bowlStat.wickets++;
        live.fallOfWickets ??= [];
        live.fallOfWickets.push(
          `${live.runs}/${live.wickets} (${batter.name}, ${Math.floor(live.balls / 6)}.${live.balls % 6})`,
        );
        live.commentary = `${bowler.name} gets ${batter.name}!`;
        if (live.wickets < 10) {
          if (isAiTeam(room, live.battingTeam)) {
            const index = batIds.findIndex(
              (id, index) =>
                index !== live.striker &&
                index !== live.nonStriker &&
                !live.batters[id].out &&
                live.batters[id].balls === 0,
            );
            if (index >= 0) live.striker = index;
          } else live.awaitingBatter = true;
        }
      } else {
        const runs = Number(outcome);
        live.runs += runs;
        batStat.runs += runs;
        bowlStat.runs += runs;
        if (runs === 4) batStat.fours++;
        if (runs === 6) batStat.sixes++;
        live.commentary =
          runs === 0
            ? `${bowler.name} beats ${batter.name}.`
            : runs >= 4
              ? `${batter.name} finds the boundary!`
              : `${runs} run${runs === 1 ? "" : "s"}.`;
        if (runs % 2)
          [live.striker, live.nonStriker] = [live.nonStriker, live.striker];
      }
      live.recent = [...live.recent.slice(-11), outcome];
      if (live.balls % 6 === 0)
        [live.striker, live.nonStriker] = [live.nonStriker, live.striker];
      if (
        live.wickets >= 10 ||
        live.balls >= 120 ||
        (live.target && live.runs >= live.target)
      ) {
        if (live.innings === 1) {
          const firstScore = live.runs,
            firstInnings = {
              team: live.battingTeam,
              runs: live.runs,
              wickets: live.wickets,
              balls: live.balls,
              batters: live.batters,
              bowlers: live.bowlers,
              fallOfWickets: live.fallOfWickets,
            },
            second = live.bowlingTeam,
            secondBowl = live.battingTeam,
            ids = setup.lineups[second];
          setup.live = {
            innings: 2,
            battingTeam: second,
            bowlingTeam: secondBowl,
            runs: 0,
            wickets: 0,
            balls: 0,
            target: firstScore + 1,
            striker: 0,
            nonStriker: 1,
            next: 2,
            bowler: openingBowler(room, secondBowl, setup.lineups[secondBowl]),
            batters: Object.fromEntries(
              ids.map((id) => [
                id,
                { runs: 0, balls: 0, fours: 0, sixes: 0, out: false },
              ]),
            ),
            bowlers: {},
            recent: [],
            fallOfWickets: [],
            matchupBalls: {},
            commentary: `Target ${firstScore + 1}. The chase begins.`,
            firstInnings,
          };
        } else {
          live.wickets = Math.min(10, live.wickets);
          live.completed = true;
          live.commentary =
            live.runs >= (live.target ?? Infinity)
              ? `${live.battingTeam} complete the chase.`
              : `${live.bowlingTeam} win the match.`;
          const firstSnapshot = live.firstInnings!,
            secondSnapshot = {
              team: live.battingTeam,
              runs: live.runs,
              wickets: live.wickets,
              balls: live.balls,
              batters: live.batters,
              bowlers: live.bowlers,
              fallOfWickets: live.fallOfWickets,
            },
            first = liveSnapshotToInnings(
              room,
              live.battingTeam,
              firstSnapshot,
            ),
            second = liveSnapshotToInnings(
              room,
              live.bowlingTeam,
              secondSnapshot,
            ),
            chased = second.runs >= first.runs + 1,
            winner = chased ? second.team : first.team,
            summary = chased
              ? `${winner} won by ${10 - second.wickets} wickets`
              : `${winner} won by ${first.runs - second.runs} runs`;
          fixture.result = {
            pitch: setup.pitch!,
            venue: "DugoutX Stadium",
            first,
            second,
            winner,
            summary,
            playerOfMatch: playerOfMatchFromWinner(winner, first, second),
          };
          fixture.status = "complete";
          fixture.winner = winner;
          fixture.homeScore =
            (first.team === fixture.home ? first : second).runs +
            "/" +
            (first.team === fixture.home ? first : second).wickets;
          fixture.awayScore =
            (first.team === fixture.away ? first : second).runs +
            "/" +
            (first.team === fixture.away ? first : second).wickets;
          room.season.currentMatch = room.season.fixtures.findIndex(
            (item) => item.status === "upcoming",
          );
        }
        break;
      }
      if (live.awaitingBatter) break;
    }
  } else if (action === "nextBatter") {
    if (
      !setup.live?.awaitingBatter ||
      manager?.team !== setup.live.battingTeam ||
      !payload.batterId
    )
      throw new Error("INVALID_BATTER");
    const ids = setup.lineups[manager.team],
      index = ids.indexOf(payload.batterId);
    const live = setup.live;
    const vacant = live.batters[ids[live.striker]]?.out
      ? "striker"
      : live.batters[ids[live.nonStriker]]?.out
        ? "nonStriker"
        : null;
    if (
      !vacant ||
      index < 0 ||
      index === live.striker ||
      index === live.nonStriker ||
      live.batters[payload.batterId]?.out ||
      live.batters[payload.batterId]?.balls > 0
    )
      throw new Error("INVALID_BATTER");
    live[vacant] = index;
    live.awaitingBatter = false;
    live.commentary = `${teamAuctionSquad(room, manager.team).find((player) => player.id === payload.batterId)?.name} walks in to bat.`;
  } else if (action === "batterApproach") {
    if (
      setup.stage !== "live" ||
      !setup.started ||
      manager?.team !== setup.live?.battingTeam
    )
      throw new Error("NOT_PARTICIPANT");
    const xi = setup.lineups[manager.team] ?? [],
      allowed = ["Defend", "Rotate", "Attack"] as const;
    if (
      !payload.batterId ||
      !xi.includes(payload.batterId) ||
      !payload.batterApproach ||
      !allowed.includes(payload.batterApproach)
    )
      throw new Error("INVALID_TACTICS");
    const current = setup.tactics?.[manager.team] ?? {
      battingApproach: "Rotate",
      bowlingApproach: "Balanced",
      field: "Balanced",
    };
    setup.tactics = {
      ...(setup.tactics ?? {}),
      [manager.team]: {
        ...current,
        batterApproaches: {
          ...(current.batterApproaches ?? {}),
          [payload.batterId]: payload.batterApproach,
        },
      },
    };
  } else if (action === "tactics") {
    if (setup.stage !== "live" || !setup.started || !participant)
      throw new Error("MATCH_NOT_STARTED");
    const batting = ["Defend", "Rotate", "Attack"],
      bowling = ["Attack", "Balanced", "Contain"],
      fields = ["Attacking", "Balanced", "Defensive"];
    if (
      !payload.battingApproach ||
      !batting.includes(payload.battingApproach) ||
      !payload.bowlingApproach ||
      !bowling.includes(payload.bowlingApproach) ||
      !payload.field ||
      !fields.includes(payload.field)
    )
      throw new Error("INVALID_TACTICS");
    const xi = setup.lineups[manager!.team] ?? [];
    if (
      (payload.nextBatter && !xi.includes(payload.nextBatter)) ||
      (payload.nextBowler && !xi.includes(payload.nextBowler))
    )
      throw new Error("INVALID_TACTICS");
    setup.tactics = {
      ...(setup.tactics ?? {}),
      [manager!.team]: {
        ...(setup.tactics?.[manager!.team] ?? {}),
        battingApproach: payload.battingApproach,
        bowlingApproach: payload.bowlingApproach,
        field: payload.field,
        nextBatter: payload.nextBatter,
        nextBowler: payload.nextBowler,
      },
    };
  }
  ensureMatchSetup(room, fixture);
  await writeDatabase(database);
  return room;
}

export async function simulateSeasonMatch(
  code: string,
  matchId: number,
  name: string,
) {
  const database = await readDatabase();
  const room = database.rooms.find((item) => item.code === code.toUpperCase());
  if (!room || room.stage !== "season" || !room.season)
    throw new Error("SEASON_NOT_FOUND");
  if (
    room.host !== name ||
    !room.players.some((player) => player.name === name && player.host)
  )
    throw new Error("HOST_ONLY");
  ensureSeasonSchedule(room);
  const fixture = room.season.fixtures.find((item) => item.id === matchId);
  if (!fixture) throw new Error("MATCH_NOT_FOUND");
  if (fixture.status === "complete") return room;
  ensureMatchSetup(room, fixture);
  if (fixture.setup?.stage !== "live") throw new Error("MATCH_NOT_READY");
  const homeSquad = teamAuctionSquad(room, fixture.home).filter((player) =>
      fixture.setup!.lineups[fixture.home]?.includes(player.id),
    ),
    awaySquad = teamAuctionSquad(room, fixture.away).filter((player) =>
      fixture.setup!.lineups[fixture.away]?.includes(player.id),
    );
  const difficulty = (
    room.difficulty === "Expert" || room.difficulty === "Balanced"
      ? room.difficulty
      : "Competitive"
  ) as AiDifficulty;
  const result = simulateT20Match({
    code: room.code,
    fixtureId: fixture.id,
    home: fixture.home,
    away: fixture.away,
    homeSquad,
    awaySquad,
    difficulty,
    pitch: fixture.setup.pitch,
    battingFirst: fixture.setup.battingFirst,
  });
  const { first, second, winner } = result;
  fixture.result = result;
  fixture.status = "complete";
  fixture.winner = winner;
  fixture.homeScore =
    (first.team === fixture.home ? first : second).runs +
    "/" +
    (first.team === fixture.home ? first : second).wickets;
  fixture.awayScore =
    (first.team === fixture.away ? first : second).runs +
    "/" +
    (first.team === fixture.away ? first : second).wickets;
  room.season.currentMatch = room.season.fixtures.findIndex(
    (item) => item.status === "upcoming",
  );
  await writeDatabase(database);
  return room;
}
