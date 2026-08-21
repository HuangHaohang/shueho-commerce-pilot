import { auth } from "@/lib/auth";
import { jsonWithAuthHeaders } from "@/lib/auth/http";

export async function POST(request: Request) {
  const result = await auth.api.signOut({
    headers: request.headers,
    returnHeaders: true,
  });
  return jsonWithAuthHeaders({ ok: result.response.success }, result.headers);
}
