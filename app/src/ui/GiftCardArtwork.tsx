import { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Icon } from "./Icon";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

type Props = { name: string; artworkUrl?: string; logoUrl?: string };

/** Merchant art is an intact image: no crop, tint, rotation, badges, or Bilby overlays. */
export function GiftCardArtwork({ name, artworkUrl, logoUrl }: Props) {
  const [failed, setFailed] = useState<string[]>([]);
  const uri = [artworkUrl, logoUrl].find((url) => url && !failed.includes(url));

  return (
    <View style={styles.frame} accessible accessibilityRole="image" accessibilityLabel={`${name} gift card`}>
      {uri ? (
        <Image
          key={uri}
          source={{ uri }}
          resizeMode="contain"
          accessible={false}
          style={styles.image}
          onError={() => setFailed((urls) => [...urls, uri])}
        />
      ) : (
        <View style={styles.fallback}>
          <Icon name="gift" size={28} color={colors.muted} />
          <Text variant="small" style={styles.name} numberOfLines={2}>{name}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The reserved space prevents image downloads from shifting the catalogue.
  // Padding leaves clear space around the complete merchant-supplied image.
  frame: { width: "100%", aspectRatio: 1.586, borderRadius: radius.md, backgroundColor: colors.white, padding: space.md, justifyContent: "center", alignItems: "center" },
  image: { width: "100%", height: "100%" },
  fallback: { gap: space.sm, alignItems: "center", justifyContent: "center" },
  name: { textAlign: "center" },
});
