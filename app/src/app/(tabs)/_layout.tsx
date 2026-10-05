import { Redirect, Tabs } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { sessionDestination } from "../../auth/route";
import { useSession } from "../../state/session";
import { Icon, type IconName } from "../../ui/Icon";
import { colors } from "../../ui/theme";

const icon = (name: IconName) => function TabIcon({ color }: { color: unknown }) {
  return <Icon name={name} color={String(color)} />;
};

export default function TabsLayout() {
  const { status, pendingClaim } = useSession();
  if (status === "loading") return <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg }}><ActivityIndicator color={colors.primary} /></View>;
  const destination = sessionDestination(status, pendingClaim);
  if (destination) return <Redirect href={destination} />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink, fontWeight: "700" },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, paddingTop: 8, height: 72, paddingBottom: 10 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: icon("home") }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: icon("activity") }} />
      <Tabs.Screen name="cards" options={{ title: "Gifts", tabBarIcon: icon("gift") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings") }} />
    </Tabs>
  );
}
