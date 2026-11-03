import { NextResponse } from "next/server";
import { providerInfo } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Reports which provider/model is configured (never the key). */
export async function GET() {
  return NextResponse.json(providerInfo());
}
