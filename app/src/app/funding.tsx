import * as Linking from "expo-linking";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { api } from "../api";
import type { FundingSession } from "../api/types";
import { agoraLine } from "../funding/agora";
import { FUNDING_POLL_MS, fundingCopy, safeCheckoutUrl, shouldPollFunding } from "../funding/checkout";
import { usd } from "../money/amount";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card, Line } from "../ui/Card";
import { Mascot } from "../ui/Mascot";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

/** Where BilbyPay dollars come from, from Agora's public figures. Renders nothing until (and unless) they load. */
function AgoraNote() {
  const [line, setLine] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api.agoraMetrics().then(m => { if (alive) setLine(agoraLine(m)); }, () => {});
    return () => { alive = false; };
  }, []);
  return line ? <Muted variant="small" style={styles.center} accessibilityRole="text">{line}</Muted> : null;
}

/** A hosted-checkout return is only navigation. Read payment status from Bilby's API. */
export default function Funding() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { status: accountStatus } = useSession();
  const [session, setSession] = useState<FundingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState(false);
  const [openError, setOpenError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const current = session?.id === id ? session : null;
  const copy = current ? fundingCopy(current.status) : null;
  const checkout = safeCheckoutUrl(current?.checkoutUrl);
  const pending = current?.status === "pending";
  const finished = current && !["pending", "processing"].includes(current.status);
  const retry = () => setRefresh(value => value + 1);

  useFocusEffect(useCallback(() => {
    if (!id || accountStatus !== "ready") return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;
    let latestStatus: FundingSession["status"] | undefined;
    setLoading(true);
    setPolling(true);
    setError(false);
    const poll = async () => {
      attempts += 1;
      try {
        const result = await api.fundingSession(id);
        if (!alive) return;
        if (result.id !== id || result.environment !== "sandbox") throw new Error("Unexpected checkout response");
        latestStatus = result.status;
        setSession(result);
        setError(false);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) {
          setLoading(false);
          if (shouldPollFunding(latestStatus, attempts)) timer = setTimeout(() => { void poll(); }, FUNDING_POLL_MS);
          else setPolling(false);
        }
      }
    };
    void poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  // Changing the retry counter starts a fresh bounded polling window.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, accountStatus, refresh]));

  const open = async () => {
    setOpenError(false);
    if (!checkout || !pending) { setOpenError(true); return; }
    try {
      // Same-tab navigation preserves this browser tab's session and leaves the status
      // URL in history. Back and the provider return both resume this exact session.
      if (Platform.OS === "web") globalThis.location.assign(checkout);
      else await Linking.openURL(checkout);
    } catch { setOpenError(true); }
  };

  if (!id) return (
    <Screen footer={<Button label="Choose an amount" onPress={() => router.replace("/topup")} />}>
      <Mascot size={160} mood="receiving" accessibilityLabel="Bilby ready for a top-up" />
      <Text variant="title">Let&apos;s start with an amount</Text>
      <Muted>Choose an amount to preview a card payment.</Muted>
      <Notice tone="warning" title="Sandbox preview" message="No real money moves and your BilbyPay balance won't change." />
      <AgoraNote />
    </Screen>
  );

  return (
    <Screen footer={
      <>
        {pending && checkout ? <Button label="Continue in Ramp" busyLabel="Opening practice checkout…" accessibilityHint="Opens Ramp's practice checkout in your browser" onPress={open} /> : !finished ? <Button label={loading ? "Checking your payment…" : "Check status"} disabled={loading || accountStatus !== "ready"} onPress={retry} /> : null}
        <Button label={finished && current.status !== "completed" ? "Try another practice payment" : "Back to home"} variant={finished ? "primary" : "ghost"} onPress={() => router.replace(finished && current.status !== "completed" ? "/topup" : "/(tabs)")} />
      </>
    }>
      <Notice tone="warning" title="Sandbox preview" message="No real money moves. This practice checkout does not add money to your BilbyPay balance." />
      <View accessibilityLiveRegion="polite" style={styles.hero}>
        <Mascot size={184} mood={copy?.mood ?? "thinking"} accessibilityLabel={current?.status === "completed" ? "Bilby celebrating a completed practice payment" : "Bilby checking your practice payment"} />
        <Text variant="display" style={styles.center}>{copy?.title ?? "Checking your payment"}</Text>
        <Muted style={styles.center}>{copy?.body ?? "We're checking the latest details with Ramp."}</Muted>
      </View>
      {current ? <Card style={styles.receipt}>
        <View style={styles.receiptHeading}><Text variant="small" color={colors.muted}>PRACTICE PAYMENT</Text><Text variant="small" color={colors.primaryDeep}>Ramp</Text></View>
        <Text variant="hero" style={styles.center}>{usd(current.amount)}</Text>
        <View style={styles.details}>
          <Line label="Currency" value="US dollars" />
          <Line label="Fees" value={current.fee !== undefined ? usd(current.fee) : "Shown in Ramp"} />
          <Line label="BilbyPay balance" value="Unchanged" strong />
        </View>
      </Card> : loading ? <View accessibilityLabel="Loading practice payment details" style={styles.skeleton}><View style={styles.skeletonLine} /><View style={styles.skeletonAmount} /><View style={styles.skeletonLine} /></View> : null}
      {pending ? <View style={styles.explanation}>
        <Text variant="bodyStrong">Review everything before you confirm</Text>
        <Muted variant="small">Ramp shows the card payment methods available to you, the final fees, and the expected timing. Returning here alone doesn&apos;t mean the payment is complete.</Muted>
        {checkout ? <Button compact variant="secondary" label="I've returned — check status" disabled={loading} onPress={retry} /> : <Notice message="We couldn't open this checkout. Check its status and try again." action={{ label: "Check status", onPress: retry }} />}
      </View> : null}
      {error ? <Notice tone="warning" message="We couldn't check this practice payment. Try again in a moment." action={{ label: "Check again", onPress: retry }} /> : null}
      {openError ? <Notice tone="warning" message="We couldn't open the practice checkout. Check the payment status and try again." action={{ label: "Check status", onPress: retry }} /> : null}
      {current && !finished ? <Muted variant="small" style={styles.center}>{polling ? "Checking for updates while you're here." : "Still waiting for Ramp. Tap Check status whenever you're ready."}</Muted> : null}
      <AgoraNote />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", gap: space.md, paddingBottom: space.sm },
  center: { textAlign: "center" },
  receipt: { padding: space.xl, gap: space.xl },
  receiptHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  details: { gap: space.md, borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line, paddingTop: space.lg },
  explanation: { gap: space.sm, paddingVertical: space.sm },
  skeleton: { minHeight: 232, alignItems: "center", justifyContent: "center", gap: space.xl, backgroundColor: colors.sand, borderRadius: radius.lg, padding: space.xl },
  skeletonLine: { height: 12, width: "70%", borderRadius: radius.sm, backgroundColor: colors.sandDeep },
  skeletonAmount: { height: 48, width: "45%", borderRadius: radius.sm, backgroundColor: colors.sandDeep },
});
