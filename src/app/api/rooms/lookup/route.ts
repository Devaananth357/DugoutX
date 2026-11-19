import { validateRoom } from "@/lib/local-db";
export async function POST(request:Request){const {code,password}=await request.json();const room=await validateRoom(code,password);if(!room)return Response.json({error:"Room code or password is incorrect."},{status:401});return Response.json({room:{...room,passwordHash:undefined}});}
