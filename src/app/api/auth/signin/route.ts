import { signInUser } from "@/lib/local-db";
export async function POST(request:Request){const {email,password}=await request.json();const user=await signInUser(email,password);return user?Response.json({user}):Response.json({error:"Incorrect email or password."},{status:401});}
