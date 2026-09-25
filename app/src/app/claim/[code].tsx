import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { api, isApiError } from "../../api";
import type { Brand, ClaimAcceptResponse } from "../../api/types";
import { UnlockCancelled } from "../../auth/unlock";
import { usd } from "../../money/amount";
import { formatE164, matchesMasked } from "../../phone/phone";
import { useSession } from "../../state/session";
import { useLoad } from "../../state/useLoad";
import { BrandGrid } from "../../ui/BrandGrid";
import { Button } from "../../ui/Button";
import { Card } from "../../ui/Card";
import { GiftFace } from "../../ui/GiftDesign";
import { Mascot } from "../../ui/Mascot";
import { ErrorNote, Notice } from "../../ui/Notice";
import { Screen } from "../../ui/Screen";
import { Muted, Text } from "../../ui/Text";
import { colors, space } from "../../ui/theme";

const ask = (title: string, message: string, ok: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Not now", style: "cancel", onPress: () => resolve(false) },
      { text: ok, onPress: () => resolve(true) },
    ]),
  );

/** Someone sent you money or a gift: see it, prove it's your number, open it. */
export default function ClaimScreen() {
  const { code = "" } = useLocalSearchParams<{ code: string }>();
  const session = useSession();
  const { status, profile, freshVerification, setPendingClaim, linkNumber } = session;
  const { data: claim, error, loading, reload } = useLoad(() => api.claim(code), [code]);
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ClaimAcceptResponse | null>(null);
  const [acceptError, setAcceptError] = useState<unknown>(null);

  const needsBrand = claim?.kind === "gift" && !claim.gift?.brandId;
  const verification = freshVerification();
  const verified = !!(claim && verification && matchesMasked(verification.phone, claim.phoneMasked));

  // Remember the link so it survives onboarding (and an app restart in the middle of it).
  useEffect(() => {
    if (code && status !== "ready" && !accepted) setPendingClaim(code);
  }, [code, status, accepted, setPendingClaim]);

  useEffect(() => {
    if (needsBrand && !brands) {
      void api
        .catalog()
        .then((c) => setBrands(c.brands))
        .catch(() => setBrands([]));
    }
  }, [needsBrand, brands]);

  const verifyNumber = () => router.push({ pathname: "/phone", params: { purpose: "claim", code } });

  const open = async () => {
    if (!claim) return;
    setAcceptError(null);
    if (status === "signedOut") return router.push("/welcome");
    if (status === "locked") return router.push("/unlock");
    if (status !== "ready" || !profile) return verifyNumber();
    const v = freshVerification();
    if (!v || !matchesMasked(v.phone, claim.phoneMasked)) return verifyNumber();
    if (needsBrand && !brandId) {
      setAcceptError({ userMessage: "Pick a gift card first." });
      return;
    }
    try {
      if (v.phone !== profile.phone) {
        const ok = await ask(
          "Use this number for BilbyPay?",
          `This was sent to ${formatE164(v.phone)}. To open it, BilbyPay will switch your number from ${formatE164(profile.phone)} to this one.`,
          "Switch number",
        );
        if (!ok) return;
        await linkNumber();
      }
      const res = await api.acceptClaim(code, { phoneToken: v.phoneToken, ...(needsBrand && brandId ? { brandId } : {}) });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPendingClaim(null);
      setAccepted(res);
    } catch (e) {
      if (!(e instanceof UnlockCancelled)) setAcceptError(e);
    }
  };

  const done = () => {
    setPendingClaim(null);
    router.replace("/");
  };

  if (loading && !claim) {
    return (
      <Screen>
        <ActivityIndicator color={colors.brown} style={{ marginTop: space.xxl }} />
      </Screen>
    );
  }

  if (!claim) {
    return (
      <Screen footer={<Button variant="secondary" label="Close" onPress={done} />}>
        <Mascot size={140} />
        <ErrorNote error={error} onRetry={reload} />
      </Screen>
    );
  }

  if (accepted) {
    const brandName = claim.gift?.brandName ?? brands?.find((b) => b.id === brandId)?.name;
    return (
      <Screen
        edges={["top", "bottom"]}
        footer={
          accepted.giftCardId ? (
            <>
              <Button label="See your gift card" onPress={() => router.replace(`/card/${accepted.giftCardId}`)} />
              <Button variant="ghost" label="Home" onPress={done} />
            </>
          ) : (
            <Button label="Go to my balance" onPress={done} />
          )
        }
      >
        <Mascot size={180} />
        <Text variant="display" style={styles.center}>
          {claim.kind === "gift" ? "It's yours! 🎉" : `${usd(accepted.amount)} is yours! 🎉`}
        </Text>
        <Muted style={styles.center}>
          {claim.kind === "gift" ? `Your ${brandName ?? ""} gift card from ${claim.senderName} is ready to use.` : `It's in your balance, from ${claim.senderName}.`}
        </Muted>
      </Screen>
    );
  }

  const closed = claim.status !== "waiting";
  const label =
    status !== "ready" ? (claim.kind === "gift" ? "Open your gift" : `Get your ${usd(claim.amount)}`) : verified ? "Open it" : `Verify ${claim.phoneMasked}`;

  return (
    <Screen footer={closed ? <Button variant="secondary" label="Close" onPress={done} /> : <Button label={label} disabled={needsBrand && verified && !brandId} onPress={open} />}>
      <Text variant="title">
        {claim.kind === "gift" ? `${claim.senderName} sent you a gift` : `${claim.senderName} sent you ${usd(claim.amount)}`}
      </Text>

      {claim.kind === "gift" ? (
        <GiftFace design={claim.gift?.design} brandName={claim.gift?.brandName} amount={claim.amount} message={claim.gift?.message} from={claim.senderName} />
      ) : (
        <Card tone="sand" style={styles.money}>
          <Text variant="hero">{usd(claim.amount)}</Text>
          {claim.note ? <Text style={{ fontStyle: "italic" }}>“{claim.note}”</Text> : null}
          <Muted variant="small">From {claim.senderName}</Muted>
        </Card>
      )}

      {claim.status === "opened" ? <Notice tone="success" message="This has already been opened." /> : null}
      {claim.status === "returned" ? <Notice message={`This went back to ${claim.senderName}. Ask them to send it again.`} /> : null}

      {!closed ? (
        <Muted variant="small">
          Sent to {claim.phoneMasked}. Open it by {new Date(claim.expiresAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}, or it goes back to{" "}
          {claim.senderName}.
        </Muted>
      ) : null}

      {!closed && needsBrand && status === "ready" ? (
        <View style={{ gap: space.md }}>
          <Text variant="heading">Pick your gift card</Text>
          {brands ? <BrandGrid brands={brands} selected={brandId} onPick={(b) => setBrandId(b.id)} /> : <ActivityIndicator color={colors.brown} />}
        </View>
      ) : null}

      <ErrorNote error={acceptError} />
      {isApiError(acceptError) && acceptError.code === "WRONG_PHONE" ? (
        <Button variant="secondary" label="Verify a different number" onPress={verifyNumber} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { textAlign: "center" },
  money: { alignItems: "center", paddingVertical: space.xl },
});
