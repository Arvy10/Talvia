import { NextResponse } from "next/server";
import { getCampaign } from "../../../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../../../lib/workspace-context";
export const runtime="nodejs";
type Context={params:Promise<{campaignId:string;stepId:string}>};
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function GET(_:Request,{params}:Context){try{const p=await params;const campaign=await getCampaign(await getCurrentWorkspace(),p.campaignId);const step=campaign?.steps.find(item=>item.id===p.stepId);return step?NextResponse.json({step}):NextResponse.json({error:"Étape introuvable."},{status:404});}catch(error){return fail(error);}}
