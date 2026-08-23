import { NextResponse } from "next/server";
import { createAutomation, listAutomations, type AutomationStatus } from "../../lib/automations";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";
export const runtime="nodejs";
const fail=(e:unknown)=>NextResponse.json({error:e instanceof UnauthorizedError?"Non authentifié.":e instanceof Error?e.message:"Erreur serveur."},{status:e instanceof UnauthorizedError?401:400});
export async function GET(r:Request){try{const status=new URL(r.url).searchParams.get("status") as AutomationStatus|null;return NextResponse.json({automations:await listAutomations(await getCurrentWorkspace(),status??undefined)});}catch(e){return fail(e);}}
export async function POST(r:Request){try{return NextResponse.json({automation:await createAutomation(await getCurrentWorkspace(),await r.json())},{status:201});}catch(e){return fail(e);}}
