import { Redirect, Tabs } from "expo-router";
import { useSession } from "../../state/session";
import { Icon, type IconName } from "../../ui/Icon";
import { colors } from "../../ui/theme";

const icon = (name: IconName) => ({ color }: { color: unknown }) => <Icon name={name} color={String(color)} />;

export default function TabsLayout() {
  const { status } = useSession();
  if (status !== "ready") return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { color: colors.ink, fontWeight: "700" },
        tabBarActiveTintColor: colors.brown,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", headerShown: false, tabBarIcon: icon("home") }} />
      <Tabs.Screen name="activity" options={{ title: "Activity", tabBarIcon: icon("activity") }} />
      <Tabs.Screen name="cards" options={{ title: "Gift cards", tabBarIcon: icon("gift") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings") }} />
    </Tabs>
  );
}
