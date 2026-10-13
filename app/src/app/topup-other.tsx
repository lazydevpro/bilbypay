import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { api } from "../api";
import type { TopupOrigin, TopupQuote, TopupStatus } from "../api/types";
import { displayTyped, isPositive, typedToBase, usd } from "../money/amount";
import { useLoad } from "../state/useLoad";
import { Button } from "../ui/Button";
import { Card, Line } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Keypad } from "../ui/Keypad";
import { ErrorNote, Notice } from "../ui/Notice";
import { Row } from "../ui/Row";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

const POLL_MS = 5000;

/** "$12.50" without the $ sign, for "Send exactly 12.50 <symbol>". */
const plain = (base: string) => usd(base).slice(1);

/**
 * Add money you already hold on another network (server "Top-up", Aurora Intents): pick where it comes from and how
 * much, then send it to the one-time details shown. The server credits the balance once it arrives. Network and
 * currency names come from the server at runtime, so this file's own copy stays plain.
 */
export default function TopUpOther() {
  const origins = useLoad(() => api.topupOrigins());
  const [origin, setOrigin] = useState<TopupOrigin | null>(null);
  const [typed, setTyped] = useState("");
  const [quote, setQuote] = useState<TopupQuote | null>(null);
  const [status, setStatus] = useState<TopupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amount = typedToBase(typed);

  // Poll while the money is on its way (the server also settles in the background).
  useEffect(() => {
    if (!quote) return;
    let alive = true;
    const tick = async () => {
      try {
        const st = await api.topupStatus(quote.quoteId);
        if (!alive) return;
        setStatus(st);
        setError(null);
        if (st.status === "waiting" || st.status === "processing") timer.current = setTimeout(tick, POLL_MS);
      } catch (e) {
        if (!alive) return;
        setError(e);
        timer.current = setTimeout(tick, POLL_MS * 2);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [quote]);

  const getQuote = async () => {
    if (!origin || busy) return;
    setError(null);
    setBusy(true);
    try {
      setQuote(await api.topupQuote(origin.id, amount));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: string, value: string) => {
    await Clipboard.setStringAsync(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  // Step 3: where to send it, and live progress.
  if (quote && origin) {
    const done = status?.status === "completed";
    const ended = done || status?.status === "failed" || status?.status === "refunded";
    return (
      <Screen footer={<Button variant={ended ? "primary" : "secondary"} label="Done" onPress={() => router.back()} />}>
        <Text variant="title">
          Send exactly {plain(quote.amountIn)} {origin.symbol}
        </Text>
        <Muted>
          From your {origin.label} account, send to the details below. We&apos;ll add about {usd(quote.amountOut)} to your balance (at least{" "}
          {usd(quote.minAmountOut)}).
        </Muted>

        <Card>
          <Muted variant="small">Send to ({origin.networkLabel} only)</Muted>
          <Pressable accessibilityRole="button" accessibilityHint="Copies the details to send to" onPress={() => copy("to", quote.depositAddress)} style={styles.copyRow}>
            <Text variant="bodyStrong" selectable style={styles.mono}>
              {quote.depositAddress}
            </Text>
            <Icon name={copied === "to" ? "check" : "copy"} color={copied === "to" ? colors.green : colors.brown} />
          </Pressable>
          {quote.depositMemo ? (
            <>
              <Muted variant="small">Memo (required)</Muted>
              <Pressable accessibilityRole="button" accessibilityHint="Copies the memo" onPress={() => copy("memo", quote.depositMemo!)} style={styles.copyRow}>
                <Text variant="bodyStrong" selectable style={styles.mono}>
                  {quote.depositMemo}
                </Text>
                <Icon name={copied === "memo" ? "check" : "copy"} color={copied === "memo" ? colors.green : colors.brown} />
              </Pressable>
            </>
          ) : null}
          <Line label="Amount" value={`${plain(quote.amountIn)} ${origin.symbol}`} />
          <Line label="Use by" value={new Date(quote.expiresAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })} />
          {quote.etaSeconds ? <Line label="Usually takes" value={`about ${Math.max(1, Math.round(quote.etaSeconds / 60))} min`} /> : null}
        </Card>

        <Notice
          tone={done ? "success" : status?.status === "failed" ? "danger" : "info"}
          title={done ? "Added to your balance" : status?.status === "processing" ? "On its way" : ended ? undefined : "Waiting for your money"}
          message={status?.message ?? "We'll update this as soon as it arrives."}
        />
        {!ended ? <ActivityIndicator color={colors.brown} /> : null}
        <ErrorNote error={error} />
      </Screen>
    );
  }

  // Step 2: how much.
  if (origin) {
    return (
      <Screen footer={<Button label="Get details" busyLabel="Getting details…" disabled={!isPositive(amount) || busy} onPress={getQuote} />}>
        <Row title={origin.label} subtitle="Change" onPress={() => setOrigin(null)} />
        <View style={styles.amount}>
          <Text variant="hero" adjustsFontSizeToFit numberOfLines={1}>
            {displayTyped(typed)}
          </Text>
          <Muted variant="small">How much do you want to add?</Muted>
        </View>
        <ErrorNote error={error} />
        <Keypad value={typed} onChange={setTyped} />
      </Screen>
    );
  }

  // Step 1: where from.
  return (
    <Screen>
      <Text variant="title">Add from another account</Text>
      <Muted>Move dollars you already hold somewhere else into BilbyPay. Pick where they&apos;re coming from.</Muted>
      <Notice tone="warning" title="Real money, preview balance" message="This moves real dollars. While BilbyPay is in preview, they're added to your balance as test dollars, up to $25 at a time." />
      <ErrorNote error={origins.error} onRetry={origins.reload} />
      {origins.loading && !origins.data ? <ActivityIndicator color={colors.brown} /> : null}
      <Card>
        {origins.data?.origins.map((o) => (
          <Row key={o.id} title={o.label} subtitle={o.networkLabel} onPress={() => setOrigin(o)} />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  copyRow: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48, borderRadius: radius.sm },
  mono: { flex: 1, fontFamily: "Menlo" },
  amount: { alignItems: "center", gap: space.xs, paddingVertical: space.lg },
});
