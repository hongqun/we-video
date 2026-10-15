import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {Workspace} from "@/components/Workspace";
import {SESSION_COOKIE, verifySession} from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  if (!verifySession(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/login");
  return <Workspace />;
}
