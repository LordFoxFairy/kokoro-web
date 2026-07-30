import { controlError, controlJson } from "@/lib/control-plane/http";
import { getCurrentOperator } from "@/lib/control-plane/client";
export const runtime = "nodejs";
export async function GET() { try { return controlJson(await getCurrentOperator()); } catch (error) { return controlError(error); } }
