import { NextResponse } from "next/server";
import { createConversation,listConversations,type CreateConversationInput } from "../../../lib/inbox";
import { getCurrentWorkspace,UnauthorizedError } from "../../../lib/workspace-context";
export const runtime="nodejs";const fail=(e:unknown)=>NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":e instanceof Error?e.message:"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});
export async function GET(r:Request){try{const archived=new URL(r.url).searchParams.get("archived")==="true";return NextResponse.json({conversations:await listConversations(await getCurrentWorkspace(),archived)});}catch(e){return fail(e);}}
export async function POST(r:Request){try{return NextResponse.json({conversation:await createConversation(await getCurrentWorkspace(),await r.json() as CreateConversationInput)},{status:201});}catch(e){return fail(e);}}
