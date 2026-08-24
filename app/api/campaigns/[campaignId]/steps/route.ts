import { NextResponse } from "next/server";
import { saveSteps, type CampaignStepInput } from "../../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime="nodejs";
type Context={params:Promise<{campaignId:string}>};
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function PUT(request:Request,{params}:Context){try{const body=await request.json() as {steps?:CampaignStepInput[]};const campaign=await saveSteps(await getCurrentWorkspace(),(await params).campaignId,body.steps??[]);return campaign?NextResponse.json({campaign}):NextResponse.json({error:"Campagne introuvable."},{status:404});}catch(error){return fail(error);}}
