import { Text as RNText, type TextProps } from "react-native";
import { createContext, useContext } from "react";
import { colors, type } from "./theme";

type Variant = keyof typeof type;
export const FontReadyContext = createContext(false);
const fonts: Record<Variant, string> = {
  hero: "Nunito_900Black", display: "Nunito_900Black", title: "Nunito_800ExtraBold", heading: "Nunito_800ExtraBold",
  body: "Nunito_400Regular", bodyStrong: "Nunito_700Bold", small: "Nunito_400Regular", caption: "Nunito_600SemiBold",
};

export function Text({ variant = "body", color, style, ...props }: TextProps & { variant?: Variant; color?: string }) {
  const ready = useContext(FontReadyContext);
  return <RNText maxFontSizeMultiplier={1.6} {...props} style={[type[variant], ready && { fontFamily: fonts[variant], fontWeight: "normal" }, { color: color ?? colors.ink }, style]} />;
}

export const Muted = (props: TextProps & { variant?: Variant }) => <Text color={colors.muted} {...props} />;
