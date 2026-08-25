import { NextResponse } from "next/server";

import {
  getActiveBusinessContext,
  RateLimitedError,
  runBusinessContextAnalysis,
  startManualBusinessContext,
  updateActiveBusinessContext,
  type BusinessContextEditInput,
} from "../../lib/business-context/business-context-service";
import { getCurrentWorkspace, UnauthorizedError } from "../../lib/workspace-context";

export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof UnauthorizedError) return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
  if (error instanceof RateLimitedError) return NextResponse.json({ error: error.message }, { status: 429 });
  // The client only ever sees "Erreur serveur." — log the real cause so it's
  // diagnosable from server logs instead of vanishing entirely.
  console.error("[business-context] unexpected error", error);
  return NextResponse.json({ error: "Erreur serveur." }, { status: 400 });
}

export async function GET() {
  try {
    const context = await getCurrentWorkspace();
    const businessContext = await getActiveBusinessContext(context);
    return NextResponse.json({ businessContext });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await getCurrentWorkspace();
    const input = (await request.json()) as { website?: string; manual?: boolean };

    if (input.manual) {
      const businessContext = await startManualBusinessContext(context);
      return NextResponse.json({ businessContext });
    }

    const website = input.website?.trim();
    if (!website) {
      return NextResponse.json({ error: "Renseignez une URL de site web." }, { status: 422 });
    }
    const businessContext = await runBusinessContextAnalysis(context, website);
    return NextResponse.json({ businessContext });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const context = await getCurrentWorkspace();
    const input = (await request.json()) as BusinessContextEditInput;
    const businessContext = await updateActiveBusinessContext(context, input);
    if (!businessContext) {
      return NextResponse.json({ error: "Aucun profil d'entreprise à modifier." }, { status: 404 });
    }
    return NextResponse.json({ businessContext });
  } catch (error) {
    return errorResponse(error);
  }
}
