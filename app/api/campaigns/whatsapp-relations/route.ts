import { NextResponse } from "next/server";
import { listEligibleWhatsAppRelations } from "../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../lib/workspace-context";
export const runtime="nodejs";
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
export async function GET(){try{return NextResponse.json({relations:await listEligibleWhatsAppRelations(await getCurrentWorkspace())});}catch(error){return fail(error);}}
