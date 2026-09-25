import { Pressable, StyleSheet, View } from "react-native";
import type { Brand } from "../api/types";
import { BrandLogo } from "./Avatar";
import { Text } from "./Text";
import { colors, radius, shadow, space } from "./theme";

export function BrandGrid({ brands, onPick, selected }: { brands: Brand[]; onPick: (b: Brand) => void; selected?: string | null }) {
  return (
    <View style={styles.grid}>
      {brands.map((b) => (
        <Pressable
          key={b.id}
          accessibilityRole="button"
          accessibilityLabel={b.available ? b.name : `${b.name}, temporarily unavailable`}
          accessibilityState={{ disabled: !b.available, selected: selected === b.id }}
          disabled={!b.available}
          onPress={() => onPick(b)}
          style={({ pressed }) => [styles.tile, selected === b.id && styles.selected, (!b.available || pressed) && { opacity: b.available ? 0.85 : 0.5 }]}
        >
          <BrandLogo name={b.name} uri={b.logoUrl} size={56} />
          <Text variant="bodyStrong" numberOfLines={1}>
            {b.name}
          </Text>
          <Text variant="caption" color={colors.muted} numberOfLines={1}>
            {b.available ? b.category ?? " " : "Temporarily unavailable"}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: { width: "47%", flexGrow: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.sm, alignItems: "flex-start", ...shadow },
  selected: { borderWidth: 2, borderColor: colors.brown },
});
