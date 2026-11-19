import { AI_SHEET_RULES, getTeamRoster, SHEET_PLAYERS } from "@/lib/ai";

export async function GET(){const teams=["BLR","CHE","MUM","KOL","DEL","HYD","PUN","RAJ","LKN","GUJ"];return Response.json({players:SHEET_PLAYERS.length,teamRosters:Object.fromEntries(teams.map(team=>[team,getTeamRoster(team).length])),rules:Object.fromEntries(Object.entries(AI_SHEET_RULES).map(([name,value])=>[name,value.length]))},{headers:{"Cache-Control":"no-store"}});}
