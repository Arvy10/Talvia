import { NextResponse } from "next/server";
import { testAutomation } from "../../../../lib/automations";
import { getCurrentWorkspace,UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime="nodejs";
export async function POST(_:Request,{params}:{params:Promise<{automationId:string}>}){try{const run=await testAutomation(await getCurrentWorkspace(),(await params).automationId);return run?NextResponse.json({run}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":e instanceof Error?e.message:"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});}}
