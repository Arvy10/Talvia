import { NextResponse } from "next/server";
import { createCampaign, listCampaigns, type CampaignInput } from "../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";
export const runtime="nodejs";
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function GET(){try{return NextResponse.json({campaigns:await listCampaigns(await getCurrentWorkspace())});}catch(error){return fail(error);}}
export async function POST(request:Request){try{return NextResponse.json({campaign:await createCampaign(await getCurrentWorkspace(),await request.json() as CampaignInput)},{status:201});}catch(error){return fail(error);}}
