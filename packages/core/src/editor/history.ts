export interface HistoryState<T> {
  current: T | null;
  past: Array<T | null>;
  future: Array<T | null>;
}

export function commitHistory<T>(
  state: HistoryState<T>,
  next: T,
  limit = 50,
): HistoryState<T> {
  return {
    current: next,
    past: [...state.past, state.current].slice(-limit),
    future: [],
  };
}

export function undoHistory<T>(state: HistoryState<T>) {
  if (state.past.length === 0) {
    return { state, target: undefined };
  }
  const target = state.past[state.past.length - 1];
  return {
    target,
    state: {
      current: target,
      past: state.past.slice(0, -1),
      future: [state.current, ...state.future],
    },
  };
}

export function redoHistory<T>(state: HistoryState<T>) {
  if (state.future.length === 0) {
    return { state, target: undefined };
  }
  const target = state.future[0];
  return {
    target,
    state: {
      current: target,
      past: [...state.past, state.current],
      future: state.future.slice(1),
    },
  };
}
