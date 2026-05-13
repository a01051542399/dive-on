import { useState, useEffect } from "react";
import type { Route } from "../App";
import { useToast } from "../toast";
import * as db from "../lib/supabase-store";
import { formatCurrency } from "../store";
import { useTours, useUnreadAnnouncementCount } from "../hooks/useSupabase";
import { getTheme } from "../theme";
import { Modal } from "../components/Modal";

interface Props {
  navigate: (r: Route) => void;
}

export function TourListScreen({ navigate }: Props) {
  const { tours, loading, refresh } = useTours();
  const { count: unreadAnnouncements } = useUnreadAnnouncementCount();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);
  const [deletePinValue, setDeletePinValue] = useState("");
  const { toast, confirm } = useToast();
  const theme = getTheme();
  const isDark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  // 앱 시작 시 7일 지난 임시보관 투어 자동 삭제
  useEffect(() => { db.cleanupTrash(); }, []);

  // Hidden tours (now from app settings)
  const [hiddenTours, setHiddenTours] = useState<number[]>([]);
  useEffect(() => {
    db.getAppSettings().then((s) => setHiddenTours(s.hiddenTourIds || []));
  }, []);
  const visibleTours = tours.filter((t) => !hiddenTours.includes(t.id));

  const [profile, setProfile] = useState({ name: "", email: "", grade: "멤버" as string });
  useEffect(() => { db.getProfile().then(setProfile); }, []);

  const [form, setForm] = useState({
    name: "",
    accessCode: "",
    dateStart: "",
    dateEnd: "",
    location: "",
  });

  // Format 6-digit date string to YY.MM.DD display
  const formatDateInput = (v: string) => v.replace(/[^0-9]/g, "").slice(0, 6);
  const displayDate = (v: string) => {
    if (v.length <= 2) return v;
    if (v.length <= 4) return v.slice(0, 2) + "." + v.slice(2);
    return v.slice(0, 2) + "." + v.slice(2, 4) + "." + v.slice(4);
  };
  const isValidDate = (v: string) => {
    if (v.length !== 6) return false;
    const m = parseInt(v.slice(2, 4), 10);
    const d = parseInt(v.slice(4, 6), 10);
    return m >= 1 && m <= 12 && d >= 1 && d <= 31;
  };

  const handleCreate = async () => {
    if (!profile.name.trim()) {
      toast("설정에서 이름을 먼저 등록해주세요", "warning");
      return;
    }
    if (!form.name.trim()) {
      toast("투어 이름을 입력해주세요", "warning");
      return;
    }
    if (!isValidDate(form.dateStart) || !isValidDate(form.dateEnd)) {
      toast("날짜를 정확히 입력해주세요 (6자리: 연월일)", "warning");
      return;
    }
    if (!/^\d{4}$/.test(form.accessCode)) {
      toast("수정 비밀번호는 4자리 숫자여야 합니다", "warning");
      return;
    }
    try {
      const dateStr = displayDate(form.dateStart) + " ~ " + displayDate(form.dateEnd);
      await db.createTour({ ...form, date: dateStr, createdBy: profile.name.trim() });
      await refresh();
      setShowCreate(false);
      setForm({ name: "", accessCode: "", dateStart: "", dateEnd: "", location: "" });
      toast("투어가 생성되었습니다", "success");
    } catch (e: any) {
      toast(e.message || "투어 생성에 실패했습니다", "error");
    }
  };


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Fixed Header */}
      <div style={{ flexShrink: 0 }}>
        {/* Logo */}
        <div className="logo-header">
          <img
            src={isDark ? "/logo-full.png" : "/logo-full-official.png"}
            alt="Dive ON"
            className="logo-img"
          />
        </div>

        {/* Header with actions */}
        <div className="tour-list-header">
          <h1>다이빙 투어</h1>
          <button
            className="header-btn"
            onClick={() => navigate({ screen: "announcements" })}
            aria-label="공지사항"
            style={{ position: "relative", padding: "6px 10px" }}
          >
            🔔
            {unreadAnnouncements > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "var(--error)", color: "#fff",
                fontSize: 10, fontWeight: 700,
                padding: "1px 5px", borderRadius: 10, lineHeight: 1.4,
                minWidth: 16, textAlign: "center",
              }}>
                {unreadAnnouncements > 99 ? "99+" : unreadAnnouncements}
              </span>
            )}
          </button>
          <button className="header-btn" onClick={() => navigate({ screen: "join" })}>
            ▶ 참여
          </button>
          <button className="header-btn filled" onClick={() => setShowCreate(true)}>
            + 새 투어
          </button>
        </div>
      </div>

      {/* Scrollable Tour List */}
      <div className="p-16" style={{ paddingTop: 0, flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {loading ? (
          <div className="empty-state">
            <div style={{ color: "var(--muted)", fontSize: 14 }}>로딩 중...</div>
          </div>
        ) : visibleTours.length === 0 ? (
          <div className="empty-state" style={{
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            flex: 1,
          }}>
            <svg width="56" height="40" viewBox="0 0 56 40" fill="none" style={{ marginBottom: 12, opacity: 0.45 }}>
              <path d="M6 10c4-3 7-3 11 0s7 3 11 0 7-3 11 0 7 3 11 0" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
              <path d="M6 20c4-3 7-3 11 0s7 3 11 0 7-3 11 0 7 3 11 0" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
              <path d="M6 30c4-3 7-3 11 0s7 3 11 0 7-3 11 0 7 3 11 0" stroke="var(--primary)" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
            </svg>
            <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>투어가 없습니다</div>
            <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6, textAlign: "center" }}>
              새 다이빙 투어를 만들거나<br />입장코드로 투어에 참여하세요
            </div>
          </div>
        ) : (
          visibleTours.map((tour) => (
            <div
              key={tour.id}
              className="tour-list-card"
              onClick={() => navigate({ screen: "tour-detail", tourId: tour.id })}
            >
              <div className="card-header">
                <div>
                  <div className="card-title">{tour.name}</div>
                  <div className="card-meta">
                    {tour.date && <span>{tour.date}</span>}
                    {tour.location && <span>{tour.location}</span>}
                  </div>
                </div>
                <div className="card-actions" style={{ display: "flex", gap: 8 }}>
                  <button
                    style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 12, cursor: "pointer", padding: 4 }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (await confirm("이 투어를 목록에서 숨기시겠습니까?")) {
                        const updated = [...hiddenTours, tour.id];
                        setHiddenTours(updated);
                        db.setHiddenTourIds(updated);
                        toast("목록에서 숨겼습니다", "info");
                      }
                    }}
                  >
                    숨기기
                  </button>
                  <button
                    style={{ background: "none", border: "none", color: "var(--error)", fontSize: 12, cursor: "pointer", padding: 4 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(tour.id);
                      setDeletePinValue("");
                    }}
                  >
                    삭제
                  </button>
                </div>
              </div>
              <div className="card-footer">
                <span>주최: {tour.createdBy || "-"}</span>
                <span style={{ display: "flex", gap: 12 }}>
                  <span>{tour.participants.length}명</span>
                  {tour.expenses.length > 0 && (
                    <span style={{ color: "var(--primary)", fontWeight: 600 }}>
                      {formatCurrency(tour.expenses.reduce((s, e) => s + e.amount, 0))}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Create Tour Modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)}>
        <div className="modal-title">새 투어 만들기</div>

            {/* Name (required) */}
            <div className="input-group">
              <div className="input-label">투어 이름 *</div>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="예: 동해 수중정화활동"
              />
            </div>

            {/* CreatedBy (auto from profile) */}
            <div className="input-group">
              <div className="input-label">주최자</div>
              <div style={{
                padding: "12px 14px", borderRadius: 12,
                background: "var(--surface-light)", color: "var(--foreground)",
                fontSize: 15, fontWeight: 600,
              }}>
                {profile.name || <span style={{ color: "var(--error)", fontWeight: 400, fontSize: 13 }}>설정에서 이름을 먼저 등록해주세요</span>}
              </div>
            </div>

            {/* Access Code (required, exactly 4 digits) */}
            <div className="input-group">
              <div className="input-label">수정 비밀번호 * (4자리 숫자)</div>
              <input
                className="input"
                value={form.accessCode}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 4);
                  setForm({ ...form, accessCode: v });
                }}
                placeholder="0000"
                inputMode="numeric"
                maxLength={4}
                style={{
                  textAlign: "center",
                  fontSize: 28,
                  letterSpacing: 12,
                  fontWeight: 700,
                }}
              />
              <div style={{ fontSize: 11, color: "var(--foreground)", marginTop: 4, opacity: 0.7 }}>
                *내용 수정시 사용 관리자에게만 공개하십시오
              </div>
            </div>

            {/* Date (required, 6-digit start ~ end) */}
            <div className="input-group">
              <div className="input-label">투어 기간 * (연월일 6자리)</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  className="input"
                  value={displayDate(form.dateStart)}
                  onChange={(e) => setForm({ ...form, dateStart: formatDateInput(e.target.value) })}
                  placeholder="260401"
                  inputMode="numeric"
                  maxLength={8}
                  style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 600, letterSpacing: 1 }}
                />
                <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 16 }}>~</span>
                <input
                  className="input"
                  value={displayDate(form.dateEnd)}
                  onChange={(e) => setForm({ ...form, dateEnd: formatDateInput(e.target.value) })}
                  placeholder="260403"
                  inputMode="numeric"
                  maxLength={8}
                  style={{ flex: 1, textAlign: "center", fontSize: 16, fontWeight: 600, letterSpacing: 1 }}
                />
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                예: 260401 ~ 260403 (26년 4월 1일 ~ 3일)
              </div>
            </div>

            {/* Location (optional) */}
            <div className="input-group">
              <div className="input-label">장소</div>
              <input
                className="input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="예: 사라웃리조트"
              />
            </div>

            <div className="flex-row gap-12 mt-8">
              <button className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                취소
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                만들기
              </button>
            </div>
      </Modal>

      {/* Delete Tour Modal */}
      {deleteTarget !== null && (() => {
        const targetTour = tours.find((t) => t.id === deleteTarget);
        if (!targetTour) return null;
        return (
          <Modal open onClose={() => setDeleteTarget(null)}>
              <div className="modal-title" style={{ color: "var(--error)" }}>투어 삭제</div>

              <div style={{
                background: "var(--warning-alpha)", borderRadius: 10, padding: 14,
                fontSize: 13, color: "var(--warning)", lineHeight: 1.7, marginBottom: 16,
              }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>"{targetTour.name}"</div>
                삭제된 투어는 <strong>임시보관함</strong>에 7일간 보관 후 자동 삭제됩니다.
                <br />임시보관 기간 내에는 설정 &gt; 임시보관함에서 복원할 수 있습니다.
              </div>

              <div className="input-group">
                <div className="input-label">수정 비밀번호 입력 (4자리)</div>
                <input
                  className="input"
                  type="password"
                  value={deletePinValue}
                  onChange={(e) => setDeletePinValue(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                  placeholder="0000"
                  inputMode="numeric"
                  maxLength={4}
                  autoFocus
                  style={{ textAlign: "center", fontSize: 24, letterSpacing: 12, fontWeight: 700 }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && deletePinValue.length === 4) {
                      const valid = await db.verifyTourAccessCode(deleteTarget, deletePinValue);
                      if (valid) {
                        await db.softDeleteTour(deleteTarget);
                        await refresh();
                        setDeleteTarget(null);
                        toast("투어가 임시보관함으로 이동되었습니다 (7일 후 자동 삭제)", "info");
                      } else {
                        toast("비밀번호가 일치하지 않습니다", "error");
                        setDeletePinValue("");
                      }
                    }
                  }}
                />
              </div>

              <div className="flex-row gap-12 mt-8">
                <button className="btn btn-secondary" onClick={() => setDeleteTarget(null)}>
                  취소
                </button>
                <button
                  className="btn btn-danger"
                  style={{ opacity: deletePinValue.length === 4 ? 1 : 0.5 }}
                  disabled={deletePinValue.length !== 4}
                  onClick={async () => {
                    const valid = await db.verifyTourAccessCode(deleteTarget, deletePinValue);
                    if (valid) {
                      await db.softDeleteTour(deleteTarget);
                      await refresh();
                      setDeleteTarget(null);
                      toast("투어가 임시보관함으로 이동되었습니다 (7일 후 자동 삭제)", "info");
                    } else {
                      toast("비밀번호가 일치하지 않습니다", "error");
                      setDeletePinValue("");
                    }
                  }}
                >
                  삭제
                </button>
              </div>
          </Modal>
        );
      })()}

    </div>
  );
}
