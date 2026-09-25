import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { api } from "../../api";
import type { Brand, Quote } from "../../api/types";
import { CHOICE_ID, putDraft, putGift } from "../../flows/drafts";
import { displayTyped, isPositive, typedToBase, usd, usdShort } from "../../money/amount";
import { useLoad } from "../../state/useLoad";
import { BrandLogo } from "../../ui/Avatar";
import { Button } from "../../ui/Button";
import { DESIGNS, GiftFace } from "../../ui/GiftDesign";
import { Keypad } from "../../ui/Keypad";
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
  const { data: catalog, error: catalogError, reload } = useLoad(() => (choice ? Promise.resolve(null) : api.catalog()), [brandId]);
  const brand = useMemo(() => catalog?.brands.find((b) => b.id === brandId) ?? null, [catalog, brandId]);

  const [amount, setAmount] = useState<string>("0");
  const [custom, setCustom] = useState<string | null>(null);
  const [design, setDesign] = useState<string>(DESIGNS[0].id);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<unknown>(null);

  const value = custom !== null ? typedToBase(custom) : amount;
  const min = brand ? BigInt(brand.minAmount) : CHOICE_RANGE.min;
  const max = brand ? BigInt(brand.maxAmount) : CHOICE_RANGE.max;
  const inRange = isPositive(value) && BigInt(value) >= min && BigInt(value) <= max && (!brand?.denominations?.length || brand.denominations.includes(value));
  const name = choice ? "Their choice" : brand?.name ?? "";

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
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
        <ErrorNote error={catalogError} onRetry={reload} />
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
          <Button label="Send to a contact" disabled={!inRange || unavailable} onPress={sendToContact} />
          {!choice ? <Button variant="secondary" label="Buy for me" disabled={!inRange || unavailable} onPress={buyForMe} /> : null}
        </>
      }
    >
      <View style={styles.header}>
        <BrandLogo name={choice ? "🎁" : name} uri={brand?.logoUrl} size={56} />
        <View style={{ flex: 1 }}>
          <Text variant="title">{choice ? "Let them choose" : name}</Text>
          <Muted variant="small">
            {usdShort(String(min))}–{usdShort(String(max))}
            {choice ? " · they pick the brand when they open it" : ""}
          </Muted>
        </View>
      </View>

      {unavailable ? <Notice tone="warning" message={`${name} cards are temporarily unavailable. Pick another brand?`} /> : null}

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
      {quote && inRange ? (
        <Muted>
          You pay {usd(quote.price)}
          {quote.price !== quote.amount ? " (includes a small service fee)" : ""}
        </Muted>
      ) : null}
      <ErrorNote error={quoteError} />

      <Text variant="heading">Card design (for gifts)</Text>
      <View style={styles.chips}>
        {DESIGNS.map((d) => (
          <Chip key={d.id} label={`${d.emoji} ${d.label}`} on={design === d.id} onPress={() => setDesign(d.id)} />
        ))}
      </View>
      <TextInput
        accessibilityLabel="Message"
        value={message}
        onChangeText={setMessage}
        placeholder="Add a message (optional)"
        placeholderTextColor={colors.muted}
        style={styles.input}
        maxLength={120}
        multiline
      />
      {inRange ? <GiftFace design={design} brandName={choice ? undefined : name} amount={value} message={message.trim() || undefined} /> : null}
    </Screen>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={[styles.chip, on && { backgroundColor: colors.brown, borderColor: colors.brown }]}
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
  chip: { minHeight: 44, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.sandDeep, justifyContent: "center", backgroundColor: colors.surface },
  input: { minHeight: 56, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, fontSize: 16, color: colors.ink },
});
