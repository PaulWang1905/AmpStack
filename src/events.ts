/** Dispose listeners even when their asynchronous registration finishes after cleanup. */
export function registerListeners(
  registrations: Array<Promise<() => void>>,
  onError: (error: unknown) => void
): () => void {
  let disposed = false;
  const unlisteners: Array<() => void> = [];

  for (const registration of registrations) {
    registration.then((unlisten) => {
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    }).catch((error: unknown) => {
      if (!disposed) onError(error);
    });
  }

  return () => {
    disposed = true;
    unlisteners.splice(0).forEach((unlisten) => unlisten());
  };
}
