export type InputContext = 'editor' | 'game' | 'ui';

type ContextListener = (next: InputContext, previous: InputContext) => void;

let currentContext: InputContext = 'editor';
const listeners = new Set<ContextListener>();

export function setContext(context: InputContext): void {
  if (context === currentContext) return;
  const previous = currentContext;
  currentContext = context;

  for (const listener of listeners) {
    listener(context, previous);
  }
}

export function getContext(): InputContext {
  return currentContext;
}

export function onContextChange(listener: ContextListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
