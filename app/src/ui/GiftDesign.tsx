import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, G, Path, Rect } from "react-native-svg";
import { isPositive, usd } from "../money/amount";
import { GiftCardArtwork } from "./GiftCardArtwork";
import { Mascot } from "./Mascot";
import { Text } from "./Text";
import { colors, radius, space } from "./theme";

export const DESIGNS = [
  { id: "thanks", label: "Thank you", bg: colors.sage },
  { id: "birthday", label: "Happy birthday", bg: colors.apricot },
  { id: "love", label: "Sending love", bg: colors.blueSoft },
  { id: "congrats", label: "Congrats", bg: colors.goldSoft },
] as const;

export const designFor = (id?: string) => DESIGNS.find((d) => d.id === id) ?? DESIGNS[0];

/** Occasion artwork stays crisp on native and web. These are illustrations, not brand logos. */
export function GiftArt({ design, size = 180 }: { design?: string; size?: number }) {
  const d = designFor(design);
  return (
    <Svg width={size} height={size * 0.75} viewBox="0 0 240 180" aria-hidden>
      <Ellipse cx="120" cy="157" rx="91" ry="12" fill={colors.brown} opacity={0.07} />
      <Circle cx="51" cy="31" r="4" fill={colors.gold} />
      <Circle cx="199" cy="72" r="3" fill={colors.red} opacity={0.6} />
      <Path d="M187 27v14m-7-7h14M40 101v12m-6-6h12" stroke={colors.gold} strokeWidth="4" strokeLinecap="round" />
      {d.id === "thanks" ? (
        <>
          <G stroke={colors.green} strokeWidth="3" strokeLinecap="round">
            <Path d="M53 142C30 116 33 90 29 72M190 148c13-24 15-43 15-63" fill="none" />
            <Ellipse cx="36" cy="95" rx="7" ry="16" fill={colors.green} transform="rotate(-38 36 95)" opacity={0.65} />
            <Ellipse cx="42" cy="121" rx="8" ry="17" fill={colors.green} transform="rotate(-50 42 121)" opacity={0.65} />
            <Ellipse cx="198" cy="112" rx="7" ry="16" fill={colors.green} transform="rotate(34 198 112)" opacity={0.65} />
          </G>
          <Path d="M90 54c-13-16 13-17 0-34m28 34c-13-16 13-17 0-34m28 34c-13-16 13-17 0-34" stroke={colors.surface} strokeWidth="7" strokeLinecap="round" fill="none" />
          <Path d="M157 84h12c27 0 26 39-5 39h-9" stroke={colors.sandDeep} strokeWidth="13" fill="none" />
          <Path d="M69 73h96l-7 48c-3 25-72 26-78 0z" fill={colors.bg} />
          <Ellipse cx="117" cy="75" rx="48" ry="15" fill={colors.sandDeep} />
          <Ellipse cx="117" cy="75" rx="39" ry="9" fill={colors.brownSoft} />
          <Path d="M83 99l3 15" stroke={colors.sand} strokeWidth="5" strokeLinecap="round" />
          <Circle cx="182" cy="143" r="20" fill={colors.gold} />
          <Circle cx="174" cy="137" r="3" fill={colors.brownSoft} /><Circle cx="190" cy="141" r="3" fill={colors.brownSoft} /><Circle cx="180" cy="153" r="3" fill={colors.brownSoft} />
        </>
      ) : d.id === "birthday" ? (
        <>
          <Rect x="63" y="103" width="115" height="46" rx="10" fill={colors.red} opacity={0.78} />
          <Rect x="73" y="66" width="95" height="46" rx="10" fill={colors.gold} />
          <Path d="M73 78h95v17c-8 10-17-10-24-1s-13 10-22-1-14 11-23 1-15 6-26-1z" fill={colors.bg} />
          <Path d="M63 114h115v15c-10 9-18-11-26-1s-17 8-25-1-14 10-24 0-17 9-26-1-10 6-14 1z" fill={colors.bg} />
          <Rect x="113" y="39" width="12" height="29" rx="3" fill={colors.primary} />
          <Path d="M119 14c-16 19-11 28 0 28s16-10 0-28z" fill={colors.gold} />
          <Path d="M119 28c-6 7-4 12 0 12s6-5 0-12z" fill={colors.red} />
          <Path d="M53 152h137" stroke={colors.bg} strokeWidth="8" strokeLinecap="round" />
          <Path d="M41 56l7 8m145 40 8-7m-47-63 3 9" stroke={colors.red} strokeWidth="5" strokeLinecap="round" />
        </>
      ) : d.id === "love" ? (
        <>
          <Rect x="54" y="68" width="133" height="84" rx="9" fill={colors.gold} />
          <Path d="m54 75 67 44 66-44" fill={colors.sandDeep} />
          <Rect x="76" y="43" width="89" height="74" rx="7" fill={colors.bg} transform="rotate(-8 120 80)" />
          <Path d="M119 65c-14-22-38 1 0 28 38-27 14-50 0-28z" fill={colors.red} />
          <Path d="m54 152 53-46c8-7 20-7 28 0l52 46" fill={colors.apricot} />
          <Path d="M47 40c-7-12-23 0 0 16 23-16 7-28 0-16zM194 49c-5-8-16 0 0 12 16-12 5-20 0-12z" fill={colors.red} opacity={0.6} />
        </>
      ) : (
        <>
          <Path d="m122 24 18 37 42 6-30 29 7 41-37-19-37 19 7-41-30-29 42-6z" fill={colors.gold} />
          <Path d="m108 63 14-28 7 31" fill={colors.bg} opacity={0.65} />
          <Path d="m97 126-12 32 36-19 36 19-10-32" fill={colors.red} />
          <Path d="M37 68l10 6m145-20-5 12M49 128l-8 10m155-22 9 6m-50-89 4-11" stroke={colors.primary} strokeWidth="6" strokeLinecap="round" />
          <Circle cx="174" cy="139" r="5" fill={colors.red} /><Circle cx="65" cy="35" r="5" fill={colors.red} />
        </>
      )}
    </Svg>
  );
}

/** The same card face appears while composing and when the recipient opens their real gift. */
export function GiftFace({ design, brandName, artworkUrl, logoUrl, amount, message, from, companion = true }: { design?: string; brandName?: string; artworkUrl?: string; logoUrl?: string; amount: string; message?: string; from?: string; companion?: boolean }) {
  const d = designFor(design);
  return (
    <View style={styles.face}>
      {brandName ? <View style={styles.merchantScene}>
        <View style={styles.merchantArt}><GiftCardArtwork name={brandName} artworkUrl={artworkUrl} logoUrl={logoUrl} /></View>
        <View style={styles.occasion}>
          {companion ? <Mascot size={80} mood="gift" interactive={false} backdrop={false} /> : null}
          <View style={[styles.occasionLabel, { backgroundColor: d.bg }]}><Text variant="bodyStrong">{d.label}</Text></View>
        </View>
      </View> : <View style={styles.scene}>
        {companion ? <View style={styles.bilby}><Mascot size={154} mood="gift" interactive={false} backdrop={false} /></View> : null}
        <View style={[styles.illustratedCard, { backgroundColor: d.bg }, !companion && styles.cardCentered]}>
          <GiftArt design={d.id} size={182} />
          <Text variant="title" style={styles.center}>{d.label}</Text>
          <View style={styles.ribbon} />
        </View>
      </View>}
      {isPositive(amount) ? <Text variant="display" style={styles.center} adjustsFontSizeToFit minimumFontScale={0.65} numberOfLines={1}>{usd(amount)}</Text> : <Text variant="heading" style={styles.center}>A little joy, from you</Text>}
      <Text variant="bodyStrong" style={styles.center}>{brandName ?? "Gift card of their choice"}</Text>
      {message ? <View style={styles.message}><Text style={styles.center}>“{message}”</Text></View> : null}
      {from ? <Text variant="small" color={colors.muted} style={styles.center}>From {from}, with love</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  face: { gap: space.sm, alignItems: "center" },
  merchantScene: { width: "100%", alignItems: "center", gap: space.sm, paddingTop: space.sm },
  merchantArt: { width: "100%", maxWidth: 320 },
  occasion: { flexDirection: "row", gap: space.md, alignItems: "center", justifyContent: "center" },
  occasionLabel: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  scene: { width: "100%", maxWidth: 380, minHeight: 234, paddingVertical: space.lg, justifyContent: "center", alignItems: "center" },
  bilby: { position: "absolute", left: 0, bottom: 12 },
  illustratedCard: { marginLeft: 64, width: "66%", maxWidth: 206, paddingBottom: space.lg, borderRadius: radius.xl, alignItems: "center", overflow: "hidden", transform: [{ rotate: "6deg" }], shadowColor: colors.brown, shadowOpacity: 0.1, shadowRadius: 8, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  cardCentered: { marginLeft: 0, transform: [{ rotate: "0deg" }] },
  ribbon: { position: "absolute", top: 16, right: -24, width: 95, height: 13, backgroundColor: colors.red, opacity: 0.75, transform: [{ rotate: "42deg" }] },
  center: { textAlign: "center", maxWidth: "100%" },
  message: { backgroundColor: colors.sand, borderRadius: radius.lg, paddingHorizontal: space.xl, paddingVertical: space.md, marginTop: space.xs, maxWidth: "100%" },
});
