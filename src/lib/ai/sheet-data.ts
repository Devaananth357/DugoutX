import sheetData from "../../../data/ai/sheet-data.json";
import type { AiPlayer, PitchType, PlayerRole } from "./types";

type Row=Record<string,string|number|boolean|null>;
const tables=sheetData.tables as Record<string,Row[]>;
const rows=(name:string)=>tables[name]??[];
const byId=(name:string)=>new Map(rows(name).map(row=>[Number(row.player_id),row]));
const profiles=byId("rules.Players");
const forms=byId("rules.Player_Form");
const batters=byId("batters.Batting_Attributes");
const bowlers=byId("bowlers.Bowling_Attributes");
const weaknessRows=new Map<number,Row[]>();
for(const row of rows("rules.Batting_Weaknesses")){const id=Number(row.player_id);weaknessRows.set(id,[...(weaknessRows.get(id)??[]),row]);}

const aliases:Record<string,string>={BLR:"RCB",CHE:"CSK",MUM:"MI",KOL:"KKR",DEL:"DC",HYD:"SRH",PUN:"PBKS",RAJ:"RR",LKN:"LSG",GUJ:"GT"};
const num=(value:unknown,fallback=0)=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;};
function roleOf(master:Row,profile:Row,bowler:Row):PlayerRole{const role=String(master.role??profile.role??"");if(role==="WK"||role==="WICKET_KEEPER")return"WK";if(role==="BAT"||role==="BATSMAN")return"BAT";if(role==="AR"||role==="ALL_ROUNDER")return"AR";const style=String(profile.bowling_style??"").toUpperCase();return /SPIN|BREAK|ORTHODOX|WRIST/.test(style)||num(bowler.turn_rating)>num(bowler.seam_rating)+10?"SPIN":"PACE";}
function pitchRatings(batter:Row,bowler:Row,role:PlayerRole):Partial<Record<PitchType,number>>{const source=role==="PACE"||role==="SPIN"?bowler:batter;return{Flat:num(source.flat_pitch_rating,70),Green:num(source.green_pitch_rating,70),Dry:num(source.dry_pitch_rating,70),Bouncy:num(source.bouncy_pitch_rating,70),Slow:num(source.slow_pitch_rating,70)};}

export const SHEET_PLAYERS:AiPlayer[]=rows("playerMaster.Players").map(master=>{const id=num(master.player_id);const profile=profiles.get(id)??{};const form=forms.get(id)??{};const batter=batters.get(id)??{};const bowler=bowlers.get(id)??{};const role=roleOf(master,profile,bowler);const batting=num(master.batting_rating,num(profile.batting_rating,50));const bowling=num(master.bowling_rating,num(profile.bowling_rating,50));const battingForm=num(form.batting_form,batting);const bowlingForm=num(form.bowling_form,bowling);return{id,name:String(master.player_name??profile.name??`Player ${id}`),team:String(master.team??"FREE_AGENT"),role,nationality:String(master.nationality??profile.nationality??""),overseas:String(master.overseas).toLowerCase()==="yes",uncapped:String(master.capped_status).toLowerCase()==="uncapped",baseSalary:master.base_salary_cr==null?undefined:num(master.base_salary_cr),battingStyle:String(profile.batting_style??""),bowlingStyle:String(profile.bowling_style??""),consistencyType:String(profile.consistency_type??batter.ability_tier??"AVERAGE"),battingPosition:num(profile.batting_position,11),batting,bowling,fielding:Math.round((num(bowler.throw_accuracy_rating,65)+num(bowler.catching_efficiency,65)+num(bowler.ground_fielding_rating,65))/3),keeping:num(bowler.keeping_rating)||undefined,form:Math.round(role==="PACE"||role==="SPIN"?bowlingForm:role==="AR"?(battingForm+bowlingForm)/2:battingForm),confidence:num(form.confidence,70),fitness:Math.max(30,100-num(form.fatigue,10)),paceRating:num(batter.pace_rating,70),spinRating:num(batter.spin_rating,70),pitchRatings:pitchRatings(batter,bowler,role),weaknesses:(weaknessRows.get(id)??[]).map(row=>({type:String(row.weakness_type??""),bowlingStyle:String(row.bowling_style??"ANY"),pitch:String(row.pitch_type??"ANY"),phase:String(row.match_phase??"ANY"),severity:num(row.severity),activationAfterBalls:num(row.activation_after_balls,5),maximumWicketModifier:num(row.maximum_wicket_modifier,1)}))};});

export function getTeamRoster(team:string){const official=aliases[team]??team;return SHEET_PLAYERS.filter(player=>player.team===official);}
export const AI_SHEET_RULES={pitches:rows("rules.Pitch_Types"),stadiums:rows("rules.Stadium_Conditions"),weather:rows("rules.Weather_Conditions"),consistency:rows("rules.Consistency_Profiles"),battingApproaches:rows("rules.Batting_Approaches"),bowlingApproaches:rows("rules.Bowling_Approaches"),ballOutcomes:rows("rules.Ball_Outcome_Rules"),fieldingPositions:rows("rules.Fielding_Positions"),fieldingPresets:rows("rules.Fielding_Presets"),dismissals:rows("rules.Dismissal_Rules"),deliveries:rows("rules.Delivery_Rules"),shots:rows("rules.Shot_Rules")};
