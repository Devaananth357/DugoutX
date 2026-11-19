import { createRoom } from "@/lib/local-db";
export async function POST(request:Request){try{const input=await request.json();const room=await createRoom({...input,players:[{name:input.host,team:input.team,host:true}]});return Response.json({room:{...room,passwordHash:undefined}});}catch{return Response.json({error:"Could not create the room."},{status:500});}}
