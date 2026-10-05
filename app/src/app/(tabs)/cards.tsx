import { router } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { usd } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { Button } from "../../ui/Button";
import { GiftCardArtwork } from "../../ui/GiftCardArtwork";
import { Icon } from "../../ui/Icon";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

export default function Cards() {
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.giftCards());
  const cards = data?.cards ?? [];

  return (
    <Screen
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}
      footer={<Button label="Get a gift card" onPress={() => router.push("/gifts")} />}
    >
      <View style={styles.heading}>
        <Text variant="display">Your little collection</Text>
        <Muted>Good things to look forward to.</Muted>
      </View>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading your gift cards" /> : null}
      {data && cards.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.albumScene}>
            <Mascot size={216} mood="organizing" interactive={false} />
          </View>
          <Text variant="title" style={styles.center}>A place for your treats</Text>
          <Muted style={styles.center}>Gift cards you buy or get from friends live here, ready to use.</Muted>
        </View>
      ) : null}
      {cards.map((c) => (
        <Pressable
          key={c.id}
          accessibilityRole="button"
          accessibilityLabel={`${c.brandName}, ${usd(c.amount)}, ${c.status === "ready" ? "view card" : c.status}`}
          accessibilityState={{ disabled: c.status !== "ready" }}
          disabled={c.status !== "ready"}
          style={({ pressed }) => [styles.savedCard, pressed && { backgroundColor: colors.sand }]}
          onPress={c.status === "ready" ? () => router.push(`/card/${c.id}`) : undefined}
        >
          <GiftCardArtwork name={c.brandName} artworkUrl={c.artworkUrl} logoUrl={c.logoUrl} />
          <View style={styles.cardDetails}>
            <View style={styles.cardName}>
              <Text variant="heading">{c.brandName}</Text>
              <Muted variant="small">{c.status === "processing" ? "Getting your card ready…" : c.status === "failed" ? "Didn't go through · money returned" : c.from ? `From ${c.from}` : "Bought by you"}</Muted>
            </View>
            <Text variant="heading">{usd(c.amount)}</Text>
            {c.status === "ready" ? <Icon name="chevron" size={18} color={colors.brown} /> : null}
          </View>
        </Pressable>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { gap: space.sm },
  savedCard: { width: "100%", maxWidth: 420, alignSelf: "center", borderRadius: radius.lg, gap: space.md, padding: space.md, backgroundColor: colors.surface },
  cardDetails: { flexDirection: "row", gap: space.sm, alignItems: "center", paddingHorizontal: space.xs, paddingBottom: space.sm },
  cardName: { flex: 1, gap: space.xs },
  empty: { alignItems: "center", gap: space.md, paddingTop: space.xl },
  center: { textAlign: "center", maxWidth: 290 },
  albumScene: { width: "100%", maxWidth: 320, minHeight: 248, padding: space.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.sand, borderRadius: radius.xl },
});
