// glossary-allow-file — adding money from elsewhere has to name where it comes from ("USDC on Base") and
// show the one-time address to send to; everything else stays in plain dollars.
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { api } from "../api";
import type { TopupOrigin, TopupQuote, TopupStatus } from "../api/types";
import { usd } from "../money/amount";
import { Button } from "../ui/Button";
import { Card, Line, SectionTitle } from "../ui/Card";
import { ErrorNote, Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

const AMOUNTS = ["10000000", "25000000", "50000000", "100000000"];

/** Add money from another account (Aurora Intents): pick where from, how much, send to a one-time address. */
export default function TopUp() {
  const [origins, setOrigins] = useState<TopupOrigin[]>([]);
  const [origin, setOrigin] = useState<TopupOrigin | null>(null);
  const [amount, setAmount] = useState(AMOUNTS[1]!);
  const [quote, setQuote] = useState<TopupQuote | null>(null);
  const [status, setStatus] = useState<TopupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .topupOrigins()
      .then(({ origins }) => {
        setOrigins(origins);
        setOrigin(origins[0] ?? null);
      })
      .catch(setError);
  }, []);

  // Poll until it lands (or comes back).
  useEffect(() => {
    if (!quote) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = await api.topupStatus(quote.quoteId);
        if (!alive) return;
        setStatus(s);
        if (s.status === "completed") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      } catch (e) {
        if (alive) setError(e);
      }
    };
    void tick();
    const timer = setInterval(() => {
      if (status?.status === "completed" || status?.status === "refunded" || status?.status === "failed") return;
      void tick();
    }, 3_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [quote, status?.status]);

  const start = async () => {
    if (!origin) return;
    setBusy(true);
    setError(null);
    try {
      setQuote(await api.topupQuote(origin.id, amount));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!quote) return;
    await Clipboard.setStringAsync(quote.depositAddress);
    setCopied(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  if (quote && origin) {
    const done = status?.status === "completed";
    return (
      <Screen footer={<Button label={done ? "Done" : "I'll come back later"} variant={done ? "primary" : "secondary"} onPress={() => router.back()} />}>
        {done ? (
          <Notice tone="success" title={`${usd(status?.amountOut ?? quote.amountOut)} added`} message="It's in your balance now." />
        ) : (
          <>
            <Text variant="title">
              Send {usd(quote.amountIn)} {origin.label}
            </Text>
            <Muted>Send it from any app that holds your {origin.symbol}. It shows up in your BilbyPay balance, usually within a minute.</Muted>
            <Card>
              <Muted variant="small">Send to this one-time address</Muted>
              <Text selectable style={styles.address}>
                {quote.depositAddress}
              </Text>
              {quote.depositMemo ? <Line label="Memo" value={quote.depositMemo} /> : null}
              <Button compact variant="secondary" label={copied ? "Copied" : "Copy"} onPress={copy} />
            </Card>
            <Card tone="sand">
              <Line label="You'll get about" value={usd(quote.amountOut)} strong />
              <Line label="At least" value={usd(quote.minAmountOut)} />
              <Line label="Use this address before" value={new Date(quote.expiresAt).toLocaleTimeString()} />
            </Card>
            <Notice tone="warning" message={`Only send ${origin.label}. Anything else sent here can't be added to your balance.`} />
            {status ? <Muted style={{ textAlign: "center" }}>{status.message}</Muted> : null}
          </>
        )}
        <ErrorNote error={error} />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label="Continue" busyLabel="Getting your address…" onPress={start} disabled={!origin || busy} />}>
      <Text variant="title">Add money from another account</Text>
      <Muted>Move dollars you already hold elsewhere into BilbyPay.</Muted>
      <SectionTitle>From</SectionTitle>
      <View style={styles.list}>
        {origins.map((o) => (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: origin?.id === o.id }}
            onPress={() => setOrigin(o)}
            style={[styles.option, origin?.id === o.id && styles.selected]}
          >
            <Text variant="bodyStrong">{o.label}</Text>
          </Pressable>
        ))}
      </View>
      <SectionTitle>Amount</SectionTitle>
      <View style={styles.chips}>
        {AMOUNTS.map((a) => (
          <Pressable key={a} accessibilityRole="radio" accessibilityState={{ selected: amount === a }} onPress={() => setAmount(a)} style={[styles.chip, amount === a && styles.selected]}>
            <Text variant="bodyStrong">{usd(a)}</Text>
          </Pressable>
        ))}
      </View>
      <ErrorNote error={error} onRetry={start} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  address: { fontFamily: "Menlo", fontSize: 14, marginVertical: space.sm },
  list: { gap: space.sm },
  option: { padding: space.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: { paddingVertical: space.md, paddingHorizontal: space.xl, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.line },
  selected: { borderColor: colors.brown, backgroundColor: colors.sand },
});
