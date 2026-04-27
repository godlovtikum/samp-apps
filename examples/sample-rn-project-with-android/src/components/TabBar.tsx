import React from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

export type TabId = 'notes' | 'new' | 'about';

type Props = { active: TabId; onChange: (t: TabId) => void };

const tabs: { id: TabId; label: string }[] = [
  { id: 'notes', label: 'Notes' },
  { id: 'new', label: 'New' },
  { id: 'about', label: 'About' },
];

export default function TabBar({ active, onChange }: Props) {
  return (
    <View style={styles.bar}>
      {tabs.map(t => {
        const on = t.id === active;
        return (
          <Pressable key={t.id} style={styles.tab} onPress={() => onChange(t.id)}>
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
            <View style={[styles.indicator, on && styles.indicatorOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tab: { flex: 1, paddingVertical: spacing(3), alignItems: 'center' },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  labelOn: { color: colors.text },
  indicator: {
    marginTop: spacing(1.5),
    height: 2,
    width: 16,
    backgroundColor: 'transparent',
    borderRadius: 1,
  },
  indicatorOn: { backgroundColor: colors.primary },
});
