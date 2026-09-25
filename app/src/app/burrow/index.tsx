import { router } from "expo-router";
import { RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { rateLine } from "../../copy/burrow";
import { withDisclosure } from "../../flows/burrow";
import { clampZero, isPositive, usd } from "../../money/amount";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

export default function Burrow() {
  const { profile } = useSession();
  const { data: b, error, refreshing, refresh, reload } = useLoad(() => api.balance());
  const auto = profile?.autoSave;

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brown} />}>
      <Card tone="sand" style={styles.hero}>
        <Mascot size={96} />
        <Muted>In Burrow</Muted>
        <Text variant="hero">{b ? usd(b.burrow.amount) : "—"}</Text>
        <Text variant="bodyStrong" color={colors.green}>
          Earned {usd(clampZero(b?.burrow.earned))} so far
        </Text>
        {b ? (
          <Muted variant="small" style={{ textAlign: "center" }}>
            {rateLine(b.burrow.ratePercent)}
          </Muted>
        ) : null}
      </Card>

      <ErrorNote error={error} onRetry={reload} />

      <View style={styles.buttons}>
        <Button style={{ flex: 1 }} label="Add to Burrow" disabled={!b || !isPositive(b.balance)} onPress={() => withDisclosure("/burrow/move?direction=add")} />
        <Button style={{ flex: 1 }} variant="secondary" label="Move to balance" disabled={!b || !isPositive(b.burrow.amount)} onPress={() => router.push("/burrow/move?direction=withdraw")} />
      </View>

      <Card>
        <Row
          title="Auto-save"
          subtitle={auto?.enabled ? `On · keep ${usd(auto.threshold)} in my balance, tuck the rest away` : "Off · tap to tuck away extra money automatically"}
          onPress={() => withDisclosure("/burrow/autosave")}
        />
      </Card>

      <Muted variant="small">
        Paying more than your balance? We'll ask if you want to take the difference from Burrow, right in the same payment.
      </Muted>
      <Button variant="ghost" label="How Burrow works" onPress={() => router.push("/burrow/about")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  buttons: { flexDirection: "row", gap: space.md },
});
