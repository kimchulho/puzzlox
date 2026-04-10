import { useCallback, useEffect, useState } from "react";
import type { AuthUser } from "@contracts/auth";
import GameShell from "./GameShell";
import { loadStoredSession, loginWithTossApp, persistSession } from "./lib/tossSession";
import { useTossSafeAreaInsets } from "./useTossSafeAreaInsets";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [tossLoginBusy, setTossLoginBusy] = useState(false);
  const tossSafe = useTossSafeAreaInsets();

  useEffect(() => {
    const s = loadStoredSession();
    if (s) setUser(s.user);
    setReady(true);
  }, []);

  const handleRequestTossLogin = useCallback(async () => {
    if (tossLoginBusy) return;
    setTossLoginBusy(true);
    try {
      const auth = await loginWithTossApp();
      persistSession(auth);
      setUser(auth.user);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      window.alert(msg);
    } finally {
      setTossLoginBusy(false);
    }
  }, [tossLoginBusy]);

  if (!ready) {
    return (
      <div
        className="h-screen w-screen bg-slate-950 flex items-center justify-center text-white text-lg box-border"
        style={{
          paddingTop: tossSafe.top,
          paddingLeft: tossSafe.left,
          paddingRight: tossSafe.right,
          paddingBottom: tossSafe.bottom,
        }}
      >
        …
      </div>
    );
  }

  return (
    <GameShell
      user={user}
      setUser={setUser}
      onLoggedOut={() => setUser(null)}
      onRequestTossLogin={handleRequestTossLogin}
      tossLoginBusy={tossLoginBusy}
    />
  );
}
