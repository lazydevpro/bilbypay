import { router } from "expo-router";
import { loadBurrowAck } from "../auth/keyStore";

/** Opens `next` once the Burrow disclosure has been read on this phone (shows it first otherwise). */
export async function withDisclosure(next: string): Promise<void> {
  if (await loadBurrowAck()) router.push(next);
  else router.push({ pathname: "/burrow/about", params: { next } });
}
