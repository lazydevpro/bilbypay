import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { colors, space } from "./theme";

/** A tappable list row: leading visual, title/subtitle, trailing value. */
export function Row({
  leading,
  title,
  subtitle,
  trailing,
  trailingSub,
  onPress,
  trailingColor,
}: {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: string;
  trailingSub?: string;
  trailingColor?: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      {leading}
      <View style={styles.middle}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="small" color={colors.muted} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing || trailingSub ? (
        <View style={styles.trailing}>
          {trailing ? (
            <Text variant="bodyStrong" color={trailingColor}>
              {trailing}
            </Text>
          ) : null}
          {trailingSub ? (
            <Text variant="caption" color={colors.muted}>
              {trailingSub}
            </Text>
          ) : null}
        </View>
      ) : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 60, paddingVertical: space.sm },
  middle: { flex: 1, gap: 2 },
  trailing: { alignItems: "flex-end", gap: 2 },
});
