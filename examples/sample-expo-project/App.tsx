import React, { useState } from "react";
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { StatusBar } from "expo-status-bar";

interface Note {
    id: string;
    text: string;
    createdAt: number;
}

export default function App(): React.JSX.Element {
    const [notes, setNotes] = useState<Note[]>([]);
    const [draft, setDraft] = useState<string>("");

    function addNote(): void {
        const trimmed = draft.trim();
        if (!trimmed) return;
        setNotes((previous) => [
            { id: String(Date.now()), text: trimmed, createdAt: Date.now() },
            ...previous,
        ]);
        setDraft("");
    }

    function removeNote(noteId: string): void {
        setNotes((previous) => previous.filter((note) => note.id !== noteId));
    }

    return (
        <SafeAreaView style={styles.root}>
            <StatusBar style="light" />
            <View style={styles.header}>
                <Text style={styles.title}>SAMP Expo Demo</Text>
                <Text style={styles.subtitle}>Built from a phone, no laptop required.</Text>
            </View>

            <View style={styles.composer}>
                <TextInput
                    style={styles.input}
                    placeholder="Write a note…"
                    placeholderTextColor="#5f6973"
                    value={draft}
                    onChangeText={setDraft}
                    onSubmitEditing={addNote}
                    returnKeyType="done"
                />
                <TouchableOpacity style={styles.addButton} onPress={addNote}>
                    <Text style={styles.addButtonText}>Add</Text>
                </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.list}>
                {notes.length === 0 ? (
                    <Text style={styles.empty}>No notes yet. Add your first one above.</Text>
                ) : (
                    notes.map((note) => (
                        <View key={note.id} style={styles.noteCard}>
                            <Text style={styles.noteText}>{note.text}</Text>
                            <TouchableOpacity onPress={() => removeNote(note.id)}>
                                <Text style={styles.deleteText}>Delete</Text>
                            </TouchableOpacity>
                        </View>
                    ))
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1, backgroundColor: "#0b0d10" },
    header: { padding: 20, borderBottomColor: "#23272e", borderBottomWidth: 1 },
    title: { color: "#e6e8eb", fontSize: 20, fontWeight: "700" },
    subtitle: { color: "#8b939d", fontSize: 13, marginTop: 4 },
    composer: { flexDirection: "row", padding: 16, gap: 8 },
    input: {
        flex: 1,
        backgroundColor: "#15181d",
        color: "#e6e8eb",
        borderRadius: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderColor: "#23272e",
        borderWidth: 1,
    },
    addButton: {
        backgroundColor: "#7cf2c0",
        paddingHorizontal: 18,
        justifyContent: "center",
        borderRadius: 10,
    },
    addButtonText: { color: "#03110b", fontWeight: "700" },
    list: { padding: 16, paddingTop: 0, gap: 10 },
    empty: { color: "#8b939d", textAlign: "center", marginTop: 40 },
    noteCard: {
        backgroundColor: "#15181d",
        borderColor: "#23272e",
        borderWidth: 1,
        borderRadius: 10,
        padding: 14,
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
    },
    noteText: { color: "#e6e8eb", flex: 1, fontSize: 15 },
    deleteText: { color: "#ff7b7b", fontSize: 13 },
});
