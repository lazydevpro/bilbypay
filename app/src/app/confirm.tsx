import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { api, isApiError, messageFor, readDirectory } from "../api";
import { verifySelectedRecipient } from "../directory/verification";
import { trustedEscrowAddress } from "../signing/directory";
import { safeMessage } from "../api/errors";
import type { ActionResult, Hex, PreparedAction } from "../api/types";
import { UnlockCancelled, withUnlockedSigner } from "../auth/unlock";
import { CHAIN_ID } from "../config";
import { authorizeAndSubmit } from "../flows/authorize";
import { type Draft, firstName, getDraft, putOutcome, updateDraft } from "../flows/drafts";
import { isPositive, usd } from "../money/amount";
import { useSession } from "../state/session";
import { CONFIRM_LABEL } from "../ui/biometric";
import { Button } from "../ui/Button";
import { Avatar } from "../ui/Avatar";
import { Card, Line } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { Mascot } from "../ui/Mascot";
import { prefetchMascot } from "../ui/mascot/assets";
import { Notice } from "../ui/Notice";
import { Screen } from "../ui/Screen";
import { Muted, Text } from "../ui/Text";
import { colors, radius, space } from "../ui/theme";

/**
 * The one confirm step for every money action: server summary → check → one Face ID → submit.
 * Retry-safe: the same action id and authorizations are resubmitted after a network blip.
 */
export default function Confirm() {
  const { draft: draftId } = useLocalSearchParams<{ draft: string }>();
  const { address } = useSession();
  const [draft, setDraft] = useState<Draft | undefined>(() => getDraft(draftId));
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [preparing, setPreparing] = useState(true);
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [failedGift, setFailedGift] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [signatures, setSignatures] = useState<Record<string, Hex> | null>(null);

  useEffect(() => { void prefetchMascot("running"); }, []);

  const prepare = useCallback(async (d: Draft | undefined) => {
    if (!d) return;
    setPreparing(true);
    setError(null);
    setAcknowledged(false);
    setSignatures(null);
    try {
      setPrepared(await api.prepareAction(d.request));
    } catch (e) {
      setPrepared(null);
      setError(e);
    } finally {
      setPreparing(false);
    }
  }, []);

  useEffect(() => {
    // A changed draft needs a new server summary and invalidates the previous consent and authorization.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void prepare(draft);
  }, [draft, prepare]);

  if (!draft || !address) {
    return (
      <Screen>
        <Notice message="This payment isn't ready anymore. Please start again." action={{ label: "Go home", onPress: () => router.dismissTo("/(tabs)") }} />
      </Screen>
    );
  }

  const finish = (result: ActionResult) => {
    if (result.status === "completed") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const id = putOutcome({ draft, result, title: prepared?.summary.title ?? "" });
    // Replace the modal in one action. Popping to the redirecting root before pushing
    // a result schedules competing navigation actions during the same transition.
    router.replace({ pathname: "/done", params: { id } });
  };

  const confirm = async () => {
    if (!prepared || submitting) return;
    setSubmitting(true);
    setError(null);
    setNote(null);
    setFailedGift(false);
    try {
      let result: ActionResult;
      if (signatures) {
        await verifySelectedRecipient(draft.request, draft.recipient, readDirectory);
        setSending(true);
        result = await api.submitAction(prepared.id, signatures);
      } else {
        const out = await authorizeAndSubmit({
          api,
          request: draft.request,
          prepared,
          account: address,
          chainId: CHAIN_ID,
          recipient: draft.recipient,
          readDirectory,
          escrow: draft.request.type === "gift_send" || (draft.request.type === "send" && draft.recipient?.status === "invite") ? trustedEscrowAddress() : undefined,
          resolvedPayee: draft.request.type === "send" && draft.recipient?.status === "registered" ? draft.recipient.address : undefined,
          unlock: (fn) => withUnlockedSigner(address, fn),
          onAuthorized: (s) => {
            setSignatures(s);
            setSending(true);
          },
        });
        result = out.result;
      }
      if (result.status === "failed") {
        // e.g. a gift card purchase that failed after paying: the server refunds it straight away.
        setSignatures(null);
        setFailedGift(draft.request.type === "gift_buy" || draft.request.type === "gift_send");
        setError({ userMessage: result.error?.message ?? "That didn't go through. Check Activity for the latest update before trying again." });
        return;
      }
      if (result.status !== "completed" && result.status !== "waiting") {
        setError({ userMessage: "We couldn't confirm the result. Check Activity before trying again." });
        return;
      }
      finish(result);
    } catch (e) {
      if (e instanceof UnlockCancelled) {
        setNote(e.userMessage);
        return;
      }
      if (isApiError(e) && e.code === "ACTION_EXPIRED") {
        await prepare(draft);
        setNote("That took a little while, so we refreshed the details. Please check and confirm again.");
        return;
      }
      if (!(isApiError(e) && e.code === "NETWORK")) setSignatures(null);
      setError(e);
    } finally {
      setSending(false);
      setSubmitting(false);
    }
  };

  const s = prepared?.summary;
  // For "Move to balance" the whole amount comes from Burrow by definition; the question is only for payments.
  const fromBurrow = s && draft.request.type !== "burrow_withdraw" ? BigInt(s.fromBurrow) : 0n;
  const fromBalance = s ? BigInt(s.total) - fromBurrow : 0n;
  const rebound = s?.warnings.find((w) => w.code === "RECIPIENT_RECENTLY_CHANGED");
  const otherWarnings = s?.warnings.filter((w) => w !== rebound) ?? [];
  const unreadableSummary = !!s && (!safeMessage(s.title, "") || s.lines.some((line) => !safeMessage(line.label, "") || !safeMessage(line.value, "")) || s.warnings.some((warning) => !safeMessage(warning.message, "")));
  const blocked = (!!rebound && !acknowledged) || unreadableSummary;
  const busyAvailable = isApiError(error) && error.code === "BURROW_BUSY" ? String(error.details.availableNow ?? "") : "";

  const retryWith = (next: Draft) => {
    updateDraft(draftId, next);
    setDraft(next);
  };

  /** The next step to offer under an error. */
  const errorAction = (): { label: string; onPress: () => unknown } | undefined => {
    const r = draft.request;
    // BURROW_BUSY.availableNow: Burrow's releasable amount for a withdraw; balance + releasable for a payment.
    if (isPositive(busyAvailable) && r.type === "burrow_withdraw") {
      return { label: `Move ${usd(busyAvailable)} now`, onPress: () => retryWith({ ...draft, request: { ...r, params: { amount: busyAvailable } } }) };
    }
    if (isPositive(busyAvailable) && r.type === "send") {
      return { label: `Send ${usd(busyAvailable)} instead`, onPress: () => retryWith({ ...draft, request: { ...r, params: { ...r.params, amount: busyAvailable } } }) };
    }
    if (failedGift) return { label: "Pick another gift card", onPress: () => router.dismissTo("/gifts") };
    if (!prepared) return { label: "Try again", onPress: () => prepare(draft) };
    return undefined;
  };

  return (
    <Screen
      footer={
        prepared ? (
          <>
            <Button label={signatures ? "Try again" : CONFIRM_LABEL} busyLabel={sending ? "Sending…" : "Confirming…"} disabled={blocked || preparing} onPress={confirm} />
            <Button variant="ghost" label="Cancel" disabled={submitting} onPress={() => router.back()} />
          </>
        ) : (
          <Button variant="secondary" label="Go back" onPress={() => router.back()} />
        )
      }
    >
      <Text variant="display">{draft.request.type === "send" ? "Review payment" : draft.gift ? "One last look" : "Review details"}</Text>
      {preparing ? <ActivityIndicator color={colors.primary} style={{ marginTop: space.xxl }} /> : null}

      {s ? (
        <>
          {draft.recipient ? (
            <View style={styles.recipient}>
              <Avatar name={draft.recipient.name} size={56} />
              <View style={styles.recipientName}>
                <Text variant="heading">{draft.recipient.name}</Text>
                <Muted variant="small">{draft.recipient.phone}</Muted>
              </View>
            </View>
          ) : null}
          <View style={styles.amountHero}>
            {"amount" in draft.request.params ? <Text variant="hero" style={styles.center} adjustsFontSizeToFit minimumFontScale={0.65} numberOfLines={1}>{usd(draft.request.params.amount)}</Text> : null}
            <Text variant="bodyStrong" style={styles.center}>{safeMessage(s.title, "Please review the payment details")}</Text>
            {"amount" in draft.request.params ? <Muted variant="caption">USD</Muted> : null}
          </View>
          {rebound ? (
            <View style={styles.danger}>
              <Text variant="heading" color={colors.red}>
                Check before you send
              </Text>
              <Text>{safeMessage(rebound.message, "This person's account has changed. Check with them another way before sending.")}</Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged, disabled: submitting }}
                disabled={submitting}
                onPress={() => setAcknowledged((a) => !a)}
                style={styles.check}
              >
                <View style={[styles.box, acknowledged && styles.boxOn]}>{acknowledged ? <Icon name="check" size={18} color={colors.white} /> : null}</View>
                <Text style={{ flex: 1 }}>I&apos;ve checked with {draft.recipient ? firstName(draft.recipient.name) : "them"} that this is their new number</Text>
              </Pressable>
            </View>
          ) : null}

          {fromBurrow > 0n ? (
            <Card tone="sand">
              <Text variant="heading">Take {usd(fromBurrow)} from Burrow?</Text>
              <Muted>
                You have {usd(fromBalance)} available in your balance. The rest comes out of Burrow as part of this payment. Nothing else to do.
              </Muted>
            </Card>
          ) : null}

          <Card tone="sand" style={styles.summary}>
            {s.lines.map((l, i) => (
              <Line key={i} label={safeMessage(l.label, "Details")} value={safeMessage(l.value, "Unavailable right now")} />
            ))}
            {isPositive(s.total) ? <View style={styles.total}><Line label="Total" value={usd(s.total)} strong /></View> : null}
          </Card>

          {otherWarnings.map((w) => (
            <Notice key={w.code} tone="warning" message={safeMessage(w.message, "We couldn't show an important detail. Go back and try again.")} />
          ))}
          {unreadableSummary ? <Notice tone="warning" message="We couldn't show all the details for this payment. Please go back and try again." /> : null}
        </>
      ) : null}

      {note ? <Notice message={note} /> : null}
      {error ? (
        <Notice
          tone={isApiError(error) && error.code === "NETWORK" ? "warning" : "danger"}
          message={messageFor(error)}
          action={errorAction()}
        />
      ) : null}
      <View style={styles.companion}>
        <Mascot size={110} mood={sending ? "running" : submitting || preparing ? "thinking" : error ? "reassuring" : "attentive"} interactive={false} backdrop={false} />
        <Muted variant="small" style={styles.companionCopy}>
          {sending ? "Sending your request…" : submitting ? "Confirming your details…" : error ? "Let's get this sorted." : "Check the details, then confirm with your screen lock."}
        </Muted>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  recipient: { flexDirection: "row", gap: space.md, alignItems: "center", paddingTop: space.sm },
  recipientName: { flex: 1, gap: space.xs },
  amountHero: { alignItems: "center", gap: space.xs, paddingVertical: space.md },
  center: { textAlign: "center", maxWidth: "100%" },
  summary: { padding: space.xl, gap: space.lg },
  total: { paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.line },
  companion: { flexDirection: "row", alignItems: "center", gap: space.md, marginTop: "auto" },
  companionCopy: { flex: 1 },
  danger: { backgroundColor: colors.redSoft, borderColor: colors.red, borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  check: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.red, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.red },
});
