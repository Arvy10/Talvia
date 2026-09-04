import { NextResponse } from "next/server";
import { listEligibleEmailContacts } from "../../../lib/campaigns";
import { getCurrentWorkspace, UnauthorizedError } from "../../../lib/workspace-context";
export const runtime="nodejs";
function fail(error:unknown){if(error instanceof UnauthorizedError)return NextResponse.json({error:"Non authentifié."},{status:401});return NextResponse.json({error:error instanceof Error?error.message:"Erreur serveur."},{status:400});}
// The server-owned email audience — the client never decides who is
// eligible, and the same rule is re-applied at send time.
export async function GET(){try{return NextResponse.json({contacts:await listEligibleEmailContacts(await getCurrentWorkspace())});}catch(error){return fail(error);}}
