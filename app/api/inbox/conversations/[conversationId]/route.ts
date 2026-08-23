import { NextResponse } from "next/server";
import { archive,getConversation } from "../../../../lib/inbox";
import { getCurrentWorkspace,UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime="nodejs";type C={params:Promise<{conversationId:string}>};const fail=(e:unknown)=>NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":e instanceof Error?e.message:"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});
export async function GET(_:Request,{params}:C){try{const v=await getConversation(await getCurrentWorkspace(),(await params).conversationId);return v?NextResponse.json({conversation:v}):NextResponse.json({error:"Conversation introuvable."},{status:404});}catch(e){return fail(e);}}
export async function PATCH(r:Request,{params}:C){try{const body=await r.json() as {action?:"archive"|"reopen"};const v=await archive(await getCurrentWorkspace(),(await params).conversationId,body.action==="archive");return v?NextResponse.json({conversation:v}):NextResponse.json({error:"Conversation introuvable."},{status:404});}catch(e){return fail(e);}}
