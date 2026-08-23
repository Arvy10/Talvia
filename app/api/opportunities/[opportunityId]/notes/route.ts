import { NextResponse } from "next/server";
import { addNote,listNotes } from "../../../../lib/opportunities";
import { getCurrentWorkspace,UnauthorizedError } from "../../../../lib/workspace-context";
export const runtime="nodejs";
export async function GET(_:Request,{params}:{params:Promise<{opportunityId:string}>}){try{return NextResponse.json({notes:await listNotes(await getCurrentWorkspace(),(await params).opportunityId)});}catch(e){return NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});}}
export async function POST(r:Request,{params}:{params:Promise<{opportunityId:string}>}){try{const note=await addNote(await getCurrentWorkspace(),(await params).opportunityId,String((await r.json() as {body?:string}).body??""));return note?NextResponse.json({note},{status:201}):NextResponse.json({error:"Introuvable."},{status:404});}catch(e){return NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});}}
