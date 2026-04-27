import React, { useState } from 'react';
import { SafeAreaView, StatusBar, View, StyleSheet } from 'react-native';
import { colors } from './theme';
import { StoreProvider } from './state/store';
import TabBar, { TabId } from './components/TabBar';
import NotesScreen from './screens/NotesScreen';
import NewNoteScreen from './screens/NewNoteScreen';
import AboutScreen from './screens/AboutScreen';

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('notes');
  return (
    <StoreProvider>
      <SafeAreaView style={styles.root}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
        <View style={styles.body}>
          {tab === 'notes' && <NotesScreen onNewPress={() => setTab('new')} />}
          {tab === 'new' && <NewNoteScreen onSaved={() => setTab('notes')} />}
          {tab === 'about' && <AboutScreen />}
        </View>
        <TabBar active={tab} onChange={setTab} />
      </SafeAreaView>
    </StoreProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
