import { NextResponse } from "next/server";
import { getCampaign, transitionCampaign, updateCampaign, type CampaignInput } from "../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../lib/workspace-context";
export const runtime="nodejs";
type Context={params:Promise<{campaignId:string}>};
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function GET(_:Request,{params}:Context){try{const campaign=await getCampaign(await getCurrentWorkspace(),(await params).campaignId);return campaign?NextResponse.json({campaign}):NextResponse.json({error:"Campagne introuvable."},{status:404});}catch(error){return fail(error);}}
export async function PATCH(request:Request,{params}:Context){try{const body=await request.json() as Partial<CampaignInput>&{action?:"activate"|"pause"|"resume"|"complete"|"archive"};const context=await getCurrentWorkspace();const campaign=body.action?await transitionCampaign(context,(await params).campaignId,body.action):await updateCampaign(context,(await params).campaignId,body);return campaign?NextResponse.json({campaign}):NextResponse.json({error:"Campagne introuvable."},{status:404});}catch(error){return fail(error);}}
