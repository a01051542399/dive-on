import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase, isSupabaseConfigured } from "./supabase";
import * as db from "./supabase-store";
import { isNative } from "./platform";
import { Browser } from "@capacitor/browser";
import { App as CapApp } from "@capacitor/app";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>;
  signUpWithEmail: (email: string, password: string, name: string) => Promise<{ error: string | null }>;
  signInWithKakao: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  user: null,
  session: null,
  loading: true,
  signInWithEmail: async () => ({ error: null }),
  signUpWithEmail: async () => ({ error: null }),
  signInWithKakao: async () => {},
  signInWithGoogle: async () => {},
  resetPassword: async () => ({ error: null }),
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

/** Sync auth user metadata → profiles table */
async function syncProfileFromUser(user: User) {
  try {
    const meta = user.user_metadata || {};
    const existing = await db.getProfile();
    const name = existing.name || meta.full_name || meta.name || meta.preferred_username || "";
    const email = existing.email || user.email || meta.email || "";
    if (name !== existing.name || email !== existing.email) {
      await db.setProfile({ ...existing, name, email, grade: existing.grade || "멤버" });
    }
  } catch {}
}

/** Provider-specific scopes
 *  Kakao: account_email/name 등은 비즈 앱 전환 필요. profile_nickname 만 요청
 *  Google: 기본 스코프(email, profile, openid) 사용
 */
function scopesFor(provider: "kakao" | "google"): string | undefined {
  if (provider === "kakao") return "profile_nickname";
  return undefined;
}

/** Native OAuth: system browser + deep link + PKCE code exchange */
async function handleNativeOAuth(provider: "kakao" | "google") {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: "com.diveon.app://callback",
        skipBrowserRedirect: true,
        scopes: scopesFor(provider),
      },
    });
    if (error || !data.url) return;
    await Browser.open({ url: data.url });
  } catch {
    // Browser.open failed silently
  }
}

/** Web OAuth: standard redirect */
async function handleWebOAuth(provider: "kakao" | "google") {
  await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: window.location.origin,
      scopes: scopesFor(provider),
    },
  });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) syncProfileFromUser(s.user);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) syncProfileFromUser(s.user);
      setLoading(false);
    });

    // Native: listen for deep link with authorization code
    let appUrlListener: { remove: () => void } | undefined;
    if (isNative()) {
      CapApp.addListener("appUrlOpen", async ({ url }) => {
        try { await Browser.close(); } catch {}

        // Try hash fragment first (implicit flow: #access_token=...&refresh_token=...)
        const hashPart = url.includes("#") ? url.split("#")[1] : "";
        if (hashPart) {
          const params = new URLSearchParams(hashPart);
          const accessToken = params.get("access_token");
          const refreshToken = params.get("refresh_token");
          if (accessToken && refreshToken) {
            await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
            return;
          }
        }

        // Try query parameter (PKCE flow: ?code=...)
        const codeMatch = url.match(/[?&]code=([^&]+)/);
        if (codeMatch) {
          await supabase.auth.exchangeCodeForSession(codeMatch[1]);
        }
      }).then(l => { appUrlListener = l; });
    }

    return () => {
      subscription.unsubscribe();
      appUrlListener?.remove();
    };
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    if (!isSupabaseConfigured) return { error: "Supabase가 설정되지 않았습니다" };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error: error.message === "Invalid login credentials" ? "이메일 또는 비밀번호가 올바르지 않습니다" : error.message };
    return { error: null };
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string, name: string) => {
    if (!isSupabaseConfigured) return { error: "Supabase가 설정되지 않았습니다" };
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    if (error) return { error: error.message };
    await supabase.auth.signOut();
    return { error: null };
  }, []);

  const signInWithKakao = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const native = isNative();
    if (native) {
      await handleNativeOAuth("kakao");
    } else {
      await handleWebOAuth("kakao");
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    const native = isNative();
    if (native) {
      await handleNativeOAuth("google");
    } else {
      await handleWebOAuth("google");
    }
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    if (!isSupabaseConfigured) return { error: "Supabase가 설정되지 않았습니다" };
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) return { error: error.message };
    return { error: null };
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured) await supabase.auth.signOut();
    setUser(null);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, session, loading, signInWithEmail, signUpWithEmail, signInWithKakao, signInWithGoogle, resetPassword, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}
