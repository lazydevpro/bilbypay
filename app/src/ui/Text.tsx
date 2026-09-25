import { Text as RNText, type TextProps } from "react-native";
import { colors, type } from "./theme";

type Variant = keyof typeof type;

export function Text({ variant = "body", color, style, ...props }: TextProps & { variant?: Variant; color?: string }) {
  return <RNText maxFontSizeMultiplier={1.6} {...props} style={[type[variant], { color: color ?? colors.ink }, style]} />;
}

export const Muted = (props: TextProps & { variant?: Variant }) => <Text color={colors.muted} {...props} />;
