import { useState, useEffect } from "react";
import type { Route } from "../App";
import type { Tour, Waiver } from "../types";
import { useToast } from "../toast";
import * as db from "../lib/supabase-store";
import { HEALTH_CHECKLIST } from "../waiver-template";
import { exportWaiverPDF, exportAllWaiversPDF } from "../utils/export-waiver-pdf";
import { Modal } from "../components/Modal";

interface Props {
  tourId: number;
  navigate: (r: Route) => void;
}

export function WaiverViewScreen({ tourId, navigate }: Props) {
  const [waivers, setWaivers] = useState<Waiver[]>([]);
  const [tour, setTour] = useState<Tour | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Waiver | null>(null);
  const { confirm, toast } = useToast();

  const loadData = async () => {
    try {
      const [waiversData, tourData] = await Promise.all([
        db.listWaiversByTour(tourId),
        db.getTourById(tourId),
      ]);
      setWaivers(waiversData);
      setTour(tourData);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [tourId]);

  const parseInfo = (w: Waiver) => {
    try {
      return typeof w.personalInfo === "string"
        ? JSON.parse(w.personalInfo)
        : w.personalInfo;
    } catch {
      return {};
    }
  };

  const parseChecklist = (w: Waiver): boolean[] => {
    try {
      const cl = typeof w.healthChecklist === "string"
        ? JSON.parse(w.healthChecklist)
        : w.healthChecklist;
      return cl || [];
    } catch {
      return [];
    }
  };

  const handleDelete = async (waiverId: number) => {
    if (await confirm("이 서명을 삭제하시겠습니까?")) {
      await db.deleteWaiver(waiverId);
      const updated = await db.listWaiversByTour(tourId);
      setWaivers(updated);
      setSelected(null);
      toast("서명이 삭제되었습니다", "info");
    }
  };

  const formatDate = (d: string | Date | undefined) => {
    if (!d) return "-";
    return new Date(d).toLocaleDateString("ko-KR");
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 14 }}>
        로딩 중...
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="p-16" style={{ paddingBottom: 0 }}>
        <button
          className="back-btn"
          onClick={() => navigate({ screen: "tour-detail", tourId })}
        >
          ← 뒤로
        </button>
      </div>

      <div className="page-header">
        <h1 style={{ fontSize: 22 }}>서명 목록</h1>
        <p>총 {waivers.length}건의 서명</p>
      </div>

      {/* Waiver List */}
      <div className="p-16" style={{ paddingTop: 0 }}>
        {waivers.length === 0 ? (
          <div className="empty-state">
            <div style={{ fontSize: 20, marginBottom: 12, color: "var(--muted)" }}>-</div>
            <div>서명된 면책동의서가 없습니다</div>
          </div>
        ) : (
          <>
            {waivers.map((waiver) => (
              <div
                key={waiver.id}
                className="card"
                style={{ cursor: "pointer" }}
                onClick={() => setSelected(waiver)}
              >
                <div
                  className="flex-row"
                  style={{
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div
                    className="flex-row"
                    style={{ alignItems: "center", gap: 10 }}
                  >
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: "50%",
                        background: "var(--success-alpha)",
                        color: "var(--success)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </span>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 600 }}>
                        {waiver.signerName}
                      </div>
                      <div
                        className="text-muted"
                        style={{ fontSize: 13, marginTop: 2 }}
                      >
                        {formatDate(waiver.signedAt)}
                      </div>
                    </div>
                  </div>
                  <span
                    style={{
                      color: "var(--muted)",
                      fontSize: 18,
                      fontWeight: 300,
                    }}
                  >
                    ›
                  </span>
                </div>
              </div>
            ))}

            {/* 전체 PDF 다운로드 버튼 */}
            <button
              className="btn btn-primary"
              style={{ marginTop: 16 }}
              onClick={() => {
                exportAllWaiversPDF(waivers, tour);
              }}
            >
              전체 PDF 다운로드 ({waivers.length}건)
            </button>
          </>
        )}
      </div>

      {/* Detail Modal */}
      <Modal open={!!selected} onClose={() => setSelected(null)}>
          {selected && <>
            {/* Modal header */}
            <div
              className="flex-row"
              style={{
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h2 className="modal-title" style={{ marginBottom: 0 }}>
                서명 상세
              </h2>
              <button
                style={{
                  background: "none",
                  color: "var(--muted)",
                  fontSize: 22,
                  padding: 4,
                  border: "none",
                  cursor: "pointer",
                }}
                onClick={() => setSelected(null)}
              >
                ✕
              </button>
            </div>

            {/* Personal Info Section */}
            {(() => {
              const info = parseInfo(selected);
              const checklist = parseChecklist(selected);
              const checkedItems = HEALTH_CHECKLIST.filter(
                (_, i) => checklist[i]
              );

              return (
                <>
                  {/* Personal Info */}
                  <div style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "var(--foreground)",
                        marginBottom: 10,
                      }}
                    >
                      개인 정보
                    </div>
                    <div
                      style={{
                        background: "var(--surface-light)",
                        borderRadius: 12,
                        padding: 14,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <InfoRow label="이름" value={info?.name} />
                      <InfoRow label="생년월일" value={info?.birthDate} />
                      <InfoRow label="전화번호" value={info?.phone} />
                      <InfoRow label="다이빙 레벨" value={info?.divingLevel} />
                      <InfoRow label="투어 기간" value={info?.tourPeriod} />
                      <InfoRow label="투어 장소" value={info?.tourLocation} />
                      <InfoRow
                        label="비상 연락처"
                        value={info?.emergencyContact}
                      />
                    </div>
                  </div>

                  {/* Health Checklist (only checked items) */}
                  {checkedItems.length > 0 && (
                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: "var(--foreground)",
                          marginBottom: 10,
                        }}
                      >
                        건강 체크리스트
                      </div>
                      <div
                        style={{
                          background: "var(--warning-alpha)",
                          borderRadius: 12,
                          padding: 14,
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                        }}
                      >
                        {checkedItems.map((item, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 14,
                              color: "var(--warning)",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: 8,
                            }}
                          >
                            <span style={{ flexShrink: 0 }}>⚠</span>
                            <span>{item}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Signature Image */}
                  <div style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "var(--foreground)",
                        marginBottom: 10,
                      }}
                    >
                      서명
                    </div>
                    <img
                      src={selected.signatureImage}
                      style={{
                        width: "100%",
                        height: 120,
                        objectFit: "contain",
                        background: "#fff",
                        borderRadius: 8,
                      }}
                      alt="서명"
                    />
                  </div>

                  {/* Signed Date */}
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--muted)",
                      textAlign: "center",
                      marginBottom: 20,
                    }}
                  >
                    서명일: {formatDate(selected.signedAt)}
                  </div>

                  {/* 개인 PDF 출력 */}
                  <button
                    className="btn btn-primary"
                    style={{ marginBottom: 8 }}
                    onClick={() => {
                      exportWaiverPDF(selected, tour);
                    }}
                  >
                    개인 PDF 출력
                  </button>

                  {/* Delete Button */}
                  <button
                    className="btn btn-danger"
                    onClick={() => handleDelete(selected.id)}
                  >
                    서명 삭제
                  </button>
                </>
              );
            })()}
          </>}
      </Modal>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  return (
    <div
      className="flex-row"
      style={{
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 14,
      }}
    >
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span style={{ color: "var(--foreground)", fontWeight: 500 }}>
        {value || "-"}
      </span>
    </div>
  );
}
