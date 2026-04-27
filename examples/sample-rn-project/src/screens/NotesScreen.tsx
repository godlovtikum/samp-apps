import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';
import { useStore } from '../state/store';
import NoteCard from '../components/NoteCard';

type Props = { onNewPress: () => void };

export default function NotesScreen({ onNewPress }: Props) {
  const { state, dispatch } = useStore();
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>Field notes</Text>
          <Text style={styles.h2}>
            {state.notes.length} {state.notes.length === 1 ? 'note' : 'notes'}
          </Text>
        </View>
        <Pressable onPress={onNewPress} style={styles.addBtn}>
          <Text style={styles.addBtnText}>+ New</Text>
        </Pressable>
      </View>
      {state.notes.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No notes yet</Text>
          <Text style={styles.emptyBody}>Tap “New” to capture your first one.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {state.notes.map(n => (
            <NoteCard
              key={n.id}
              note={n}
              onRemove={() => dispatch({ type: 'remove', id: n.id })}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    padding: spacing(5),
    paddingBottom: spacing(2),
    flexDirection: 'row',
    alignItems: 'center',
  },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700' },
  h2: { color: colors.textMuted, marginTop: spacing(1) },
  addBtn: {
    paddingVertical: spacing(2),
    paddingHorizontal: spacing(3),
    backgroundColor: colors.surface,
    borderRadius: 8,
  },
  addBtnText: { color: colors.text, fontWeight: '700' },
  list: { padding: spacing(4), paddingTop: spacing(2) },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6) },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyBody: { color: colors.textMuted, marginTop: spacing(2), textAlign: 'center' },
});
