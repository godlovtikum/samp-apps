import React, { useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Linking,
  StyleSheet,
  Alert,
} from 'react-native';
import { colors, spacing } from '../theme';

const links: { label: string; url: string; hint: string }[] = [
  { label: 'BaseDeck', url: 'https://basedeck.netlify.app', hint: 'Phone-first Supabase project setup' },
  { label: 'Repojet', url: 'https://repojet.netlify.app', hint: 'Push folders to GitHub from a phone' },
];

export default function AboutScreen() {
  const open = useCallback(async (url: string) => {
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open link', url);
    }
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.h1}>About this app</Text>
      <Text style={styles.body}>
        Field Notes is a small demonstration of an Android app built end-to-end by SAMP APPS — paste a
        Git URL on your phone, watch the live timeline, install the APK. No laptop required.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Created by</Text>
        <Text style={styles.cardValue}>Godlove Tikum</Text>
        <Text style={styles.cardHint}>
          SAMP APPS, BaseDeck, and Repojet form a small phone-first ecosystem aimed at one goal:
          making it possible to build, deploy, and ship real software from a phone — without owning a
          laptop.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Companion projects</Text>
        {links.map(l => (
          <Pressable key={l.url} style={styles.link} onPress={() => open(l.url)}>
            <View style={{ flex: 1 }}>
              <Text style={styles.linkLabel}>{l.label}</Text>
              <Text style={styles.linkHint}>{l.hint}</Text>
            </View>
            <Text style={styles.linkArrow}>↗</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Status</Text>
        <Text style={styles.cardValue}>Open & experimental</Text>
        <Text style={styles.cardHint}>
          This APK is signed with a debug keystore and intended for personal verification.
          Production-keystore signing is on the roadmap.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { padding: spacing(5) },
  h1: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: spacing(3) },
  body: { color: colors.textMuted, lineHeight: 22 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing(4),
    marginTop: spacing(4),
  },
  cardLabel: {
    color: colors.textDim,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing(2),
  },
  cardValue: { color: colors.text, fontSize: 18, fontWeight: '700' },
  cardHint: { color: colors.textMuted, marginTop: spacing(2), lineHeight: 20 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing(2.5),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  linkLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  linkHint: { color: colors.textMuted, fontSize: 12, marginTop: spacing(0.5) },
  linkArrow: { color: colors.primary, fontSize: 18, marginLeft: spacing(3) },
});
