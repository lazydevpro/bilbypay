import { router } from "expo-router";
import { RefreshControl, StyleSheet, useWindowDimensions, View } from "react-native";
import { api } from "../../api";
import { rateLine } from "../../copy/burrow";
import { withDisclosure } from "../../flows/burrow";
import { isPositive, usd } from "../../money/amount";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { BurrowGarden } from "../../ui/BurrowGarden";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { ErrorNote } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

export default function Burrow() {
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const { profile } = useSession();
  const { data: b, error, refreshing, refresh, reload } = useLoad(() => api.balance());
  const auto = profile?.autoSave;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.ink} />}>
      <View style={styles.intro}>
        <Text variant="title">Your Burrow</Text>
        <Muted>A spot for money you&apos;re not using right now.</Muted>
      </View>
      <View style={styles.balance}>
        <View style={[styles.balanceTop, compact && styles.balanceStack]}>
          <View style={[styles.figures, compact && styles.figuresFull]}>
            <Text variant="small" color={colors.muted}>Tucked away</Text>
            <Text variant="display" selectable style={styles.amount}>{b ? usd(b.burrow.amount) : "—"}</Text>
          </View>
          <BurrowGarden reassuring={!!error} />
        </View>
        <View style={styles.earned}>
          <Text variant="small" color={colors.muted}>Change so far</Text>
          <Text variant="bodyStrong">{b ? usd(b.burrow.earned) : "—"}</Text>
        </View>
        {b ? <Muted variant="small">{rateLine(b.burrow.ratePercent)}</Muted> : null}
      </View>

      <ErrorNote error={error} onRetry={reload} />

      <View style={styles.buttons}>
        <Button label="Add to Burrow" disabled={!b || !isPositive(b.balance)} onPress={() => withDisclosure("/burrow/move?direction=add")} />
        <Button variant="secondary" label="Move to balance" disabled={!b || !isPositive(b.burrow.amount)} onPress={() => router.push("/burrow/move?direction=withdraw")} />
      </View>

      <Card>
        <Row
          title="Auto-save"
          subtitle={auto?.enabled ? `On · keep ${usd(auto.threshold)} in my balance, tuck the rest away` : "Off · tap to tuck away extra money automatically"}
          onPress={() => withDisclosure("/burrow/autosave")}
        />
      </Card>

      <Muted variant="small">
        Paying more than your balance? We&apos;ll ask if you want to take the difference from Burrow, right in the same payment.
      </Muted>
      <View style={styles.disclosure}>
        <Text variant="small" color={colors.muted}>Burrow isn&apos;t a bank account and isn&apos;t insured. Returns vary. Money could be delayed or lost.</Text>
        <Button variant="ghost" label="How Burrow works" onPress={() => router.push("/burrow/about")} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { gap: space.xs },
  balance: { backgroundColor: "#F0F2E5", borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  balanceTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 148 },
  figures: { flex: 1, gap: space.sm, minWidth: 0 },
  balanceStack: { flexDirection: "column", alignItems: "flex-end", gap: space.sm },
  figuresFull: { flex: 0, alignSelf: "stretch" },
  amount: { fontVariant: ["tabular-nums"] },
  earned: { flexDirection: "row", justifyContent: "space-between", gap: space.md, borderTopWidth: 1, borderTopColor: "#D6DDC5", paddingTop: space.md },
  buttons: { gap: space.sm },
  disclosure: { gap: space.xs, paddingTop: space.sm },
});
