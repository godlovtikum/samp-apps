import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { Note } from '../state/store';

type Props = { note: Note; onRemove: () => void };

function timeAgo(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NoteCard({ note, onRemove }: Props) {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title} numberOfLines={1}>
          {note.title}
        </Text>
        <Pressable hitSlop={8} onPress={onRemove}>
          <Text style={styles.remove}>Remove</Text>
        </Pressable>
      </View>
      {note.body ? (
        <Text style={styles.body} numberOfLines={4}>
          {note.body}
        </Text>
      ) : null}
      <View style={styles.metaRow}>
        <Text style={styles.meta}>{timeAgo(note.createdAt)}</Text>
        {note.location ? (
          <Text style={styles.meta}>
            {note.location.lat.toFixed(3)}, {note.location.lng.toFixed(3)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginBottom: spacing(3),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, marginRight: spacing(2) },
  remove: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  body: { color: colors.textMuted, marginTop: spacing(2), lineHeight: 20 },
  metaRow: { marginTop: spacing(3), flexDirection: 'row', justifyContent: 'space-between' },
  meta: { color: colors.textDim, fontSize: 12 },
});
