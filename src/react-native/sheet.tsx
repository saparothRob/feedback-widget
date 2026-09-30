/**
 * The ready-made feedback dialog for react-native: the web modal's field set -
 * kind chips from the server config, title, details, optional email - as a
 * bottom sheet over an RN `Modal`, themed from the same resolved config the
 * web widget mounts with. No replay, no attachments, no custom fields: those
 * are web capabilities, and this sheet does not pretend to have them.
 */
import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from "react-native";
import type { ResolvedConfig } from "../types.js";
import type { SubmitResult } from "../transport/index.js";
import type { FeedbackClient } from "./client.js";
import { COPY, KIND_HINTS, KIND_LABELS } from "../copy.js";
import { DONE_DISMISS_MS, MAX_TITLE_LENGTH } from "../limits.js";
import { LEGACY_KINDS } from "../wire.js";
import {
  PALETTES,
  SKIN_TRAITS,
  WASH_ALPHA,
  controlRadius,
  resolveScheme,
  withAlpha,
  type Palette,
} from "./palette.js";

export interface FeedbackSheetProps {
  client: FeedbackClient;
  visible: boolean;
  onClose: () => void;
  onSubmitted?: (result: SubmitResult) => void;
}

type Phase = "editing" | "sending" | "done";

const PANEL_MAX_HEIGHT = "88%";
const EYEBROW_FONT = Platform.select({ ios: "Menlo", default: "monospace" });

const SEND_LABELS: Record<Phase, string> = {
  editing: COPY.send,
  sending: COPY.sending,
  done: COPY.send,
};

export function FeedbackSheet({ client, visible, onClose, onSubmitted }: FeedbackSheetProps): ReactElement | null {
  const { config } = client;
  const systemScheme = useColorScheme();

  const [kind, setKind] = useState<string>(config.kinds[0] ?? LEGACY_KINDS[0]);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("editing");

  const palette = PALETTES[resolveScheme(config.theme.colorScheme, systemScheme)];
  const styles = useMemo(() => makeStyles(palette, config), [palette, config]);

  useEffect(() => {
    if (!visible) return;
    setKind(config.kinds[0] ?? LEGACY_KINDS[0]);
    setTitle("");
    setMessage("");
    setEmail("");
    setError(null);
    setPhase("editing");
  }, [visible, config.kinds]);

  useEffect(() => {
    if (phase !== "done") return;
    const timer = setTimeout(onClose, DONE_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [phase, onClose]);

  if (!config.enabled) return null;

  const skin = SKIN_TRAITS[config.theme.skin];
  const collectEmail = config.collectEmail && !client.user.email;
  const sending = phase === "sending";

  const close = (): void => {
    if (!sending) onClose();
  };

  const send = (): void => {
    const trimmed = message.trim();
    if (trimmed === "") {
      setError(COPY.missingMessage);
      return;
    }
    setError(null);
    setPhase("sending");
    client
      .submit({
        kind,
        title: title.trim().slice(0, MAX_TITLE_LENGTH),
        message: trimmed,
        email: email.trim() || null,
      })
      .then((result) => {
        setPhase("done");
        onSubmitted?.(result);
      })
      .catch((cause: unknown) => {
        setPhase("editing");
        setError(cause instanceof Error ? cause.message : COPY.sendFailed);
      });
  };

  const form = (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      {config.kinds.length > 1 && (
        <View style={styles.kindRow} accessibilityRole="radiogroup" accessibilityLabel={COPY.kindGroupLabel}>
          {config.kinds.map((value) => (
            <Pressable
              key={value}
              onPress={() => setKind(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: value === kind }}
              accessibilityHint={KIND_HINTS[value] ?? ""}
              style={[styles.chip, value === kind && styles.chipActive]}
            >
              <Text style={[styles.chipLabel, value === kind && styles.chipLabelActive]}>
                {KIND_LABELS[value] ?? value}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.field}>
        <Text style={styles.label}>{COPY.titleLabel}</Text>
        <TextInput
          style={styles.inputControl}
          value={title}
          onChangeText={setTitle}
          placeholder={COPY.titlePlaceholder}
          placeholderTextColor={palette.faint}
          maxLength={MAX_TITLE_LENGTH}
          editable={!sending}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>
          {COPY.detailsLabel}
          <Text style={styles.required}> *</Text>
        </Text>
        <TextInput
          style={[styles.inputControl, styles.textarea]}
          value={message}
          onChangeText={setMessage}
          placeholder={COPY.messagePlaceholder}
          placeholderTextColor={palette.faint}
          multiline
          editable={!sending}
        />
      </View>

      {collectEmail && (
        <View style={styles.field}>
          <Text style={styles.label}>{COPY.emailLabel}</Text>
          <TextInput
            style={styles.inputControl}
            value={email}
            onChangeText={setEmail}
            placeholder={COPY.emailPlaceholder}
            placeholderTextColor={palette.faint}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!sending}
          />
          <Text style={styles.hint}>{COPY.emailHint}</Text>
        </View>
      )}

      {error !== null && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <Text style={styles.privacy}>{COPY.privacyMobile}</Text>

      <View style={styles.foot}>
        <Pressable onPress={close} accessibilityRole="button" style={styles.ghostButton} disabled={sending}>
          <Text style={styles.ghostLabel}>{COPY.cancel}</Text>
        </Pressable>
        <Pressable
          onPress={send}
          accessibilityRole="button"
          style={[styles.sendButton, sending && styles.sendButtonBusy]}
          disabled={sending}
        >
          <Text style={styles.sendLabel}>{SEND_LABELS[phase]}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  const done = (
    <View style={styles.done}>
      <View style={styles.doneMark}>
        <Text style={styles.doneGlyph}>✓</Text>
      </View>
      <Text style={styles.doneTitle}>{COPY.doneTitle}</Text>
      <Text style={styles.doneText}>{config.theme.successMessage}</Text>
    </View>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimTouch} onPress={close} accessibilityLabel={COPY.closeLabel} />
        <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", default: undefined })}>
          <View style={styles.panel}>
            <View style={styles.head}>
              {skin.eyebrow && <Text style={styles.eyebrow}>{config.theme.brandName.toUpperCase()}</Text>}
              <View style={styles.headRow}>
                <Text style={styles.heading}>{config.theme.buttonLabel}</Text>
                <Pressable
                  onPress={close}
                  accessibilityRole="button"
                  accessibilityLabel={COPY.closeLabel}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.closeGlyph}>✕</Text>
                </Pressable>
              </View>
            </View>
            {phase === "done" ? done : form}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function makeStyles(palette: Palette, config: ResolvedConfig) {
  const { accent, radius, skin } = config.theme;
  const traits = SKIN_TRAITS[skin];
  const ctl = controlRadius(radius);
  const wash = withAlpha(accent, WASH_ALPHA);

  return StyleSheet.create({
    scrim: { flex: 1, justifyContent: "flex-end", backgroundColor: palette.scrim },
    scrimTouch: { ...StyleSheet.absoluteFillObject },
    panel: {
      backgroundColor: palette.bg,
      borderTopLeftRadius: radius,
      borderTopRightRadius: radius,
      maxHeight: PANEL_MAX_HEIGHT,
      paddingBottom: 24,
    },
    head: { paddingHorizontal: 20, paddingTop: 18, gap: 4 },
    eyebrow: {
      color: palette.faint,
      fontSize: 11,
      letterSpacing: 1.4,
      fontFamily: traits.eyebrowMono ? EYEBROW_FONT : undefined,
    },
    headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    heading: { color: palette.text, fontSize: 20, fontWeight: "700" },
    closeGlyph: { color: palette.muted, fontSize: 18 },
    body: { paddingHorizontal: 20, paddingTop: 14, gap: 14 },
    kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: {
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.ground,
      borderRadius: ctl,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipActive: { borderColor: accent, backgroundColor: wash },
    chipLabel: { color: palette.muted, fontSize: 13 },
    chipLabelActive: { color: palette.text, fontWeight: "600" },
    field: { gap: 6 },
    label: {
      color: palette.muted,
      fontSize: 12,
      fontWeight: "600",
      textTransform: traits.labelTransform,
      letterSpacing: traits.labelSpacing,
    },
    required: { color: palette.danger },
    inputControl: {
      backgroundColor: palette.input,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: ctl,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: palette.text,
      fontSize: 15,
    },
    textarea: { minHeight: 96, textAlignVertical: "top" },
    hint: { color: palette.faint, fontSize: 12 },
    error: { color: palette.danger, fontSize: 13 },
    privacy: { color: palette.faint, fontSize: 12, lineHeight: 17 },
    foot: { flexDirection: "row", justifyContent: "flex-end", gap: 10, paddingTop: 4 },
    ghostButton: {
      borderWidth: 1,
      borderColor: palette.borderStrong,
      borderRadius: ctl,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    ghostLabel: { color: palette.muted, fontSize: 14, fontWeight: "600" },
    sendButton: { backgroundColor: accent, borderRadius: ctl, paddingHorizontal: 20, paddingVertical: 10 },
    sendButtonBusy: { opacity: 0.6 },
    sendLabel: { color: palette.onAccent, fontSize: 14, fontWeight: "700" },
    done: { alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 28 },
    doneMark: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: wash,
      alignItems: "center",
      justifyContent: "center",
    },
    doneGlyph: { color: palette.ok, fontSize: 24, fontWeight: "700" },
    doneTitle: { color: palette.text, fontSize: 17, fontWeight: "700" },
    doneText: { color: palette.muted, fontSize: 14, textAlign: "center" },
  });
}
