import type { SeasonFixture } from "./local-db";

function randomUnit(seed: string) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function shuffle<T>(values: T[], seed: string): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = Math.floor(randomUnit(`${seed}:${index}`) * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

type Pairing = Pick<SeasonFixture, "home" | "away">;
const sharesTeam = (left: Pairing, right: Pairing) =>
  left.home === right.home || left.home === right.away ||
  left.away === right.home || left.away === right.away;
const pairKey = (pair: Pairing) => `${pair.home}:${pair.away}`;

function finishWithoutBackToBack(prior: Pairing | undefined, games: Pairing[]): Pairing[] | null {
  if (!games.length) return [];
  for (const game of games) {
    if (prior && sharesTeam(prior, game)) continue;
    const tail = finishWithoutBackToBack(game, games.filter(candidate => candidate !== game));
    if (tail) return [game, ...tail];
  }
  return null;
}

export function createSeasonFixtures(code: string, teams: string[], firstTeam?: string): SeasonFixture[] {
  if (teams.length !== 10 || new Set(teams).size !== 10)
    throw new Error("A season needs ten distinct teams.");
  let ring = shuffle(teams, `${code}:teams`);
  const firstLeg: Pairing[][] = [];
  for (let round = 0; round < 9; round++) {
    const games: Pairing[] = [];
    for (let index = 0; index < 5; index++) {
      const a = ring[index], b = ring[9 - index];
      games.push((round + index) % 2 ? { home: b, away: a } : { home: a, away: b });
    }
    firstLeg.push(games);
    ring = [ring[0], ring[9], ...ring.slice(1, 9)];
  }
  const roundOrder = shuffle(firstLeg, `${code}:rounds`);
  const rounds = [
    ...roundOrder,
    ...roundOrder.map(round => round.map(({ home, away }) => ({ home: away, away: home }))),
  ];
  const ordered: Pairing[] = [];
  rounds.forEach((round, index) => {
    const games = shuffle(round, `${code}:round:${index}`);
    if (index === 0 && firstTeam) {
      const firstMatch = games.findIndex(game => game.home === firstTeam || game.away === firstTeam);
      if (firstMatch > 0)
        [games[0], games[firstMatch]] = [games[firstMatch], games[0]];
    }
    if (ordered.length) {
      const firstCompatible = games.findIndex(game => !sharesTeam(ordered[ordered.length - 1], game));
      if (firstCompatible > 0)
        [games[0], games[firstCompatible]] = [games[firstCompatible], games[0]];
    }
    ordered.push(...games);
  });
  return ordered.map((game, index) => ({
    ...game,
    id: index + 1,
    round: Math.floor(index / 5) + 1,
    status: "upcoming",
  }));
}

// Keep played and live fixtures intact, then rebuild only the remaining calendar.
export function upgradeSeasonFixtures(
  code: string,
  teams: string[],
  fixtures: SeasonFixture[],
): SeasonFixture[] {
  if (fixtures.length !== 70 || teams.length !== 10) return fixtures;
  const protectedThrough = fixtures.reduce(
    (last, fixture, index) => fixture.status !== "upcoming" ? index : last,
    -1,
  );
  const prefix = fixtures.slice(0, protectedThrough + 1);
  const used = new Set(prefix.map(pairKey));
  const desired = createSeasonFixtures(code, teams)
    .filter(pair => !used.has(pairKey(pair)));
  const previous = new Map(fixtures.slice(protectedThrough + 1).map(fixture => [pairKey(fixture), fixture]));
  for (let attempt = 0; attempt < 64; attempt++) {
    const remaining = [...desired];
    const lastPlayed = new Map(teams.map(team => [team, -100]));
    prefix.forEach((fixture, index) => {
      lastPlayed.set(fixture.home, index);
      lastPlayed.set(fixture.away, index);
    });
    const ordered = [...prefix];
    let failed = false;
    while (remaining.length) {
      const prior = ordered[ordered.length - 1];
      if (remaining.length <= 10) {
        const tail = finishWithoutBackToBack(prior, remaining);
        if (!tail) { failed = true; break; }
        for (const chosen of tail) {
          const slot = ordered.length;
          ordered.push({
            ...previous.get(pairKey(chosen)),
            home: chosen.home,
            away: chosen.away,
            id: slot + 1,
            round: Math.floor(slot / 5) + 1,
            status: "upcoming",
          });
        }
        break;
      }
      const candidates = remaining.filter(game => !prior || !sharesTeam(prior, game));
      if (!candidates.length) { failed = true; break; }
      candidates.sort((a, b) => {
        const rest = (game: Pairing) =>
          (ordered.length - lastPlayed.get(game.home)!) +
          (ordered.length - lastPlayed.get(game.away)!);
        const score = (game: Pairing) =>
          rest(game) + randomUnit(`${code}:remaining:${attempt}:${ordered.length}:${pairKey(game)}`) * (attempt ? 12 : 0.01);
        return score(b) - score(a);
      });
      const chosen = candidates[0];
      remaining.splice(remaining.indexOf(chosen), 1);
      const slot = ordered.length;
      ordered.push({
        ...previous.get(pairKey(chosen)),
        home: chosen.home,
        away: chosen.away,
        id: slot + 1,
        round: Math.floor(slot / 5) + 1,
        status: "upcoming",
      });
      lastPlayed.set(chosen.home, slot);
      lastPlayed.set(chosen.away, slot);
    }
    if (!failed) return ordered;
  }
  throw new Error("Could not space the remaining fixtures.");
}
