import { auth } from "@/lib/auth";

export async function hasAuthenticatedSession(request: Request): Promise<boolean> {
  return Boolean(await getAuthenticatedUserId(request));
}

export async function getAuthenticatedUserId(request: Request): Promise<string | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}
