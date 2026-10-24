export function createAuthSessionSync({loadUser, applyUser, onError}) {
  let generation = 0;

  return {
    invalidate() {
      generation += 1;
      return generation;
    },
    async sync(session) {
      const request = ++generation;
      const authUser = session?.user || null;
      try {
        const user = await loadUser(authUser);
        if (request !== generation) return;
        return applyUser(user);
      } catch (error) {
        if (request !== generation) return;
        onError(error);
      }
    },
  };
}
