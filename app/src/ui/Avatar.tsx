import { Image, StyleSheet, View } from "react-native";
import { Text } from "./Text";
import { colors } from "./theme";

const TINTS = [colors.blueSoft, colors.goldSoft, colors.greenSoft, colors.redSoft, colors.sand];

export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "#";
  return (parts[0]![0]! + (parts.length > 1 ? parts[parts.length - 1]![0]! : "")).toUpperCase();
}

function tint(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function Avatar({ name, size = 44, emoji }: { name: string; size?: number; emoji?: string }) {
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: tint(name) }]}>
      <Text variant={size > 50 ? "title" : "bodyStrong"} color={colors.brown}>
        {emoji ?? initials(name)}
      </Text>
    </View>
  );
}

/** Brand logo from the catalog, or a lettered tile when there's no image. */
export function BrandLogo({ name, uri, size = 56 }: { name: string; uri?: string; size?: number }) {
  if (uri) {
    return <Image source={{ uri }} accessibilityLabel={name} style={{ width: size, height: size, borderRadius: size / 4, backgroundColor: colors.white }} />;
  }
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size / 4, backgroundColor: tint(name) }]}>
      <Text variant={size > 50 ? "title" : "bodyStrong"} color={colors.brown}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  tile: { alignItems: "center", justifyContent: "center" },
});
