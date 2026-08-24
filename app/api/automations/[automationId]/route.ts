import { NextResponse } from "next/server";
import { archiveAutomation,getAutomation,updateAutomation } from "../../../lib/automations";
import { getCurrentWorkspace,UnauthorizedError } from "../../../lib/workspace-context";
export const runtime="nodejs";const fail=(e:unknown)=>NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":e instanceof Error?e.message:"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});
export async function GET(_:Request,{params}:{params:Promise<{automationId:string}>}){try{const a=await getAutomation(await getCurrentWorkspace(),(await params).automationId);return a?NextResponse.json({automation:a}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return fail(e);}}
export async function PATCH(r:Request,{params}:{params:Promise<{automationId:string}>}){try{const a=await updateAutomation(await getCurrentWorkspace(),(await params).automationId,await r.json());return a?NextResponse.json({automation:a}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return fail(e);}}
export async function DELETE(_:Request,{params}:{params:Promise<{automationId:string}>}){try{return await archiveAutomation(await getCurrentWorkspace(),(await params).automationId)?NextResponse.json({archived:true}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return fail(e);}}
