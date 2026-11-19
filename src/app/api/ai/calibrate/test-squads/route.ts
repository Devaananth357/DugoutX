import { decideRetentions, getTeamRoster, selectLineup, SHEET_PLAYERS } from "@/lib/ai";
import { isOpener, squadBalanceViolations } from "@/lib/ai/squad-balance";
import { buildTestSeasonSquads, type Room } from "@/lib/local-db";

export async function GET() {
  const teams = ["BLR", "CHE", "MUM", "KOL", "DEL", "HYD", "PUN", "RAJ", "LKN", "GUJ"];
  const room: Room = {
    code: "TEST01", host: "Test manager", createdAt: "", team: "BLR",
    difficulty: "Competitive", fillWithAi: true, passwordHash: "",
    players: [{ name: "Test manager", team: "BLR", host: true }],
    stage: "auction",
    retentions: teams.map(team => {
      const roster = getTeamRoster(team);
      return { team, manager: null, ai: true, roster,
        decision: decideRetentions(roster, "Competitive", `test:${team}`) };
    }),
  };
  const additions = buildTestSeasonSquads(room);
  const playersById = new Map(SHEET_PLAYERS.map(player => [player.id, player]));
  return Response.json({
    totalAssigned: additions.length + (room.retentions?.reduce((sum, team) => sum + (team.decision?.picks.length ?? 0), 0) ?? 0),
    teams: teams.map(team => {
      const retained = room.retentions?.find(item => item.team === team)?.decision?.picks.map(pick => pick.player) ?? [];
      const squad = [...retained, ...additions.filter(purchase => purchase.team === team)
        .map(purchase => playersById.get(purchase.playerId)!)];
      const lineup = selectLineup(squad, "Flat", "Competitive");
      const byId = new Map(squad.map(player => [player.id, player]));
      return {
        team, size: squad.length, overseas: squad.filter(player => player.overseas).length,
        openers: squad.filter(isOpener).length, violations: squadBalanceViolations(squad),
        overseasEleven: lineup.playerIds.filter(id => byId.get(id)?.overseas).length,
        battingOrder: lineup.battingOrder.map(id => byId.get(id)?.name),
        bowlerOptions: lineup.playerIds.filter(id => {
          const role = byId.get(id)?.role;
          return role === "PACE" || role === "SPIN" || role === "AR";
        }).length,
        homePlayers: squad.filter(player => getTeamRoster(team).some(home => home.id === player.id)).length,
      };
    }),
  }, { headers: { "Cache-Control": "no-store" } });
}
