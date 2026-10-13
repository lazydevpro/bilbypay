import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { api } from "../api";
import { amountProblem, fundingAttempt, isAttemptId, type FundingAttempt } from "../funding/checkout";
import { baseToTyped, typedToBase, usd, usdShort } from "../money/amount";
import { formatE164 } from "../phone/phone";
import { useSession } from "../state/session";
import { useLoad } from "../state/useLoad";
import { ErrorNote, Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Mascot } from "../ui/Mascot";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

const PRESETS = ["25", "50", "100"];

export default function TopUp() {
  const params = useLocalSearchParams<{ amount?: string; attempt?: string }>();
  const { profile } = useSession();
  const options = useLoad(() => api.fundingOptions());
  const number = useLoad(() => api.phoneStatus());
  const [typed, setTyped] = useState(() => typeof params.amount === "string" && /^\d{1,13}$/.test(params.amount) ? baseToTyped(params.amount) : "50");
  const [touched, setTouched] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const returnUrl = Linking.createURL("funding");
  const attempt = useRef<FundingAttempt | null>(isAttemptId(params.attempt) && typeof params.amount === "string"
    ? { amount: params.amount, returnUrl, idempotencyKey: params.attempt }
    : null);
  const amount = typedToBase(typed);
  const limits = options.data?.available ? options.data : null;
  const problem = limits ? amountProblem(typed, limits.minAmount, limits.maxAmount) : null;
  const available = !!limits?.available && !options.error;
  const canReceive = !number.error && number.data?.status === "active" && number.data.phone === profile?.phone;

  const choose = (value: string) => {
    if (busy || !/^\d{0,7}(?:\.\d{0,2})?$/.test(value)) return;
    setTyped(value);
    setError(null);
  };

  const review = async () => {
    setTouched(true);
    if (!available || problem) return;
    setError(null);
    setBusy(true);
    try {
      attempt.current = fundingAttempt(attempt.current, amount, returnUrl, () => Crypto.randomUUID());
      // Keep the request identity on reload as well as on a network retry.
      router.setParams({ amount, attempt: attempt.current.idempotencyKey });
      const session = await api.createFundingSession(attempt.current);
      router.push({ pathname: "/funding", params: { id: session.id } });
    } catch (e) {
      setError(e);
    } finally { setBusy(false); }
  };

  return (
    <Screen footer={<Button label={options.loading ? "Checking card payments…" : available ? "Review practice payment" : "Card preview unavailable"} busyLabel="Preparing your preview…" disabled={!available || !!problem || busy} onPress={review} />}>
      <View style={styles.hero}>
        <View style={styles.heroCopy}>
          <Text variant="display">A little boost.</Text>
          <Muted>A card payment preview, with Bilby by your side.</Muted>
        </View>
        <Mascot size={112} mood={busy ? "thinking" : "receiving"} accessibilityLabel="Bilby ready to receive" />
      </View>
      <Notice tone="warning" title="Sandbox preview" message="No real money moves. This practice checkout does not add money to your BilbyPay balance." />

      <Card style={styles.amountCard}>
        <Text variant="bodyStrong">Amount in US dollars</Text>
        <View style={[styles.amountInput, focused && styles.amountFocused]}>
          <Text variant="hero" color={colors.muted}>$</Text>
          <TextInput
            accessibilityLabel="Amount in US dollars"
            accessibilityHint="Enter dollars and cents for a practice payment"
            aria-invalid={touched && !!problem}
            value={typed}
            onChangeText={choose}
            keyboardType="decimal-pad"
            inputMode="decimal"
            autoComplete="off"
            editable={!busy}
            placeholder="50"
            placeholderTextColor={colors.muted}
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); setTouched(true); }}
            onSubmitEditing={() => { void review(); }}
            style={styles.input}
            maxLength={10}
          />
          <Text variant="small" color={colors.muted}>USD</Text>
        </View>
        <View style={styles.presets}>
          {PRESETS.map(value => <Button key={value} compact label={usdShort(typedToBase(value))} accessibilityHint={`Set the practice amount to ${value} dollars`} variant={amount === typedToBase(value) ? "primary" : "secondary"} disabled={busy} onPress={() => choose(value)} style={styles.preset} />)}
        </View>
        {touched && problem ? <Text accessibilityRole="alert" variant="small" color={colors.red}>{problem}</Text> : limits ? <Muted variant="small">From {usd(limits.minAmount)} to {usd(limits.maxAmount)} per preview.</Muted> : <Muted variant="small">{options.loading ? "Checking the available amount range…" : "Available amounts will appear when card payments are ready."}</Muted>}
      </Card>

      <View style={styles.method}>
        <View style={styles.methodHeading}>
          <Text variant="heading">Pay by card</Text>
          <View style={styles.provider}><Text variant="caption" color={colors.primaryDeep}>via Ramp</Text></View>
        </View>
        <Muted variant="small">Ramp shows the payment methods available to you and the final fees before you confirm. Timing depends on the method you choose.</Muted>
        {options.loading ? <View accessibilityLabel="Checking card payment availability" style={styles.loading}><View style={styles.skeletonLong} /><View style={styles.skeletonShort} /></View> : options.error ? <Notice tone="warning" message="We couldn't check card payments. Try again in a moment." action={{ label: "Check again", onPress: options.reload }} /> : !available ? <Notice title="Card payments are being set up" message="The practice checkout isn't available yet. You can still receive money from a friend." action={{ label: "Check again", onPress: options.reload }} /> : null}
        <Muted variant="small">Bank deposits aren&apos;t available yet.</Muted>
      </View>
      <ErrorNote error={error} onRetry={available ? review : undefined} />

      <Card tone="sand">
        <View style={styles.friendHeading}>
          <View style={styles.friendIcon}><Icon name="receive" size={22} color={colors.primaryDeep} /></View>
          <View style={styles.friendCopy}><Text variant="bodyStrong">Receive from a friend</Text><Muted variant="small">Already using BilbyPay? They just need your number.</Muted></View>
        </View>
        {canReceive && profile ? <Text variant="heading" selectable>{formatE164(profile.phone)}</Text> : number.error ? <Muted variant="small">We couldn&apos;t check your number. Check it before asking a friend to send money.</Muted> : number.loading ? <Muted variant="small">Checking your number…</Muted> : <Muted variant="small">Check your number to receive payments.</Muted>}
        <Button variant="secondary" compact label={canReceive ? "Show my number" : "Check my number"} disabled={number.loading || busy} onPress={() => router.push(canReceive ? "/receive" : "/settings/phone")} />
      </Card>

      <Card tone="sand">
        <View style={styles.friendHeading}>
          <View style={styles.friendIcon}><Icon name="receive" size={22} color={colors.primaryDeep} /></View>
          <View style={styles.friendCopy}><Text variant="bodyStrong">Add from another account</Text><Muted variant="small">Move dollars you hold somewhere else into BilbyPay.</Muted></View>
        </View>
        <Button variant="secondary" compact label="Add from another account" disabled={busy} onPress={() => router.push("/topup-other")} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "center", gap: space.sm },
  heroCopy: { flex: 1, gap: space.sm },
  amountCard: { padding: space.xl, gap: space.lg },
  amountInput: { flexDirection: "row", alignItems: "center", gap: space.sm, borderBottomWidth: 2, borderBottomColor: colors.line, paddingBottom: space.sm },
  amountFocused: { borderBottomColor: colors.primary },
  input: { flex: 1, minWidth: 0, minHeight: 60, paddingVertical: space.sm, fontSize: 48, fontFamily: "Nunito_800ExtraBold", color: colors.ink },
  presets: { flexDirection: "row", gap: space.sm },
  preset: { flex: 1, paddingHorizontal: space.sm },
  method: { gap: space.md, paddingVertical: space.sm },
  methodHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  provider: { paddingHorizontal: space.md, paddingVertical: space.xs, backgroundColor: colors.primarySoft, borderRadius: radius.pill },
  loading: { minHeight: 76, backgroundColor: colors.sand, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  skeletonLong: { height: 12, width: "80%", borderRadius: radius.sm, backgroundColor: colors.sandDeep },
  skeletonShort: { height: 12, width: "55%", borderRadius: radius.sm, backgroundColor: colors.sandDeep },
  friendHeading: { flexDirection: "row", alignItems: "center", gap: space.md },
  friendIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
  friendCopy: { flex: 1, gap: space.xs },
});
