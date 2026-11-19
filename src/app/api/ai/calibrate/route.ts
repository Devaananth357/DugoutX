import { calibrateAuctionAi } from "@/lib/ai";
export async function GET(request:Request){const value=Number(new URL(request.url).searchParams.get("runs")||100);const runs=Math.max(1,Math.min(500,value));return Response.json(calibrateAuctionAi(runs),{headers:{"Cache-Control":"no-store"}});}
