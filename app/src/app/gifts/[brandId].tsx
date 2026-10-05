import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import { api } from "../../api";
import type { Brand, Quote } from "../../api/types";
import { CHOICE_ID, putDraft, putGift } from "../../flows/drafts";
import { displayTyped, isPositive, typedToBase, usd, usdShort } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { Button } from "../../ui/Button";
import { DESIGNS, GiftArt, GiftFace } from "../../ui/GiftDesign";
import { Keypad } from "../../ui/Keypad";
import { Icon } from "../../ui/Icon";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote, Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, radius, space } from "../../ui/theme";

const USD = 1_000_000n;
const CHOICE_RANGE = { min: 5n * USD, max: 500n * USD };

function suggestions(brand: Brand | null): string[] {
  if (brand?.denominations?.length) return brand.denominations;
  const min = brand ? BigInt(brand.minAmount) : CHOICE_RANGE.min;
  const max = brand ? BigInt(brand.maxAmount) : CHOICE_RANGE.max;
  return [10n, 25n, 50n, 100n].map((d) => d * USD).filter((v) => v >= min && v <= max).map(String);
}

export default function BrandScreen() {
  const { brandId = "" } = useLocalSearchParams<{ brandId: string }>();
  const choice = brandId === CHOICE_ID;
  const { data: catalog, error: catalogError, loading, reload } = useLoad(() => (choice ? Promise.resolve(null) : api.catalog()), [brandId]);
  const brand = useMemo(() => catalog?.brands.find((b) => b.id === brandId) ?? null, [catalog, brandId]);

  const [amount, setAmount] = useState<string>("0");
  const [custom, setCustom] = useState<string | null>(null);
  const [design, setDesign] = useState<string>(DESIGNS[0].id);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);
  const [preview, setPreview] = useState(false);

  const value = custom !== null ? typedToBase(custom) : amount;
  const min = brand ? BigInt(brand.minAmount) : CHOICE_RANGE.min;
  const max = brand ? BigInt(brand.maxAmount) : CHOICE_RANGE.max;
  const inRange = isPositive(value) && BigInt(value) >= min && BigInt(value) <= max && (!brand?.denominations?.length || brand.denominations.includes(value));
  const name = choice ? "Their choice" : brand?.name ?? "";

  useEffect(() => {
    // Never display the previous amount's provider price while its replacement quote is debouncing.
    /* eslint-disable react-hooks/set-state-in-effect */
    setQuote(null);
    setQuoteError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (choice || !brand || !inRange) return;
    let alive = true;
    const t = setTimeout(() => {
      api
        .quote(brand.id, value)
        .then((q) => alive && setQuote(q))
        .catch((e) => alive && setQuoteError(e));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [choice, brand, value, inRange]);

  if (!choice && !brand) {
    return (
      <Screen>
        <Mascot size={180} mood={catalogError || !loading ? "reassuring" : "thinking"} interactive={false} />
        {loading ? <ActivityIndicator color={colors.primary} /> : null}
        <ErrorNote error={catalogError} onRetry={reload} />
        {!loading && !catalogError ? <Notice message="We couldn't find this gift card. Choose another brand." action={{ label: "Browse gift cards", onPress: () => router.replace("/gifts") }} /> : null}
      </Screen>
    );
  }

  const unavailable = brand?.available === false || quote?.available === false;

  const sendToContact = () => {
    const gift = putGift({ brandId: choice ? null : brand!.id, brandName: name, amount: value, design, message: message.trim() || undefined });
    router.push({ pathname: "/send", params: { mode: "gift", gift } });
  };
  const buyForMe = () => {
    const draft = putDraft({ request: { type: "gift_buy", params: { brandId: brand!.id, amount: value } }, gift: { brandId: brand!.id, brandName: name, amount: value } });
    router.push({ pathname: "/confirm", params: { draft } });
  };

  return (
    <Screen
      footer={
        <>
          <Button label={preview ? "Choose who to send it to" : "Preview gift"} disabled={!inRange || unavailable} onPress={preview ? sendToContact : () => setPreview(true)} />
          {preview ? <Button variant="ghost" label="Keep editing" onPress={() => setPreview(false)} /> : !choice ? <Button variant="ghost" label="Buy for myself" disabled={!inRange || unavailable} onPress={buyForMe} /> : null}
        </>
      }
    >
      <Text variant="display">{preview ? "A little joy, ready to go" : "Make their day"}</Text>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text variant="heading">{choice ? "Let them choose" : name}</Text>
          <Muted variant="small">
            {usdShort(String(min))}–{usdShort(String(max))}
            {choice ? " · they pick the brand when they open it" : ""}
          </Muted>
        </View>
      </View>

      {unavailable ? <Notice tone="warning" message={`${name} cards are temporarily unavailable. Pick another brand?`} /> : null}

      <GiftFace design={design} brandName={choice ? undefined : name} artworkUrl={brand?.artworkUrl} logoUrl={brand?.logoUrl} amount={value} message={preview ? message.trim() || undefined : undefined} />

      {!preview ? <>

      <Text variant="heading">Amount</Text>
      <View style={styles.chips}>
        {suggestions(brand).map((s) => (
          <Chip
            key={s}
            label={usdShort(s)}
            on={custom === null && amount === s}
            onPress={() => {
              setCustom(null);
              setAmount(s);
            }}
          />
        ))}
        {!brand?.denominations?.length ? <Chip label="Other" on={custom !== null} onPress={() => setCustom("")} /> : null}
      </View>
      {custom !== null ? (
        <View style={{ gap: space.sm }}>
          <Text variant="display" style={{ textAlign: "center" }}>
            {displayTyped(custom)}
          </Text>
          <Keypad value={custom} onChange={setCustom} />
        </View>
      ) : null}
      {isPositive(value) && !inRange ? (
        <Text variant="small" color={colors.red}>
          Choose between {usd(String(min))} and {usd(String(max))}.
        </Text>
      ) : null}
      </> : null}
      {quote && inRange ? (
        <Muted>
          You pay {usd(quote.price)}
          {quote.price !== quote.amount ? " (includes a small service fee)" : ""}
        </Muted>
      ) : null}
      {choice ? <Muted variant="small">You&apos;ll see the full price, including any fee, before you confirm.</Muted> : null}
      <ErrorNote error={quoteError} />

      {!preview ? <>
      <Text variant="heading">Pick a little feeling</Text>
      <View style={styles.designs}>
        {DESIGNS.map((d) => (
          <Pressable key={d.id} accessibilityRole="button" accessibilityLabel={d.label} accessibilityState={{ selected: design === d.id }} onPress={() => setDesign(d.id)} style={[styles.design, { backgroundColor: d.bg }, design === d.id && styles.selectedDesign]}>
            {design === d.id ? <View style={styles.designCheck}><Icon name="check" color={colors.white} size={12} /></View> : null}
            <GiftArt design={d.id} size={86} />
            <Text variant="caption" style={styles.designLabel}>{d.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.messageHeader}>
        <Text variant="heading">Your message</Text>
        <Muted variant="small">Optional</Muted>
      </View>
      <TextInput
        accessibilityLabel="Message"
        value={message}
        onChangeText={setMessage}
        placeholder="This one's on me."
        placeholderTextColor={colors.muted}
        style={styles.input}
        maxLength={120}
        multiline
      />
      <Muted variant="caption" style={styles.counter}>{message.length}/120</Muted>
      </> : null}
    </Screen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, on && { backgroundColor: colors.primary, borderColor: colors.primaryDeep }, pressed && { opacity: 0.8 }]}
    >
      <Text variant="bodyStrong" color={on ? colors.white : colors.brown}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", gap: space.md, alignItems: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { minHeight: 52, minWidth: 68, flexGrow: 1, paddingHorizontal: space.lg, borderRadius: radius.lg, borderBottomWidth: 3, borderColor: colors.line, alignItems: "center", justifyContent: "center", backgroundColor: colors.sand },
  designs: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  design: { flexGrow: 1, flexBasis: "44%", padding: space.sm, borderRadius: radius.lg, alignItems: "center", borderWidth: 2, borderColor: "transparent" },
  selectedDesign: { borderColor: colors.primary },
  designCheck: { position: "absolute", top: space.sm, right: space.sm, borderRadius: radius.pill, backgroundColor: colors.primary, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  designLabel: { textAlign: "center", fontWeight: "700" },
  messageHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  input: { minHeight: 112, textAlignVertical: "top", backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, fontSize: 16, color: colors.ink },
  counter: { textAlign: "right", marginTop: -space.sm },
});
