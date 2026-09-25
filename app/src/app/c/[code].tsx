import { Redirect, useLocalSearchParams } from "expo-router";

/** Universal link https://bilbypay.com/c/:code → the in-app claim screen. */
export default function ShortClaimLink() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <Redirect href={`/claim/${code ?? ""}`} />;
}
