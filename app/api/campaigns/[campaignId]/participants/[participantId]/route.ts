import { NextResponse } from "next/server";
import { removeParticipant, stopParticipant } from "../../../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime="nodejs";
type Context={params:Promise<{campaignId:string;participantId:string}>};
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function PATCH(request:Request,{params}:Context){try{const body=await request.json() as {action?:"stop";reason?:string};const p=await params;const campaign=body.action==="stop"?await stopParticipant(await getCurrentWorkspace(),p.campaignId,p.participantId,body.reason):null;return campaign?NextResponse.json({campaign}):NextResponse.json({error:"Participant ou campagne introuvable."},{status:404});}catch(error){return fail(error);}}
export async function DELETE(_:Request,{params}:Context){try{const p=await params;const campaign=await removeParticipant(await getCurrentWorkspace(),p.campaignId,p.participantId);return campaign?NextResponse.json({campaign}):NextResponse.json({error:"Participant ou campagne introuvable."},{status:404});}catch(error){return fail(error);}}
