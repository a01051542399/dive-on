import { useState, useCallback, useEffect } from "react";
import { TourListScreen } from "./screens/TourList";
import { TourDetailScreen } from "./screens/TourDetail";
import { WaiversTab } from "./screens/WaiversTab";
import { WaiverSignScreen } from "./screens/WaiverSign";
import { WaiverViewScreen } from "./screens/WaiverView";
import { JoinScreen } from "./screens/Join";
import { SettingsScreen } from "./screens/Settings";
import { SettingsDisplayScreen } from "./screens/SettingsDisplay";
import { SettingsProfileScreen } from "./screens/SettingsProfile";
import { SettingsGuideScreen } from "./screens/SettingsGuide";
import { AnnouncementsScreen } from "./screens/Announcements";
import { AdminDashboard } from "./screens/AdminDashboard";
import { LoginScreen } from "./screens/Login";
import { AuthProvider, useAuth } from "./lib/AuthContext";
import { initTheme } from "./theme";

export type Route =
  | { screen: "tours" }
  | { screen: "tour-detail"; tourId: number }
  | { screen: "waivers" }
  | { screen: "waiver-sign"; tourId: number }
  | { screen: "waiver-view"; tourId: number }
  | { screen: "join" }
  | { screen: "settings" }
  | { screen: "settings-display" }
  | { screen: "settings-profile" }
  | { screen: "settings-guide" }
  | { screen: "announcements" }
  | { screen: "admin" };

type Tab = "tours" | "waivers" | "settings";

function getTabFromRoute(route: Route): Tab {
  switch (route.screen) {
    case "tours":
    case "tour-detail":
    case "join":
      return "tours";
    case "waivers":
    case "waiver-sign":
    case "waiver-view":
      return "waivers";
    case "settings":
    case "settings-display":
    case "settings-profile":
    case "settings-guide":
    case "announcements":
    case "admin":
      return "settings";
  }
}

function MainApp() {
  const [route, setRoute] = useState<Route>({ screen: "tours" });
  const [refreshKey, setRefreshKey] = useState(0);
  const activeTab = getTabFromRoute(route);

  const navigate = useCallback((r: Route) => {
    setRoute(r);
    setRefreshKey((k) => k + 1);
  }, []);

  const renderScreen = () => {
    switch (route.screen) {
      case "tours":
        return <TourListScreen key={refreshKey} navigate={navigate} />;
      case "tour-detail":
        return (
          <TourDetailScreen
            key={refreshKey}
            tourId={route.tourId}
            navigate={navigate}
          />
        );
      case "waivers":
        return <WaiversTab key={refreshKey} navigate={navigate} />;
      case "waiver-sign":
        return (
          <WaiverSignScreen
            key={refreshKey}
            tourId={route.tourId}
            navigate={navigate}
          />
        );
      case "waiver-view":
        return (
          <WaiverViewScreen
            key={refreshKey}
            tourId={route.tourId}
            navigate={navigate}
          />
        );
      case "join":
        return <JoinScreen key={refreshKey} navigate={navigate} />;
      case "settings":
        return <SettingsScreen navigate={navigate} />;
      case "settings-display":
        return <SettingsDisplayScreen navigate={navigate} />;
      case "settings-profile":
        return <SettingsProfileScreen navigate={navigate} />;
      case "settings-guide":
        return <SettingsGuideScreen navigate={navigate} />;
      case "announcements":
        return <AnnouncementsScreen key={refreshKey} navigate={navigate} />;
      case "admin":
        return <AdminDashboard key={refreshKey} navigate={navigate} />;
    }
  };

  return (
    <>
      <div className="page">{renderScreen()}</div>

      {route.screen !== "admin" && <div className="tab-bar">
        <button
          className={`tab-item ${activeTab === "tours" ? "active" : ""}`}
          onClick={() => navigate({ screen: "tours" })}
        >
          <span>투어</span>
        </button>
        <button
          className={`tab-item ${activeTab === "waivers" ? "active" : ""}`}
          onClick={() => navigate({ screen: "waivers" })}
        >
          <span>동의서</span>
        </button>
        <button
          className={`tab-item ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => navigate({ screen: "settings" })}
        >
          <span>설정</span>
        </button>
      </div>}
    </>
  );
}

export default function App() {
  useEffect(() => { initTheme(); }, []);

  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const [migrating, setMigrating] = useState(false);
  const [migrationMsg, setMigrationMsg] = useState("");
  const [profileReady, setProfileReady] = useState(false);
  const [checkingProfile, setCheckingProfile] = useState(false);

  useEffect(() => {
    if (!user) {
      setProfileReady(false);
      return;
    }

    let cancelled = false;

    const init = async () => {
      // Check for local data that needs migration
      try {
        const { needsMigration, migrateLocalData } = await import("./lib/migrate-local-data");
        if (needsMigration()) {
          setMigrating(true);
          setMigrationMsg("기기 데이터를 서버로 이전 중...");
          try {
            await migrateLocalData((msg) => setMigrationMsg(msg));
          } catch {
            // Migration failed, but let the user continue
          }
          setMigrating(false);
        }
      } catch {}

      // Check setup completion: 신규(특히 OAuth) 사용자는 ProfileSetupScreen 노출
      setCheckingProfile(true);
      try {
        const { getProfile } = await import("./lib/supabase-store");
        const profile = await getProfile();
        if (!cancelled) {
          setProfileReady(profile.setupCompleted === true);
          setCheckingProfile(false);
        }
      } catch {
        if (!cancelled) {
          setProfileReady(false);
          setCheckingProfile(false);
        }
      }
    };

    init();
    return () => { cancelled = true; };
  }, [user]);

  if (loading || migrating || checkingProfile) {
    return (
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100%", background: "var(--background)", gap: 12,
      }}>
        <div style={{ color: "var(--muted)", fontSize: 16 }}>
          {migrating ? migrationMsg || "데이터 이전 중..." : "로딩 중..."}
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  // 프로필(이름)이 없으면 프로필 설정 먼저
  if (!profileReady) {
    return <ProfileSetupScreen onComplete={() => setProfileReady(true)} />;
  }

  return <MainApp />;
}

/** 신규 사용자 프로필 초기 설정 화면 (OAuth 포함) */
function ProfileSetupScreen({ onComplete }: { onComplete: () => void }) {
  const { user, signOut } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [divingLevel, setDivingLevel] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // OAuth/이메일 가입 시 채워진 기존 프로필 정보 로드 (이름/이메일 등 자동 입력)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getProfile } = await import("./lib/supabase-store");
        const profile = await getProfile();
        if (cancelled) return;
        setName(profile.name || "");
        setEmail(profile.email || user?.email || "");
        setPhone(profile.phone || "");
        setBirthDate(profile.birthDate || "");
        setDivingLevel(profile.divingLevel || "");
        setEmergencyContact(profile.emergencyContact || "");
      } catch {
        if (!cancelled) setEmail(user?.email || "");
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const formatPhone = (v: string) => {
    const d = v.replace(/[^0-9]/g, "").slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 7) return d.slice(0, 3) + "-" + d.slice(3);
    return d.slice(0, 3) + "-" + d.slice(3, 7) + "-" + d.slice(7);
  };
  const formatBirth = (v: string) => {
    const d = v.replace(/[^0-9]/g, "").slice(0, 8);
    if (d.length <= 4) return d;
    if (d.length <= 6) return d.slice(0, 4) + "-" + d.slice(4);
    return d.slice(0, 4) + "-" + d.slice(4, 6) + "-" + d.slice(6);
  };

  const handleSave = async () => {
    if (!name.trim()) { setError("이름을 입력해주세요"); return; }
    setSubmitting(true);
    setError("");
    try {
      const { setProfile } = await import("./lib/supabase-store");
      await setProfile({
        name: name.trim(),
        email: email || user?.email || "",
        grade: "멤버",
        phone: phone || undefined,
        birthDate: birthDate || undefined,
        divingLevel: divingLevel || undefined,
        emergencyContact: emergencyContact || undefined,
        setupCompleted: true, // ProfileSetupScreen 완료 → 다음 로그인부터는 스킵
      });
      onComplete();
    } catch {
      setError("저장에 실패했습니다. 다시 시도해주세요.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "12px 14px", borderRadius: 10,
    border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--foreground)", fontSize: 15, outline: "none",
    boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 14, fontWeight: 600, color: "var(--foreground)",
    marginBottom: 6, display: "block",
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      height: "100%", padding: "48px 24px 24px", boxSizing: "border-box",
      background: "var(--background)", overflowY: "auto",
    }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--foreground)", margin: "0 0 6px" }}>
        프로필 설정
      </h1>
      <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 24px", textAlign: "center" }}>
        환영합니다! 시작하기 전에 기본 정보를 입력해주세요.
      </p>

      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>이름 *</label>
          <input style={inputStyle} value={name}
            onChange={(e) => setName(e.target.value)} placeholder="이름을 입력하세요" />
        </div>
        <div>
          <label style={labelStyle}>전화번호</label>
          <input style={inputStyle} value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            placeholder="01012345678" inputMode="numeric" />
        </div>
        <div>
          <label style={labelStyle}>생년월일</label>
          <input style={inputStyle} value={birthDate}
            onChange={(e) => setBirthDate(formatBirth(e.target.value))}
            placeholder="19900101" inputMode="numeric" />
        </div>
        <div>
          <label style={labelStyle}>다이빙 레벨</label>
          <input style={inputStyle} value={divingLevel}
            onChange={(e) => setDivingLevel(e.target.value)}
            placeholder="예: OW, AOW, 레스큐, DM (선택)" />
        </div>
        <div>
          <label style={labelStyle}>비상연락처</label>
          <input style={inputStyle} value={emergencyContact}
            onChange={(e) => setEmergencyContact(e.target.value)}
            placeholder="예: 010-9876-5432 (배우자)"
            onKeyDown={(e) => e.key === "Enter" && handleSave()} />
        </div>

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 10,
            background: "rgba(239,68,68,0.15)", color: "var(--error)",
            fontSize: 13, fontWeight: 500, textAlign: "center",
          }}>
            {error}
          </div>
        )}

        <button onClick={handleSave} disabled={submitting}
          style={{
            width: "100%", padding: "14px 0", borderRadius: 12,
            background: "var(--primary)", color: "var(--on-primary)",
            border: "none", fontSize: 16, fontWeight: 700,
            cursor: submitting ? "wait" : "pointer",
            opacity: submitting ? 0.7 : 1, marginTop: 4,
          }}>
          {submitting ? "저장 중..." : "시작하기"}
        </button>

        <button onClick={signOut}
          style={{
            background: "none", border: "none", color: "var(--muted)",
            fontSize: 13, cursor: "pointer", marginTop: 4,
          }}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
