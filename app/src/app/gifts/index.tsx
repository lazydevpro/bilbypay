import { router } from "expo-router";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";
import { api } from "../../api";
import { CHOICE_ID } from "../../flows/drafts";
import { useLoad } from "../../state/useLoad";
import { BrandGrid } from "../../ui/BrandGrid";
import { GiftArt } from "../../ui/GiftDesign";
import { Icon } from "../../ui/Icon";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

export default function Catalog() {
  const { data, error, loading, refreshing, refresh, reload } = useLoad(() => api.catalog());

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
      <View style={styles.hero}>
        <Text variant="caption" color={colors.muted} style={styles.eyebrow}>THE GIFT COUNTER</Text>
        <Text variant="display">Good things,{"\n"}wrapped.</Text>
        <Muted style={styles.subtitle}>A birthday, a thank you, or just because.</Muted>
        <View style={styles.scene}>
          <Svg width="100%" height="100%" viewBox="0 0 342 206" aria-hidden style={StyleSheet.absoluteFill}>
            <Path d="M0 172Q158 155 342 173V206H0Z" fill={colors.sandDeep} />
            <Path d="M0 181Q165 167 342 181" stroke={colors.bg} strokeWidth="3" fill="none" />
            <Ellipse cx="62" cy="175" rx="42" ry="8" fill={colors.brown} opacity={0.07} />
            <Rect x="19" y="147" width="34" height="24" rx="6" fill={colors.red} />
            <Ellipse cx="36" cy="147" rx="17" ry="7" fill={colors.apricot} />
            <Ellipse cx="36" cy="146" rx="6" ry="3" fill={colors.red} />
            <Path d="M49 163c51 32 37-25 79-10" stroke={colors.red} strokeWidth="6" fill="none" strokeLinecap="round" />
            <Circle cx="135" cy="169" r="4" fill={colors.gold} />
          </Svg>
          <View style={styles.backCard}><GiftArt design="birthday" size={108} /></View>
          <View style={styles.card}><GiftArt design="love" size={124} /></View>
          <View style={styles.bilby}><Mascot size={180} mood="gift" backdrop={false} /></View>
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={() => router.push(`/gifts/${CHOICE_ID}`)} style={({ pressed }) => [styles.choice, pressed && { opacity: 0.8 }]}>
        <View style={styles.choiceIcon}><Icon name="gift" color={colors.primary} size={28} /></View>
        <View style={styles.choiceText}>
          <Text variant="heading">Let them choose</Text>
          <Muted variant="small">They pick a brand when they open it.</Muted>
        </View>
        <Icon name="chevron" color={colors.brown} size={20} />
      </Pressable>
      <View style={styles.section}>
        <Text variant="title">Find their favourite</Text>
        <Muted variant="small">Send to a phone number, or treat yourself.</Muted>
      </View>
      <ErrorNote error={error} onRetry={reload} />
      {loading && !data ? <ActivityIndicator color={colors.primary} accessibilityLabel="Loading gift cards" /> : null}
      {data?.brands.length ? <BrandGrid brands={data.brands} onPick={(b) => router.push(`/gifts/${b.id}`)} /> : data ? <Muted>There are no gift cards available right now. Please check back soon.</Muted> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: space.sm, gap: space.sm },
  eyebrow: { letterSpacing: 1.5 },
  subtitle: { maxWidth: 250 },
  scene: { height: 206, marginTop: -space.sm, overflow: "hidden", borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  backCard: { position: "absolute", left: "8%", bottom: 45, backgroundColor: colors.sage, borderRadius: radius.md, transform: [{ rotate: "-17deg" }], paddingVertical: space.sm },
  card: { position: "absolute", left: "13%", bottom: 35, backgroundColor: colors.blueSoft, borderRadius: radius.md, transform: [{ rotate: "-4deg" }], paddingVertical: space.sm },
  bilby: { position: "absolute", right: space.sm, bottom: 18 },
  choice: { flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line },
  choiceIcon: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  choiceText: { flex: 1, gap: space.xs },
  section: { gap: space.xs, marginTop: space.sm },
});
