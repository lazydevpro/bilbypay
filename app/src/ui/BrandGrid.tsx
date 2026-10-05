import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Brand } from "../api/types";
import { usdShort } from "../money/amount";
import { GiftCardArtwork } from "./GiftCardArtwork";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

export function BrandGrid({ brands, onPick, selected }: { brands: Brand[]; onPick: (b: Brand) => void; selected?: string | null }) {
  const [focused, setFocused] = useState<string | null>(null);
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
          onFocus={() => setFocused(b.id)}
          onBlur={() => setFocused(null)}
          style={({ pressed }) => [styles.tile, selected === b.id && styles.selected, focused === b.id && styles.focused, pressed && styles.pressed]}
        >
          <GiftCardArtwork name={b.name} artworkUrl={b.artworkUrl} logoUrl={b.logoUrl} />
          <View style={styles.caption}>
            <View style={styles.nameRow}>
              <Text variant="bodyStrong" numberOfLines={1} style={styles.name}>{b.name}</Text>
              {selected === b.id ? <Icon name="check" size={16} color={colors.primary} /> : null}
            </View>
            <Text variant="caption" color={colors.muted}>{b.available ? `${usdShort(b.minAmount)}–${usdShort(b.maxAmount)}` : "Temporarily unavailable"}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  tile: { width: "47%", flexGrow: 1, flexBasis: "45%", maxWidth: 360, borderRadius: radius.md, borderWidth: 2, borderColor: "transparent", gap: space.sm, paddingBottom: space.md },
  caption: { paddingHorizontal: space.xs, gap: space.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.xs },
  name: { flex: 1 },
  selected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  focused: { borderColor: colors.brown },
  pressed: { backgroundColor: colors.sand },
});
