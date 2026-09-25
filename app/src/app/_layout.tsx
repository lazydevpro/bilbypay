import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../state/session";
import { colors } from "../ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
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
          <Stack.Screen name="settings/about" options={{ title: "About BilbyPay" }} />
          <Stack.Screen name="dev/spike" options={{ title: "Developer" }} />
        </Stack>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
