import { router } from "expo-router";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { rememberActivity } from "../../flows/drafts";
import { clampZero, isPositive, usd } from "../../money/amount";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { ActivityRow } from "../../ui/ActivityRow";
import { Card, SectionTitle } from "../../ui/Card";
import { Icon, type IconName } from "../../ui/Icon";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space, TAP } from "../../ui/theme";

export default function Home() {
  const { profile } = useSession();
  const { data, error, refreshing, refresh, reload } = useLoad(async () => {
    const [balance, activity] = await Promise.all([api.balance(), api.activity()]);
    rememberActivity(activity.items);
    return { balance, recent: activity.items.slice(0, 5) };
  });
  const b = data?.balance;

  return (
    <Screen edges={["top"]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brown} />}>
      <Text variant="heading">Hi {profile?.displayName.split(" ")[0] ?? "there"}</Text>

      <Card tone="sand" style={styles.balanceCard}>
        <Muted>Balance</Muted>
        <Text variant="hero" accessibilityLabel={`Balance ${usd(b?.balance)}`}>
          {b ? usd(b.balance) : "—"}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.push("/burrow")} style={styles.burrowLine}>
          <Text variant="small" color={colors.brown}>
            🌱 Burrow {usd(b?.burrow.amount)} · earned {usd(clampZero(b?.burrow.earned))}
          </Text>
          <Icon name="chevron" size={16} color={colors.brown} />
        </Pressable>
        {b && isPositive(b.pendingOut) ? (
          <Muted variant="small">{usd(b.pendingOut)} waiting to be opened by friends</Muted>
        ) : null}
      </Card>

      <View style={styles.actions}>
        <Action icon="send" label="Send" onPress={() => router.push("/send")} />
        <Action icon="receive" label="Receive" onPress={() => router.push("/receive")} />
        <Action icon="gift" label="Gift" onPress={() => router.push("/gifts")} />
      </View>

      <ErrorNote error={error} onRetry={reload} />

      <SectionTitle
        action={
          <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/activity")} hitSlop={12}>
            <Text variant="small" color={colors.brown}>
              See all
            </Text>
          </Pressable>
        }
      >
        Recent
      </SectionTitle>
      {data && data.recent.length === 0 ? (
        <View style={styles.empty}>
          <Mascot size={120} />
          <Muted style={{ textAlign: "center" }}>Nothing here yet. Send a friend some dollars. It only takes a second.</Muted>
        </View>
      ) : (
        data?.recent.map((it) => <ActivityRow key={it.id} item={it} />)
      )}
    </Screen>
  );
}

function Action({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.85 }]}>
      <View style={styles.actionIcon}>
        <Icon name={icon} color={colors.white} />
      </View>
      <Text variant="bodyStrong" color={colors.brown}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  balanceCard: { paddingVertical: space.xl, gap: space.sm },
  burrowLine: { flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 36 },
  actions: { flexDirection: "row", gap: space.md },
  action: { flex: 1, alignItems: "center", gap: space.sm, paddingVertical: space.md, borderRadius: radius.lg, backgroundColor: colors.surface },
  actionIcon: { width: TAP, height: TAP, borderRadius: TAP / 2, backgroundColor: colors.brown, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.lg },
});
