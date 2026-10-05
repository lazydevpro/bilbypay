import { router } from "expo-router";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { rememberActivity } from "../../flows/drafts";
import { isPositive, usd } from "../../money/amount";
import { useCompanionTime } from "../../state/companion";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { ActivityRow } from "../../ui/ActivityRow";
import { Avatar } from "../../ui/Avatar";
import { BilbyScene } from "../../ui/BilbyScene";
import { Button } from "../../ui/Button";
import { SectionTitle } from "../../ui/Card";
import { Icon } from "../../ui/Icon";
import { ErrorNote, Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

export default function Home() {
  const { profile } = useSession();
  const time = useCompanionTime();
  const { data, error, refreshing, refresh, reload } = useLoad(async () => {
    const [balance, activity, number] = await Promise.all([api.balance(), api.activity(), api.phoneStatus()]);
    rememberActivity(activity.items);
    return { balance, recent: activity.items.slice(0, 4), number };
  });
  const b = data?.balance;

  return <Screen edges={["top"]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
    <View style={styles.header}>
      <View><Text variant="display" style={styles.wordmark}>bilbypay</Text><View style={styles.dot} /></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Your profile and settings" onPress={() => router.push("/(tabs)/settings")} style={styles.profile}>
        <Avatar name={profile?.displayName ?? "You"} size={44} />
      </Pressable>
    </View>
    {(data?.number.status ?? profile?.phoneStatus) === "pending" ? <Notice tone="warning" title="Check your number" message="A move to another account has been requested for your number. Review it now, and cancel it if you still use this number." action={{ label: "Review number change", onPress: () => router.push("/settings/phone") }} /> : null}
    {["expired", "reassigned", "revoked"].includes(data?.number.status ?? profile?.phoneStatus ?? "") ? <Notice tone="warning" title="Receiving by number is paused" message="Check your number before asking friends to pay you. Your existing balance is still here." action={{ label: "Check my number", onPress: () => router.push("/settings/phone") }} /> : null}
    <View style={styles.balance}>
      <View style={styles.amount}>
        <Text variant="bodyStrong">Your balance</Text>
        <Text variant="hero" style={styles.number} adjustsFontSizeToFit numberOfLines={1} accessibilityLabel={`Your balance ${b ? usd(b.balance) : "loading"}`}>{b ? usd(b.balance) : "—"}</Text>
        <Muted variant="caption">USD</Muted>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push("/topup")} style={({ pressed }) => [styles.addMoney, { opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.plus}><Text variant="heading" color={colors.white}>+</Text></View><Text variant="small" color={colors.primary}>Add money</Text>
      </Pressable>
    </View>
    <BilbyScene height={222} time={time} />
    <Text variant="display" style={styles.greeting}>{time.greeting}</Text>
    <View style={styles.actions}>
      <Button style={{ flex: 1.35 }} label="Pay someone" icon={<Icon name="send" color={colors.white} size={20} />} onPress={() => router.push("/send")} />
      <Button style={{ flex: 1 }} variant="secondary" label="Receive" icon={<Icon name="receive" color={colors.ink} size={20} />} onPress={() => router.push("/receive")} />
    </View>
    {b && isPositive(b.pendingOut) ? <Muted variant="small">{usd(b.pendingOut)} waiting to be opened by friends</Muted> : null}
    <ErrorNote error={error} onRetry={reload} />
    <View style={styles.shortcuts}>
      <Pressable accessibilityRole="button" onPress={() => router.push("/gifts")} style={styles.shortcut}>
        <View style={[styles.shortcutIcon, { backgroundColor: colors.redSoft }]}><Icon name="gift" color={colors.red} /></View>
        <View style={styles.shortcutText}><Text variant="bodyStrong">A little gift</Text><Muted variant="caption">Make someone’s day</Muted></View>
        <Icon name="chevron" color={colors.muted} size={16} />
      </Pressable>
    </View>
    <Pressable accessibilityRole="button" onPress={() => router.push("/burrow")} style={styles.burrow}>
      <View style={styles.burrowIcon}><Icon name="burrow" color={colors.green} /></View>
      <View style={{ flex: 1 }}><Text variant="bodyStrong">Your Burrow</Text><Muted variant="caption">Net change {b ? usd(b.burrow.earned) : "—"}</Muted></View>
      <Text variant="heading">{b ? usd(b.burrow.amount) : "—"}</Text><Icon name="chevron" color={colors.muted} size={16} />
    </Pressable>
    <SectionTitle action={<Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/activity")} style={styles.seeAll}><Text variant="small" color={colors.primary}>See all</Text></Pressable>}>Recent activity</SectionTitle>
    {data?.recent.length === 0 ? <View style={styles.empty}><Text variant="bodyStrong">Your story starts here.</Text><Muted variant="small">Payments and gifts will show up here, with a receipt for every little moment.</Muted></View> : data?.recent.map(item => <ActivityRow key={item.id} item={item} />)}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  wordmark: { fontSize: 32, letterSpacing: -1.8 },
  dot: { position: "absolute", left: 22, top: 1, width: 7, height: 7, borderRadius: 4, backgroundColor: colors.red },
  profile: { padding: 3, borderRadius: 30, borderWidth: 1, borderColor: colors.line },
  balance: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginTop: space.sm },
  amount: { flex: 1, gap: 1 },
  number: { fontSize: 44, fontVariant: ["tabular-nums"] },
  addMoney: { flexDirection: "row", gap: 6, alignItems: "center", minHeight: 44, paddingHorizontal: 10, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  plus: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  greeting: { fontSize: 28, letterSpacing: -0.8 },
  actions: { flexDirection: "row", gap: space.sm },
  shortcuts: { gap: space.sm, marginTop: space.sm },
  shortcut: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 70, padding: space.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  shortcutText: { flex: 1, gap: 2 },
  shortcutIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  burrow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: space.md, borderBottomWidth: 1, borderColor: colors.line },
  burrowIcon: { height: 40, width: 40, borderRadius: 14, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center" },
  seeAll: { minHeight: 44, justifyContent: "center", paddingLeft: space.md },
  empty: { gap: 6, paddingBottom: space.lg },
});
