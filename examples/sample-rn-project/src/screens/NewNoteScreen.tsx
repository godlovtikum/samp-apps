import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Switch,
} from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { colors, spacing } from '../theme';
import { useStore } from '../state/store';

type Props = { onSaved: () => void };

export default function NewNoteScreen({ onSaved }: Props) {
  const { dispatch } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [stamp, setStamp] = useState(true);
  const [busy, setBusy] = useState(false);

  const grabLocation = useCallback(
    () =>
      new Promise<{ lat: number; lng: number } | undefined>(resolve => {
        Geolocation.getCurrentPosition(
          pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          _err => resolve(undefined),
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
        );
      }),
    [],
  );

  const save = useCallback(async () => {
    const t = title.trim();
    if (!t) {
      Alert.alert('Title required', 'Add a short title for this note.');
      return;
    }
    setBusy(true);
    const location = stamp ? await grabLocation() : undefined;
    dispatch({
      type: 'add',
      note: {
        id: `n_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        title: t,
        body: body.trim(),
        createdAt: Date.now(),
        location,
      },
    });
    setBusy(false);
    setTitle('');
    setBody('');
    onSaved();
  }, [title, body, stamp, grabLocation, dispatch, onSaved]);

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <Text style={styles.h1}>New note</Text>

      <Text style={styles.label}>Title</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="What did you observe?"
        placeholderTextColor={colors.textDim}
        maxLength={80}
      />

      <Text style={styles.label}>Body</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={body}
        onChangeText={setBody}
        placeholder="Optional details…"
        placeholderTextColor={colors.textDim}
        multiline
        numberOfLines={5}
      />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.toggleLabel}>Stamp my location</Text>
          <Text style={styles.toggleHint}>
            Uses ACCESS_FINE_LOCATION when granted by the OS.
          </Text>
        </View>
        <Switch
          value={stamp}
          onValueChange={setStamp}
          trackColor={{ false: colors.border, true: colors.primary }}
        />
      </View>

      <Pressable
        style={[styles.button, busy && styles.buttonBusy]}
        disabled={busy}
        onPress={save}
      >
        <Text style={styles.buttonText}>{busy ? 'Saving…' : 'Save note'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: spacing(5) },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: spacing(4) },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: spacing(3),
    marginBottom: spacing(2),
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 10,
    padding: spacing(3),
    fontSize: 15,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing(3.5),
    borderRadius: 10,
    marginTop: spacing(4),
  },
  toggleLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  toggleHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing(1) },
  button: {
    backgroundColor: colors.primary,
    padding: spacing(4),
    borderRadius: 10,
    alignItems: 'center',
    marginTop: spacing(5),
  },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: colors.primaryText, fontWeight: '700', fontSize: 15 },
});
