import { router, Stack, useGlobalSearchParams, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useFonts } from "expo-font";
import { Nunito_400Regular } from "@expo-google-fonts/nunito/400Regular";
import { Nunito_600SemiBold } from "@expo-google-fonts/nunito/600SemiBold";
import { Nunito_700Bold } from "@expo-google-fonts/nunito/700Bold";
import { Nunito_800ExtraBold } from "@expo-google-fonts/nunito/800ExtraBold";
import { Nunito_900Black } from "@expo-google-fonts/nunito/900Black";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider, useSession } from "../state/session";
import { colors } from "../ui/theme";
import { FontReadyContext } from "../ui/Text";
import { fundingReturnId, sessionDestination } from "../auth/route";

export default function RootLayout() {
  const [fontsReady] = useFonts({ Nunito_400Regular, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black });
  return (
    <FontReadyContext.Provider value={fontsReady}>
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <SessionGuard />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.brown,
            headerTitleStyle: { color: colors.ink, fontWeight: "700" },
            headerBackButtonDisplayMode: "minimal",
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="welcome" options={{ headerShown: false }} />
          <Stack.Screen name="unlock" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="phone" options={{ title: "" }} />
          <Stack.Screen name="code" options={{ title: "" }} />
          <Stack.Screen name="create" options={{ title: "" }} />
          <Stack.Screen name="send/index" options={{ title: "Send" }} />
          <Stack.Screen name="send/amount" options={{ title: "" }} />
          <Stack.Screen name="confirm" options={{ presentation: "modal", title: "Confirm" }} />
          <Stack.Screen name="done" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="receive" options={{ title: "Receive" }} />
          <Stack.Screen name="claim/[code]" options={{ title: "" }} />
          <Stack.Screen name="c/[code]" options={{ headerShown: false }} />
          <Stack.Screen name="gifts/index" options={{ title: "Gift cards" }} />
          <Stack.Screen name="gifts/[brandId]" options={{ title: "" }} />
          <Stack.Screen name="card/[id]" options={{ title: "Gift card" }} />
          <Stack.Screen name="burrow/index" options={{ title: "Burrow" }} />
          <Stack.Screen name="burrow/about" options={{ presentation: "modal", title: "How Burrow works" }} />
          <Stack.Screen name="burrow/move" options={{ title: "" }} />
          <Stack.Screen name="burrow/autosave" options={{ title: "Auto-save" }} />
          <Stack.Screen name="activity/[id]" options={{ title: "Receipt" }} />
          <Stack.Screen name="settings/phone" options={{ title: "Your number" }} />
          <Stack.Screen name="settings/about" options={{ title: "About BilbyPay" }} />
          <Stack.Screen name="topup" options={{ title: "" }} />
          <Stack.Screen name="topup-other" options={{ title: "" }} />
          <Stack.Screen name="funding" options={{ title: "Add money" }} />
          <Stack.Screen name="dev/spike" options={{ title: "Developer" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
    </FontReadyContext.Provider>
  );
}

/** Screens anyone can see; everything else needs a signed-in, unlocked session. */
const PUBLIC = new Set(["", "index", "welcome", "phone", "code", "create", "unlock", "claim", "c", "dev"]);

function SessionGuard() {
  const { status, pendingClaim } = useSession();
  const params = useGlobalSearchParams();
  const segments = useSegments() as string[];
  const first = segments[0] ?? "";
  const numberManagement = first === "settings" && segments[1] === "phone";
  const fundingId = first === "funding" ? fundingReturnId(params.id) : undefined;
  useEffect(() => {
    if (first === "(tabs)" || (status === "pendingPhone" && numberManagement) || PUBLIC.has(first)) return;
    const destination = sessionDestination(status, pendingClaim, fundingId);
    if (destination) router.replace(destination);
  }, [status, first, numberManagement, pendingClaim, fundingId]);
  return null;
}
