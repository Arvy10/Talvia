import { NextResponse } from "next/server";
import { listRuns } from "../../../../lib/automations";
import { getCurrentWorkspace,UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{automationId:string}>}){try{const runs=await listRuns(await getCurrentWorkspace(),(await params).automationId);return runs?NextResponse.json({runs}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":e instanceof Error?e.message:"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});}}
