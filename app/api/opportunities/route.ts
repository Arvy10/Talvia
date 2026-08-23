import { NextResponse } from "next/server";
import { createOpportunity, listOpportunities, type OpportunityInput } from "../../lib/opportunities";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";
export const runtime="nodejs";
function fail(e:unknown){if(e instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:e instanceof Error?e.message:"Erreur serveur."},{status:400});}
export async function GET(){try{return NextResponse.json({opportunities:await listOpportunities(await getCurrentWorkspace())});}catch(e){return fail(e);}}
export async function POST(r:Request){try{return NextResponse.json({opportunity:await createOpportunity(await getCurrentWorkspace(),await r.json() as OpportunityInput)},{status:201});}catch(e){return fail(e);}}
