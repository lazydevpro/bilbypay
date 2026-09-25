// glossary-allow-file — developer-only screen, never reachable in production builds.
import { Redirect } from "expo-router";
import Spike from "../../dev/Spike";

export default function DevSpike() {
  if (!__DEV__) return <Redirect href="/" />;
  return <Spike />;
}
