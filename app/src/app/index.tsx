import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useSession } from "../state/session";
import { colors } from "../ui/theme";

/** Sends people where they belong: onboarding, unlock, a claim they opened earlier, or home. */
export default function Index() {
  const { status, pendingClaim } = useSession();
  switch (status) {
    case "loading":
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg }}>
          <ActivityIndicator color={colors.brown} />
        </View>
      );
    case "signedOut":
      return <Redirect href="/welcome" />;
    case "locked":
      return <Redirect href="/unlock" />;
    case "pendingPhone":
      return <Redirect href="/settings/phone" />;
    case "needsPhone":
      return <Redirect href={{ pathname: "/phone", params: { purpose: pendingClaim ? "claim" : "onboard", code: pendingClaim ?? "" } }} />;
    case "ready":
      return pendingClaim ? <Redirect href={`/claim/${pendingClaim}`} /> : <Redirect href="/(tabs)" />;
  }
}
