import { NextResponse } from "next/server";
import { addParticipants } from "../../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime="nodejs";
type Context={params:Promise<{campaignId:string}>};
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function POST(request:Request,{params}:Context){try{const body=await request.json() as {contactIds?:string[]};const campaign=await addParticipants(await getCurrentWorkspace(),(await params).campaignId,body.contactIds??[]);return campaign?NextResponse.json({campaign}):NextResponse.json({error:"Campagne introuvable."},{status:404});}catch(error){return fail(error);}}
