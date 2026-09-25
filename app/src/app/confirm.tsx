import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { api, isApiError, messageFor } from "../api";
import type { ActionResult, Hex, PreparedAction } from "../api/types";
import { UnlockCancelled, withUnlockedSigner } from "../auth/unlock";
import { CHAIN_ID } from "../config";
import { authorizeAndSubmit } from "../flows/authorize";
import { type Draft, firstName, getDraft, putOutcome, updateDraft } from "../flows/drafts";
import { isPositive, usd } from "../money/amount";
import { useSession } from "../state/session";
import { CONFIRM_LABEL } from "../ui/biometric";
import { Button } from "../ui/Button";
import { Card, Line } from "../ui/Card";
import { Icon } from "../ui/Icon";
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
  const signatures = useRef<Record<string, Hex> | null>(null);

  const prepare = useCallback(async (d: Draft | undefined) => {
    if (!d) return;
    setPreparing(true);
    setError(null);
    signatures.current = null;
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
    void prepare(draft);
  }, [draft, prepare]);

  if (!draft || !address) {
    return (
      <Screen>
        <Notice message="This payment isn't ready anymore. Please start again." action={{ label: "Go home", onPress: () => router.dismissAll() }} />
      </Screen>
    );
  }

  const finish = (result: ActionResult) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    const id = putOutcome({ draft, result, title: prepared?.summary.title ?? "" });
    router.dismissAll();
    router.push({ pathname: "/done", params: { id } });
  };

  const confirm = async () => {
    if (!prepared) return;
    setError(null);
    setNote(null);
    setFailedGift(false);
    try {
      let result: ActionResult;
      if (signatures.current) {
        result = await api.submitAction(prepared.id, signatures.current);
      } else {
        const out = await authorizeAndSubmit({
          api,
          request: draft.request,
          prepared,
          account: address,
          chainId: CHAIN_ID,
          resolvedPayee: draft.request.type === "send" && draft.recipient?.status === "registered" ? draft.recipient.address : undefined,
          unlock: (fn) => withUnlockedSigner(address, fn),
          onAuthorized: (s) => {
            signatures.current = s;
          },
        });
        result = out.result;
      }
      if (result.status === "failed") {
        // e.g. a gift card purchase that failed after paying: the server refunds it straight away.
        signatures.current = null;
        setFailedGift(draft.request.type === "gift_buy" || draft.request.type === "gift_send");
        setError({ userMessage: result.error?.message ?? "That didn't go through and nothing was taken. Please try again." });
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
      if (!(isApiError(e) && e.code === "NETWORK")) signatures.current = null;
      setError(e);
    }
  };

  const s = prepared?.summary;
  // For "Move to balance" the whole amount comes from Burrow by definition; the question is only for payments.
  const fromBurrow = s && draft.request.type !== "burrow_withdraw" ? BigInt(s.fromBurrow) : 0n;
  const fromBalance = s ? BigInt(s.total) - fromBurrow : 0n;
  const rebound = s?.warnings.find((w) => w.code === "RECIPIENT_RECENTLY_CHANGED");
  const otherWarnings = s?.warnings.filter((w) => w !== rebound) ?? [];
  const blocked = !!rebound && !acknowledged;
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
            <Button label={signatures.current ? "Try again" : CONFIRM_LABEL} busyLabel="Sending…" disabled={blocked} onPress={confirm} />
            <Button variant="ghost" label="Cancel" onPress={() => router.back()} />
          </>
        ) : (
          <Button variant="secondary" label="Go back" onPress={() => router.back()} />
        )
      }
    >
      {preparing ? <ActivityIndicator color={colors.brown} style={{ marginTop: space.xxl }} /> : null}

      {s ? (
        <>
          <Text variant="title">{s.title}</Text>
          {rebound ? (
            <View style={styles.danger}>
              <Text variant="heading" color={colors.red}>
                Check before you send
              </Text>
              <Text>{rebound.message}</Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acknowledged }}
                onPress={() => setAcknowledged((a) => !a)}
                style={styles.check}
              >
                <View style={[styles.box, acknowledged && styles.boxOn]}>{acknowledged ? <Icon name="check" size={18} color={colors.white} /> : null}</View>
                <Text style={{ flex: 1 }}>I've checked with {draft.recipient ? firstName(draft.recipient.name) : "them"} that this is their new number</Text>
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

          <Card>
            {s.lines.map((l, i) => (
              <Line key={i} label={l.label} value={l.value} />
            ))}
            {isPositive(s.total) ? <Line label="Total" value={usd(s.total)} strong /> : null}
          </Card>

          {otherWarnings.map((w) => (
            <Notice key={w.code} tone="warning" message={w.message} />
          ))}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  danger: { backgroundColor: colors.redSoft, borderColor: colors.red, borderWidth: 2, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  check: { flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 48 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: colors.red, alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: colors.red },
});
