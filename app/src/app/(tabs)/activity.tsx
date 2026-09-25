import { useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { api } from "../../api";
import type { ActivityItem } from "../../api/types";
import { rememberActivity } from "../../flows/drafts";
import { useLoad } from "../../state/useLoad";
import { ActivityRow } from "../../ui/ActivityRow";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Muted } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

export default function Activity() {
  const [more, setMore] = useState<{ items: ActivityItem[]; cursor?: string; loading: boolean; error?: unknown }>({ items: [], loading: false });
  const { data, error, loading, refreshing, refresh, reload } = useLoad(async () => {
    const page = await api.activity();
    rememberActivity(page.items);
    setMore({ items: [], cursor: page.nextCursor, loading: false });
    return page;
  });

  const items = [...(data?.items ?? []), ...more.items];

  const loadMore = async () => {
    if (!more.cursor || more.loading) return;
    setMore((m) => ({ ...m, loading: true }));
    try {
      const page = await api.activity(more.cursor);
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
            <Mascot size={140} />
            <Muted style={{ textAlign: "center" }}>Payments you send and receive show up here.</Muted>
          </View>
        )
      }
      ListFooterComponent={more.loading ? <ActivityIndicator color={colors.brown} /> : null}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: space.xl, gap: space.xs },
  empty: { alignItems: "center", gap: space.lg, paddingTop: space.xxl },
});
