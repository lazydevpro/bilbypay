import { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import { loadActivity } from "../../api/indexer";
import type { ActivityItem } from "../../api/types";
import { CHAIN_ID, INDEXER_URL, IS_MOCK } from "../../config";
import { rememberActivity } from "../../flows/drafts";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { ActivityRow } from "../../ui/ActivityRow";
import { Icon } from "../../ui/Icon";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

export default function Activity() {
  const { address } = useSession();
  // On-chain feed from the Envio indexer when configured; the API otherwise and on any indexer error.
  const fetchPage = (cursor?: string) =>
    loadActivity({ cursor, account: address, indexerUrl: IS_MOCK ? undefined : INDEXER_URL, chainId: CHAIN_ID, apiActivity: (c) => api.activity(c) });
  const [more, setMore] = useState<{ items: ActivityItem[]; cursor?: string; loading: boolean; error?: unknown }>({ items: [], loading: false });
  const { data, error, loading, refreshing, refresh, reload } = useLoad(async () => {
    const page = await fetchPage();
    rememberActivity(page.items);
    setMore({ items: [], cursor: page.nextCursor, loading: false });
    return page;
  }, [address]);

  const items = [...(data?.items ?? []), ...more.items];

  const loadMore = async () => {
    if (!more.cursor || more.loading) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const page = await fetchPage(more.cursor);
      rememberActivity(page.items);
      setMore((m) => ({ items: [...m.items, ...page.items], cursor: page.nextCursor, loading: false }));
    } catch (e) {
      setMore((m) => ({ ...m, loading: false, error: e }));
    }
  };

  return (
    <FlatList
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.list}
      data={items}
      keyExtractor={(it) => it.id}
      renderItem={({ item }) => <ActivityRow item={item} />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.brown} />}
      onEndReached={loadMore}
      onEndReachedThreshold={0.4}
      ListHeaderComponent={<ErrorNote error={error ?? more.error} onRetry={reload} />}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator color={colors.brown} style={{ marginTop: space.xxl }} />
        ) : (
          <View style={styles.empty}>
            <View style={styles.emptyHeading}>
              <View style={styles.emptyWords}>
                <Text variant="title">A place for every receipt</Text>
                <Muted variant="small">Bilby likes to keep things in order.</Muted>
              </View>
              <Mascot size={76} mood="organizing" accessibilityLabel="Bilby organizing receipts" />
            </View>
            <View style={styles.timeline}>
              <View style={styles.rail} accessible={false}>
                <View style={styles.dot} />
                <View style={styles.connector} />
                <View style={styles.endDot} />
              </View>
              <View style={styles.receiptColumn}>
                <View style={styles.receipt}>
                  <View style={styles.receiptTitle}>
                    <Icon name="activity" size={21} color={colors.primary} />
                    <Text variant="bodyStrong">Your first payment</Text>
                  </View>
                  <View style={styles.receiptRule} />
                  <Muted variant="small">Once you send or receive money, the details will appear here.</Muted>
                </View>
                <Muted variant="small">Amounts, people and payment status. Easy to find when you need them.</Muted>
              </View>
            </View>
          </View>
        )
      }
      ListFooterComponent={more.loading ? <ActivityIndicator color={colors.brown} /> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl, gap: space.xs },
  empty: { gap: space.xl, paddingTop: space.lg },
  emptyHeading: { flexDirection: "row", alignItems: "center", gap: space.md },
  emptyWords: { flex: 1, gap: space.sm },
  timeline: { flexDirection: "row", gap: space.lg },
  rail: { width: 12, alignItems: "center", paddingTop: space.xl, paddingBottom: 30 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.primarySoft, borderWidth: 2, borderColor: colors.primary },
  connector: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: space.sm },
  endDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.line },
  receiptColumn: { flex: 1, gap: space.lg },
  receipt: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: space.lg, gap: space.md },
  receiptTitle: { flexDirection: "row", alignItems: "center", gap: space.sm },
  receiptRule: { borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line },
});
