/**
 * The optional floating button, for hosts that want the web widget's launcher
 * rather than their own entry point (a settings row, a shake gesture, a menu
 * item all work just as well - the sheet does not care who opens it).
 *
 * Absolute-positioned inside whatever container it is rendered in; put it at
 * the root of the screen, above the navigator, for the web-like corner button.
 */
import { useMemo, type ReactElement } from "react";
import { Pressable, StyleSheet, Text, useColorScheme, type StyleProp, type ViewStyle } from "react-native";
import type { ResolvedConfig } from "../types.js";
import type { FeedbackClient } from "./client.js";
import {
  ICON_GLYPHS,
  PALETTES,
  POSITION_STYLES,
  SHAPE_TRAITS,
  resolveScheme,
  type Palette,
} from "./palette.js";

export interface FeedbackLauncherProps {
  client: FeedbackClient;
  onPress: () => void;
  /** Merged last, for hosts that need to dodge a tab bar or safe-area inset. */
  style?: StyleProp<ViewStyle>;
}

const CIRCLE_SIZE = 56;
const PILL_HEIGHT = 48;
const FALLBACK_GLYPH = "💬";

export function FeedbackLauncher({ client, onPress, style }: FeedbackLauncherProps): ReactElement | null {
  const { config } = client;
  const systemScheme = useColorScheme();
  const palette = PALETTES[resolveScheme(config.theme.colorScheme, systemScheme)];
  const styles = useMemo(() => makeStyles(palette, config), [palette, config]);

  if (!config.enabled) return null;

  const shape = SHAPE_TRAITS[config.theme.buttonShape];
  const glyph = ICON_GLYPHS[config.theme.icon] ?? FALLBACK_GLYPH;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={config.theme.buttonLabel}
      style={[styles.launcher, shape.showLabel ? styles.pill : styles.circle, style]}
    >
      <Text style={styles.glyph}>{glyph}</Text>
      {shape.showLabel && <Text style={styles.label}>{config.theme.buttonLabel}</Text>}
    </Pressable>
  );
}

function makeStyles(palette: Palette, config: ResolvedConfig) {
  const { accent, position } = config.theme;

  return StyleSheet.create({
    launcher: {
      position: "absolute",
      ...POSITION_STYLES[position],
      backgroundColor: accent,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      elevation: 6,
      shadowColor: "#000000",
      shadowOpacity: 0.25,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
    },
    circle: { width: CIRCLE_SIZE, height: CIRCLE_SIZE, borderRadius: CIRCLE_SIZE / 2 },
    pill: { height: PILL_HEIGHT, borderRadius: PILL_HEIGHT / 2, paddingHorizontal: 18 },
    glyph: { fontSize: 18 },
    label: { color: palette.onAccent, fontSize: 15, fontWeight: "700" },
  });
}
