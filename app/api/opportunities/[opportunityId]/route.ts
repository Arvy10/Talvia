import { NextResponse } from "next/server";
import { closeOpportunity,getOpportunity,updateOpportunity,type OpportunityInput } from "../../../lib/opportunities";
import { getCurrentWorkspace,UnauthorizedError } from "../../../lib/workspace-context";
export const runtime="nodejs";
function fail(e:unknown){if(e instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:e instanceof Error?e.message:"Erreur serveur."},{status:400});}
export async function GET(_:Request,{params}:{params:Promise<{opportunityId:string}>}){try{const o=await getOpportunity(await getCurrentWorkspace(),(await params).opportunityId);return o?NextResponse.json({opportunity:o}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return fail(e);}}
export async function PATCH(r:Request,{params}:{params:Promise<{opportunityId:string}>}){try{const id=(await params).opportunityId;const body=await r.json() as OpportunityInput&{closeAs?:"won"|"lost";finalValue?:number;lostReason?:string};const o=body.closeAs?await closeOpportunity(await getCurrentWorkspace(),id,body.closeAs,body.finalValue,body.lostReason):await updateOpportunity(await getCurrentWorkspace(),id,body);return o?NextResponse.json({opportunity:o}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return fail(e);}}
