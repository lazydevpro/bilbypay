import { router } from "expo-router";
import { RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { usd } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { BrandLogo } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Row } from "../../ui/Row";
import { Screen } from "../../ui/Screen";
import { Muted } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

export default function Cards() {
  const { data, error, refreshing, refresh, reload } = useLoad(() => api.giftCards());
  const cards = data?.cards ?? [];

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brown} />}
      footer={<Button label="Get a gift card" onPress={() => router.push("/gifts")} />}
    >
      <ErrorNote error={error} onRetry={reload} />
      {data && cards.length === 0 ? (
        <View style={styles.empty}>
          <Mascot size={140} />
          <Muted style={{ textAlign: "center" }}>Gift cards you buy or get from friends live here, ready to use.</Muted>
        </View>
      ) : null}
      {cards.map((c) => (
        <Row
          key={c.id}
          leading={<BrandLogo name={c.brandName} uri={c.logoUrl} size={48} />}
          title={c.brandName}
          subtitle={
            c.status === "processing" ? "Getting your card ready…" : c.status === "failed" ? "Didn't go through · money returned" : c.from ? `From ${c.from}` : "Bought by you"
          }
          trailing={usd(c.amount)}
          onPress={c.status === "ready" ? () => router.push(`/card/${c.id}`) : undefined}
        />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: "center", gap: space.lg, paddingTop: space.xxl },
});
