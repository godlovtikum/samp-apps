import React, { createContext, useContext, useReducer, useMemo } from 'react';

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  location?: { lat: number; lng: number };
};

type State = { notes: Note[] };

type Action =
  | { type: 'add'; note: Note }
  | { type: 'remove'; id: string };

const initial: State = {
  notes: [
    {
      id: 'welcome',
      title: 'Welcome to SAMP APPS',
      body: 'This is a real demo — tap "New" to add your own field note. Entries stay on this device for the session.',
      createdAt: Date.now(),
    },
  ],
};

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add':
      return { notes: [a.note, ...s.notes] };
    case 'remove':
      return { notes: s.notes.filter(n => n.id !== a.id) };
    default:
      return s;
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}
