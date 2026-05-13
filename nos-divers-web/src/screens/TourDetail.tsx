import { useState, useEffect, useMemo } from "react";
import * as db from "../lib/supabase-store";
import { calculateSettlement, formatCurrency, formatDate, formatDateTime } from "../store";
import { useToast } from "../toast";
import { useIsAdmin } from "../hooks/useSupabase";
import type { Route } from "../App";
import type { Tour } from "../types";
import { CommentTab } from "../components/CommentTab";
import { exportSettlementPDF } from "../utils/export-pdf";
import { exportSettlementExcel } from "../utils/export-excel";
import { Modal } from "../components/Modal";

interface Props {
  tourId: number;
  navigate: (r: Route) => void;
}

type Tab = "participants" | "expenses" | "settlement";

export function TourDetailScreen({ tourId, navigate }: Props) {
  const [tour, setTour] = useState<Tour | undefined>(undefined);
  const [tourLoading, setTourLoading] = useState(true);
  const { isAdmin } = useIsAdmin();
  const [activeTab, setActiveTab] = useState<Tab>("participants");
  const [newParticipantName, setNewParticipantName] = useState("");
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [selectedExpenseId, setSelectedExpenseId] = useState<number | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const currentUser = localStorage.getItem("nos_divers_tour_user_" + tourId);
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const { toast, confirm } = useToast();

  // Expense form state
  const [expenseForm, setExpenseForm] = useState({
    name: "",
    amount: "",
    paidBy: 0,
    splitAmong: [] as number[],
    currency: "KRW",
    exchangeRate: 1,
  });
  const [splitType, setSplitType] = useState<"equal" | "custom">("equal");
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [expenseDateTime, setExpenseDateTime] = useState("");

  // Currency & exchange rate
  const CURRENCIES = [
    { code: "KRW", symbol: "₩", name: "한국 원" },
    { code: "USD", symbol: "$", name: "미국 달러" },
    { code: "PHP", symbol: "₱", name: "필리핀 페소" },
    { code: "THB", symbol: "฿", name: "태국 바트" },
    { code: "IDR", symbol: "Rp", name: "인도네시아 루피아" },
    { code: "JPY", symbol: "¥", name: "일본 엔" },
  ];
  const [customCurrencyCode, setCustomCurrencyCode] = useState("");
  const [customCurrencySymbol, setCustomCurrencySymbol] = useState("");
  const [rateLoading, setRateLoading] = useState(false);
  const [receiptImage, setReceiptImage] = useState<string | undefined>(undefined);
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);

  const fetchExchangeRate = async (code: string) => {
    if (code === "KRW") return;
    setRateLoading(true);
    try {
      const res = await fetch(`https://open.er-api.com/v6/latest/KRW`);
      const data = await res.json();
      if (data.rates && data.rates[code]) {
        const rate = 1 / data.rates[code]; // KRW per 1 foreign unit
        const rounded = Math.round(rate * 100) / 100;
        setExpenseForm((prev) => ({ ...prev, exchangeRate: rounded }));
      } else {
        toast("환율을 가져올 수 없습니다", "warning");
      }
    } catch {
      toast("환율 조회에 실패했습니다. 수동으로 입력해주세요.", "warning");
    }
    setRateLoading(false);
  };

  const refresh = async () => {
    const data = await db.getTourById(tourId);
    setTour(data);
    setTourLoading(false);
  };
  useEffect(() => { refresh(); }, [tourId]);

  const [waivers, setWaivers] = useState<import("../types").Waiver[]>([]);
  useEffect(() => {
    db.listWaiversByTour(tourId).then(setWaivers);
  }, [tourId, tour]);

  // These hooks must be before early returns to maintain consistent hook order
  const customTotal = useMemo(() => {
    return expenseForm.splitAmong.reduce(
      (sum, pid) => sum + (parseInt(customAmounts[String(pid)] || "0", 10) || 0),
      0
    );
  }, [customAmounts, expenseForm.splitAmong]);

  const [showParticipants, setShowParticipants] = useState(false);

  if (tourLoading) {
    return (
      <div className="p-16 text-center text-muted" style={{ marginTop: 40 }}>
        로딩 중...
      </div>
    );
  }

  if (!tour) {
    return (
      <div className="p-16 text-center text-muted" style={{ marginTop: 40 }}>
        투어를 찾을 수 없습니다
      </div>
    );
  }

  const settlements = calculateSettlement(tour);
  const totalExpensesKRW = tour.expenses.reduce((sum, e) => sum + e.amount * (e.exchangeRate || 1), 0);

  const getParticipantName = (pid: number) =>
    tour.participants.find((p) => p.id === pid)?.name || "알 수 없음";

  const requirePin = (action: () => void) => {
    // 관리자 모드면 PIN 우회 (단일 비밀번호로 모든 관리)
    if (isAdmin) {
      action();
      return;
    }
    setPendingAction(() => action);
    setPinValue("");
    setShowPinModal(true);
  };

  const verifyPin = () => {
    if (pinValue === tour.accessCode) {
      setShowPinModal(false);
      pendingAction?.();
    } else {
      toast("PIN이 올바르지 않습니다", "error");
    }
  };

  const handleAddParticipant = async () => {
    if (!newParticipantName.trim()) return;
    const trimmed = newParticipantName.trim();
    if (tour.participants.some((p) => p.name === trimmed)) {
      toast("이미 같은 이름의 참여자가 있습니다. 동명이인은 이름 뒤에 숫자를 붙여주세요 (예: " + trimmed + "2)", "warning");
      return;
    }
    const profile = await db.getProfile();
    const addedBy = currentUser || profile.name || undefined;
    await db.addParticipant(tourId, trimmed, addedBy);
    setNewParticipantName("");
    await refresh();
  };

  const handleRemoveParticipant = async (participantId: number) => {
    const name = tour.participants.find((p) => p.id === participantId)?.name || "";
    const ok = await confirm(`"${name}" 참여자를 삭제하시겠습니까?`);
    if (ok) {
      await db.removeParticipant(tourId, participantId);
      await refresh();
    }
  };

  const openExpenseModal = () => {
    if (tour.participants.length === 0) {
      toast("먼저 참여자를 추가해주세요.", "warning");
      return;
    }
    setExpenseForm({
      name: "",
      amount: "",
      paidBy: tour.participants[0]?.id ?? 0,
      splitAmong: tour.participants.map((p) => p.id),
      currency: "KRW",
      exchangeRate: 1,
    });
    setSplitType("equal");
    setCustomAmounts({});
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    setExpenseDateTime(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`);
    setReceiptImage(undefined);
    setEditingExpenseId(null);
    setShowExpenseForm(true);
  };

  const openEditExpenseModal = (expenseId: number) => {
    const expense = tour.expenses.find((e) => e.id === expenseId);
    if (!expense) return;
    setExpenseForm({
      name: expense.name,
      amount: String(expense.amount),
      paidBy: expense.paidBy,
      splitAmong: [...expense.splitAmong],
      currency: expense.currency || "KRW",
      exchangeRate: expense.exchangeRate || 1,
    });
    setSplitType(expense.splitType || "equal");
    if (expense.splitType === "custom" && expense.splitAmounts) {
      const ca: Record<string, string> = {};
      for (const [k, v] of Object.entries(expense.splitAmounts)) {
        ca[k] = String(v);
      }
      setCustomAmounts(ca);
    } else {
      setCustomAmounts({});
    }
    {
      const d = expense.createdAt ? new Date(expense.createdAt) : new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setExpenseDateTime(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`);
    }
    setReceiptImage(expense.receiptImage);
    setEditingExpenseId(expenseId);
    setShowExpenseForm(true);
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast("영수증 이미지는 5MB 이하만 가능합니다", "warning");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReceiptImage(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveExpense = async () => {
    if (!expenseForm.name || !expenseForm.amount || !expenseForm.paidBy) {
      toast("필수 항목을 모두 입력해주세요", "warning");
      return;
    }
    const amount = Number(expenseForm.amount.replace(/[^0-9]/g, ""));
    if (isNaN(amount) || amount <= 0) return;

    // Exchange rate validation
    const rate = expenseForm.exchangeRate;
    if (expenseForm.currency !== "KRW" && (!rate || isNaN(rate) || rate <= 0)) {
      toast("환율을 올바르게 입력해주세요 (0보다 큰 값)", "warning");
      return;
    }

    const splitAmong =
      expenseForm.splitAmong.length > 0
        ? expenseForm.splitAmong
        : tour.participants.map((p) => p.id);

    if (splitType === "custom") {
      const amounts: Record<string, number> = {};
      let total = 0;
      splitAmong.forEach((pid) => {
        const val = parseInt(customAmounts[String(pid)] || "0", 10);
        amounts[String(pid)] = val;
        total += val;
      });
      if (total !== amount) {
        toast(
          `개별 금액 합계(${formatCurrency(total)})가 총 금액(${formatCurrency(amount)})과 일치하지 않습니다.`,
          "error"
        );
        return;
      }
      const createdAtISO = expenseDateTime ? new Date(expenseDateTime).toISOString() : new Date().toISOString();
      if (editingExpenseId !== null) {
        await db.editExpense(tourId, editingExpenseId, {
          name: expenseForm.name,
          amount,
          currency: expenseForm.currency,
          exchangeRate: expenseForm.exchangeRate,
          paidBy: expenseForm.paidBy,
          splitAmong,
          splitType: "custom",
          splitAmounts: amounts,
          receiptImage,
          lastModifiedBy: currentUser || "알 수 없음",
        });
      } else {
        await db.addExpense({
          tourId,
          name: expenseForm.name,
          amount,
          currency: expenseForm.currency,
          exchangeRate: expenseForm.exchangeRate,
          paidBy: expenseForm.paidBy,
          splitAmong,
          splitType: "custom",
          splitAmounts: amounts,
          receiptImage,
          createdAt: createdAtISO,
        });
      }
    } else {
      const createdAtISO = expenseDateTime ? new Date(expenseDateTime).toISOString() : new Date().toISOString();
      if (editingExpenseId !== null) {
        await db.editExpense(tourId, editingExpenseId, {
          name: expenseForm.name,
          amount,
          currency: expenseForm.currency,
          exchangeRate: expenseForm.exchangeRate,
          paidBy: expenseForm.paidBy,
          splitAmong,
          splitType: "equal",
          splitAmounts: null,
          receiptImage,
          lastModifiedBy: currentUser || "알 수 없음",
        });
      } else {
        await db.addExpense({
          tourId,
          name: expenseForm.name,
          amount,
          currency: expenseForm.currency,
          exchangeRate: expenseForm.exchangeRate,
          paidBy: expenseForm.paidBy,
          splitAmong,
          splitType: "equal",
          receiptImage,
          createdAt: createdAtISO,
        });
      }
    }
    setExpenseForm({ name: "", amount: "", paidBy: 0, splitAmong: [], currency: "KRW", exchangeRate: 1 });
    setSplitType("equal");
    setCustomAmounts({});
    setReceiptImage(undefined);
    setShowExpenseForm(false);
    setEditingExpenseId(null);
    await refresh();
    toast(editingExpenseId !== null ? "비용이 수정되었습니다" : "항목이 추가되었습니다", "success");
  };

  const handleRemoveExpense = (expenseId: number) => {
    requirePin(async () => {
      const name = tour.expenses.find((e) => e.id === expenseId)?.name || "";
      const ok = await confirm(`"${name}" 비용을 삭제하시겠습니까?`);
      if (ok) {
        await db.removeExpense(tourId, expenseId);
        await refresh();
      }
    });
  };

  const toggleSplitParticipant = (pid: number) => {
    const prev = expenseForm.splitAmong;
    const next = prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid];
    setExpenseForm({ ...expenseForm, splitAmong: next });
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "participants", label: "참여자" },
    { key: "expenses", label: "비용" },
    { key: "settlement", label: "정산" },
  ];

  return (
    <>
      {/* 관리자 모드 배너 */}
      {isAdmin && (
        <div style={{
          background: "rgba(72, 202, 228, 0.15)", color: "var(--primary)",
          padding: "6px 16px", fontSize: 12, fontWeight: 700,
          textAlign: "center", borderBottom: "1px solid var(--border)",
        }}>
          🛠 관리자 모드 — PIN 없이 모든 항목 수정/삭제 가능
        </div>
      )}

      {/* Top bar */}
      <div className="tour-header-bar">
        <button className="back-btn" onClick={() => navigate({ screen: "tours" })}>
          ← 뒤로
        </button>
        <div className="right-actions">
          <button className="tour-header-chip">
            {tour.createdBy || "주최자"}
          </button>
          <button
            className="tour-header-chip"
            onClick={async () => {
              const text = `🤿 Dive ON 다이빙 투어 초대!\n\n투어: ${tour.name}\n날짜: ${tour.date || "미정"}\n장소: ${tour.location || "미정"}\n\n초대 코드: ${tour.inviteCode}\n\n앱에서 초대 코드를 입력하여 참여하세요!`;
              try {
                if (navigator.share) {
                  await navigator.share({ title: `Dive ON - ${tour.name}`, text });
                  return;
                }
              } catch {}
              try {
                await navigator.clipboard.writeText(text);
                toast("초대 메시지가 복사되었습니다", "success");
              } catch {
                // clipboard도 실패 시 fallback
                toast(`초대 코드: ${tour.inviteCode}`, "info");
              }
            }}
          >
            초대
          </button>
        </div>
      </div>

      {/* Tour Info Card (gradient) */}
      <div className="tour-info-card">
        <h2>{tour.name}</h2>
        <div className="meta">
          {tour.date && <span>{formatDate(tour.date)}</span>}
          {tour.location && <span>{tour.location}</span>}
        </div>
        <div className="access-code-box">
          <div className="access-code-label">초대 코드</div>
          <div className="access-code-value">{tour.inviteCode}</div>
        </div>
      </div>


      {/* Tabs */}
      <div className="detail-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`detail-tab ${activeTab === tab.key ? "active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="scroll-content">
        {/* ── Participants + Comments ── */}
        {activeTab === "participants" && (
          <div>
            {/* Collapsible participant list + add */}
            <div
              className="card"
              style={{ padding: 0, marginBottom: 16, overflow: "hidden" }}
            >
              <button
                onClick={() => setShowParticipants(!showParticipants)}
                style={{
                  width: "100%", display: "flex", justifyContent: "space-between",
                  alignItems: "center", padding: "12px 16px",
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--foreground)", fontSize: 14, fontWeight: 600,
                }}
              >
                <span>참여자 {tour.participants.length}명</span>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {showParticipants ? "접기 ▲" : "펼치기 ▼"}
                </span>
              </button>
              {showParticipants && (
                <div style={{ borderTop: "1px solid var(--border)" }}>
                  {tour.participants.map((p) => (
                    <div key={p.id} style={{
                      display: "flex", alignItems: "center", padding: "10px 16px",
                      borderBottom: "1px solid var(--border)",
                    }}>
                      <div className="participant-avatar" style={{ width: 28, height: 28, fontSize: 12, marginRight: 10 }}>
                        {p.name.charAt(0)}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontSize: 14 }}>{p.name}</span>
                        {p.addedBy && p.addedBy !== p.name && (
                          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                            {p.addedBy}님이 추가
                          </div>
                        )}
                        {!waivers.some((w) => w.signerName === p.name) && (
                          <div style={{ fontSize: 10, color: "var(--error)", marginTop: 1 }}>
                            면책동의서 미작성
                          </div>
                        )}
                      </div>
                      <button
                        className="participant-delete"
                        onClick={() => handleRemoveParticipant(p.id)}
                        style={{ fontSize: 14 }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {/* Add participant inside dropdown */}
                  <div style={{
                    display: "flex", gap: 8, padding: "10px 16px",
                    borderTop: "1px solid var(--border)", background: "var(--surface-light)",
                  }}>
                    <input
                      className="input"
                      style={{ flex: 1, padding: "8px 12px", fontSize: 13 }}
                      value={newParticipantName}
                      onChange={(e) => setNewParticipantName(e.target.value)}
                      placeholder="이름 입력 (동명이인: 홍길동2)"
                      onKeyDown={(e) => e.key === "Enter" && handleAddParticipant()}
                    />
                    <button
                      onClick={handleAddParticipant}
                      style={{
                        background: "var(--primary)", color: "var(--on-primary)",
                        border: "none", borderRadius: 8, padding: "8px 14px",
                        fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                      }}
                    >
                      + 추가
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Comments section */}
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)", marginBottom: 12 }}>
                댓글
              </div>
              <CommentTab tourId={tourId} currentUser={currentUser} />
            </div>
          </div>
        )}

        {/* ── Expenses ── */}
        {activeTab === "expenses" && (
          <div>
            <button
              className="btn btn-primary mb-16"
              onClick={openExpenseModal}
            >
              + 비용 추가
            </button>

            {tour.expenses.length > 0 && (
              <div className="summary-card mb-16">
                <div className="summary-row">
                  <span>총 비용</span>
                  <span className="total-amount">{formatCurrency(totalExpensesKRW)}</span>
                </div>
                <div className="summary-row">
                  <span>비용 항목</span>
                  <span className="summary-value">{tour.expenses.length}건</span>
                </div>
                {tour.participants.length > 0 && (
                  <div className="summary-row">
                    <span>1인 평균</span>
                    <span className="summary-value">
                      {formatCurrency(Math.round(totalExpensesKRW / tour.participants.length))}
                    </span>
                  </div>
                )}
              </div>
            )}

            {[...tour.expenses]
              .sort((a, b) => {
                const nameCompare = a.name.localeCompare(b.name, "ko");
                if (nameCompare !== 0) return nameCompare;
                return new Date(a.createdAt || "").getTime() - new Date(b.createdAt || "").getTime();
              })
              .map((e) => {
              const payer = tour.participants.find((p) => p.id === e.paidBy);
              const isSelected = selectedExpenseId === e.id;
              return (
                <div key={e.id}>
                  {/* Compact row */}
                  <div
                    onClick={() => setSelectedExpenseId(isSelected ? null : e.id)}
                    style={{
                      display: "flex", alignItems: "center", padding: "10px 0",
                      borderBottom: "1px solid var(--border)", cursor: "pointer",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>{e.name}</span>
                        {e.splitType === "custom" && (
                          <span style={{ fontSize: 9, color: "var(--warning)", fontWeight: 600 }}>지정</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                        {payer?.name || "?"} · {e.splitAmong.length}명 분담
                        {e.receiptImage && " · 📎"}
                        {(e as any).lastModifiedBy && ` · 수정: ${(e as any).lastModifiedBy}`}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--primary)" }}>
                        {e.currency && e.currency !== "KRW"
                          ? `${(CURRENCIES.find((c) => c.code === e.currency)?.symbol || e.currency + " ")}${new Intl.NumberFormat("en-US").format(e.amount)}`
                          : formatCurrency(e.amount)}
                      </div>
                      {e.currency && e.currency !== "KRW" && (
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>
                          ≈ {formatCurrency(e.amount * (e.exchangeRate || 1))}
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>
                        {e.createdAt ? formatDateTime(e.createdAt) : ""}
                      </div>
                    </div>
                    <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                      {isSelected ? "▲" : "▼"}
                    </span>
                  </div>

                  {/* Expanded detail */}
                  {isSelected && (
                    <div style={{
                      padding: "10px 0 10px 8px", borderBottom: "1px solid var(--border)",
                      background: "var(--surface-light)", marginTop: -1,
                    }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.8 }}>
                        {e.splitType === "custom" && e.splitAmounts ? (
                          e.splitAmong.map((pid) => (
                            <div key={pid}>
                              {getParticipantName(pid)}: {formatCurrency(e.splitAmounts?.[String(pid)] ?? 0)}
                            </div>
                          ))
                        ) : (
                          <>
                            <div>분담: {e.splitAmong.map((pid) => getParticipantName(pid)).join(", ")}</div>
                            <div>1인 {formatCurrency(e.splitAmong.length > 0 ? Math.round((e.amount * (e.exchangeRate || 1)) / e.splitAmong.length) : 0)}</div>
                          </>
                        )}
                        {(e as any).lastModifiedAt && (
                          <div style={{ marginTop: 4 }}>
                            수정: {(e as any).lastModifiedBy || ""} · {formatDateTime((e as any).lastModifiedAt)}
                          </div>
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                        {e.receiptImage && (
                          <button
                            onClick={() => setViewingReceipt(e.receiptImage!)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--success)", fontSize: 13, fontWeight: 600, padding: 0 }}
                          >
                            📎 영수증
                          </button>
                        )}
                        <button
                          onClick={() => requirePin(() => openEditExpenseModal(e.id))}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--primary)", fontSize: 13, fontWeight: 600, padding: 0 }}
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleRemoveExpense(e.id)}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--error)", fontSize: 13, padding: 0 }}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {tour.expenses.length === 0 && (
              <div className="empty-state">
                <div style={{ fontSize: 20, marginBottom: 8, color: "var(--muted)" }}>-</div>
                <div>비용 항목을 추가해주세요</div>
              </div>
            )}
          </div>
        )}

        {/* ── Settlement ── */}
        {activeTab === "settlement" && (
          <div>
            {/* Summary */}
            <div className="summary-card mb-16">
              <div className="summary-row">
                <span>총 비용</span>
                <span className="total-amount">{formatCurrency(totalExpensesKRW)}</span>
              </div>
              <div className="summary-row">
                <span>참여자</span>
                <span className="summary-value">{tour.participants.length}명</span>
              </div>
              <div className="summary-row">
                <span>정산 건수</span>
                <span className="summary-value" style={{ color: "var(--success)" }}>
                  {settlements.length}건
                </span>
              </div>
            </div>

            {/* 다중 화폐 사용 시 안내 */}
            {tour.expenses.some((e) => e.currency && e.currency !== "KRW") && (
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 12, padding: "8px 0" }}>
                * 외화 비용은 각 항목에 설정된 환율로 KRW 환산하여 정산합니다
              </div>
            )}

            {settlements.length === 0 ? (
              <div className="empty-state">
                <div style={{ fontSize: 20, marginBottom: 8, color: "var(--muted)" }}>-</div>
                <div>
                  {tour.expenses.length === 0
                    ? "비용 항목을 먼저 추가해주세요"
                    : "정산할 내역이 없습니다"}
                </div>
              </div>
            ) : (
              <>
                <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>
                  송금 내역
                </h3>
                {settlements.map((s, i) => (
                  <div key={i} className="settlement-card">
                    <div className="settlement-arrow">
                      <span className="settlement-label settlement-from">보냄</span>
                      <span style={{ fontWeight: 600, color: "var(--foreground)", fontSize: 15 }}>{s.fromName}</span>
                      <span style={{ color: "var(--success)", fontSize: 18 }}>→</span>
                      <span style={{ fontWeight: 600, color: "var(--foreground)", fontSize: 15 }}>{s.toName}</span>
                      <span className="settlement-label settlement-to">받음</span>
                    </div>
                    <div style={{ textAlign: "right", marginTop: 4 }}>
                      <span className="settlement-amount">
                        {formatCurrency(s.amount)}
                      </span>
                    </div>
                  </div>
                ))}

                {/* Per-person summary */}
                <h3 style={{ fontSize: 16, fontWeight: 700, marginTop: 24, marginBottom: 12 }}>
                  참여자별 요약
                </h3>
                {tour.participants.map((p) => {
                  const paid = tour.expenses
                    .filter((e) => e.paidBy === p.id)
                    .reduce((sum, e) => sum + e.amount * (e.exchangeRate || 1), 0);
                  const owed = tour.expenses.reduce((sum, e) => {
                    if (!e.splitAmong.includes(p.id)) return sum;
                    const rate = e.exchangeRate || 1;
                    if (e.splitType === "custom" && e.splitAmounts) {
                      return sum + (e.splitAmounts[String(p.id)] ?? 0) * rate;
                    }
                    return sum + Math.round((e.amount * rate) / e.splitAmong.length);
                  }, 0);
                  const balance = paid - owed;
                  return (
                    <div key={p.id} className="settlement-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>
                            {p.name}
                          </div>
                          <div style={{ fontSize: 13, color: "var(--muted)" }}>
                            결제: {formatCurrency(paid)} / 부담: {formatCurrency(owed)}
                          </div>
                        </div>
                        <div
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color:
                              balance > 0
                                ? "var(--success)"
                                : balance < 0
                                ? "var(--error)"
                                : "var(--muted)",
                            textAlign: "right",
                          }}
                        >
                          {balance > 0
                            ? `+${formatCurrency(balance)}`
                            : balance < 0
                            ? `-${formatCurrency(Math.abs(balance))}`
                            : "±₩0"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* Export buttons */}
            <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
              <button
                className="btn btn-success"
                onClick={() => exportSettlementPDF(tour, settlements)}
              >
                정산서 PDF 내보내기
              </button>
              <button
                className="btn"
                style={{ background: "var(--primary)", color: "var(--on-primary)" }}
                onClick={() => exportSettlementExcel(tour, settlements)}
              >
                정산서 엑셀 내보내기
              </button>
            </div>
          </div>
        )}


      </div>

      {/* Expense Form Modal */}
      <Modal
        open={showExpenseForm}
        onClose={() => { setShowExpenseForm(false); setEditingExpenseId(null); }}
      >
          <div className="modal-title">{editingExpenseId !== null ? "비용 수정" : "비용 추가"}</div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              <div className="input-group">
                <div className="input-label">비용 이름 *</div>
                <input
                  className="input"
                  value={expenseForm.name}
                  onChange={(e) => setExpenseForm({ ...expenseForm, name: e.target.value })}
                  placeholder="예: 보트비, 숙박비, 식비"
                />
              </div>

              <div className="input-group">
                <div className="input-label">화폐</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {CURRENCIES.map((c) => (
                    <button
                      key={c.code}
                      type="button"
                      className="chip"
                      style={{
                        padding: "4px 8px", fontSize: 11,
                        ...(expenseForm.currency === c.code ? {
                          background: "var(--primary)", borderColor: "var(--primary)", color: "var(--on-primary)",
                        } : {}),
                      }}
                      onClick={async () => {
                        setExpenseForm((prev) => ({ ...prev, currency: c.code }));
                        if (c.code !== "KRW") {
                          await fetchExchangeRate(c.code);
                        } else {
                          setExpenseForm((prev) => ({ ...prev, currency: "KRW", exchangeRate: 1 }));
                        }
                      }}
                    >
                      {c.symbol} {c.code}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="chip"
                    style={{
                      padding: "4px 8px", fontSize: 11,
                      ...(!CURRENCIES.some((c) => c.code === expenseForm.currency) ? {
                        background: "var(--primary)", borderColor: "var(--primary)", color: "var(--on-primary)",
                      } : {}),
                    }}
                    onClick={() => {
                      setExpenseForm((prev) => ({ ...prev, currency: customCurrencyCode || "ETC", exchangeRate: 1 }));
                    }}
                  >
                    기타
                  </button>
                </div>
                {!CURRENCIES.some((c) => c.code === expenseForm.currency) && (
                  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      className="input"
                      style={{ width: 60, padding: "4px 8px", fontSize: 12, textAlign: "center" }}
                      value={customCurrencyCode}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase().slice(0, 5);
                        setCustomCurrencyCode(v);
                        setExpenseForm((prev) => ({ ...prev, currency: v || "ETC" }));
                      }}
                      placeholder="코드"
                    />
                    <input
                      className="input"
                      style={{ width: 40, padding: "4px 8px", fontSize: 12, textAlign: "center" }}
                      value={customCurrencySymbol}
                      onChange={(e) => setCustomCurrencySymbol(e.target.value.slice(0, 3))}
                      placeholder="기호"
                    />
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>예: EUR, €</span>
                  </div>
                )}
                {expenseForm.currency !== "KRW" && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)" }}>
                    <span>1 {expenseForm.currency} =</span>
                    <span>₩</span>
                    <input
                      className="input"
                      style={{ width: 90, padding: "4px 8px", fontSize: 13, textAlign: "right" }}
                      value={String(expenseForm.exchangeRate)}
                      onChange={(e) => {
                        const v = e.target.value.replace(/[^0-9.]/g, "");
                        setExpenseForm((prev) => ({ ...prev, exchangeRate: parseFloat(v) || 0 }));
                      }}
                      inputMode="decimal"
                    />
                    {rateLoading && <span>조회 중...</span>}
                  </div>
                )}
              </div>

              <div className="input-group">
                <div className="input-label">
                  총 금액 ({(CURRENCIES.find((c) => c.code === expenseForm.currency) || CURRENCIES[0]).symbol}) *
                </div>
                <input
                  className="input"
                  value={expenseForm.amount}
                  onChange={(e) =>
                    setExpenseForm({
                      ...expenseForm,
                      amount: e.target.value.replace(/[^0-9]/g, ""),
                    })
                  }
                  placeholder="예: 300000"
                  inputMode="numeric"
                />
                {expenseForm.currency !== "KRW" && expenseForm.amount && expenseForm.exchangeRate > 0 && (
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    ≈ {formatCurrency(Number(expenseForm.amount.replace(/[^0-9]/g, "")) * expenseForm.exchangeRate)} (KRW)
                  </div>
                )}
              </div>

              <div className="input-group">
                <div className="input-label">결제 일시</div>
                <input
                  type="datetime-local"
                  className="input"
                  value={expenseDateTime}
                  onChange={(e) => setExpenseDateTime(e.target.value)}
                />
              </div>

              <div className="input-label mb-8">결제자 *</div>
              <div className="flex-row flex-wrap gap-8 mb-16">
                {tour.participants.map((p) => (
                  <button
                    key={p.id}
                    className={`chip ${expenseForm.paidBy === p.id ? "selected" : ""}`}
                    onClick={() => setExpenseForm({ ...expenseForm, paidBy: p.id })}
                  >
                    {p.name}
                  </button>
                ))}
              </div>

              {/* Split type toggle */}
              <div className="input-label mb-8">정산 방식</div>
              <div className="flex-row gap-8 mb-16">
                <button
                  className={`chip ${splitType === "equal" ? "selected" : ""}`}
                  style={{ paddingLeft: 16, paddingRight: 16 }}
                  onClick={() => setSplitType("equal")}
                >
                  균등 분배
                </button>
                <button
                  className="chip"
                  style={{
                    paddingLeft: 16,
                    paddingRight: 16,
                    background: splitType === "custom" ? "var(--warning)" : undefined,
                    color: splitType === "custom" ? "#fff" : undefined,
                    borderColor: splitType === "custom" ? "var(--warning)" : undefined,
                  }}
                  onClick={() => setSplitType("custom")}
                >
                  지정 분배
                </button>
              </div>

              <div className="input-label mb-8">
                분담 대상 ({expenseForm.splitAmong.length}명)
              </div>
              <div className="flex-row flex-wrap gap-8 mb-16">
                {tour.participants.map((p) => {
                  const selected = expenseForm.splitAmong.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      className={`chip ${selected ? "selected-green" : ""}`}
                      onClick={() => toggleSplitParticipant(p.id)}
                    >
                      {p.name}
                    </button>
                  );
                })}
                <button
                  className="chip"
                  style={{ fontSize: 12 }}
                  onClick={() =>
                    setExpenseForm({
                      ...expenseForm,
                      splitAmong: tour.participants.map((p) => p.id),
                    })
                  }
                >
                  ✓ 모두선택
                </button>
              </div>

              {/* Custom amount inputs */}
              {splitType === "custom" && expenseForm.splitAmong.length > 0 && (
                <div className="input-group">
                  <div className="input-label">
                    참여자별 금액 입력
                    {expenseForm.currency !== "KRW" && (
                      <span style={{ fontSize: 11, color: "var(--warning)", marginLeft: 6 }}>
                        ({expenseForm.currency} 기준 입력)
                      </span>
                    )}
                  </div>
                  {expenseForm.splitAmong.map((pid) => {
                    const p = tour.participants.find((pp) => pp.id === pid);
                    return (
                      <div
                        key={pid}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            width: 70,
                            flexShrink: 0,
                          }}
                        >
                          {p?.name}
                        </span>
                        <input
                          className="input"
                          style={{ flex: 1 }}
                          placeholder="금액"
                          inputMode="numeric"
                          value={customAmounts[String(pid)] || ""}
                          onChange={(e) =>
                            setCustomAmounts((prev) => ({
                              ...prev,
                              [String(pid)]: e.target.value.replace(/[^0-9]/g, ""),
                            }))
                          }
                        />
                        <span style={{ color: "var(--muted)", fontSize: 13 }}>
                          {expenseForm.currency === "KRW" ? "원" : expenseForm.currency}
                        </span>
                      </div>
                    );
                  })}
                  {(() => {
                    const totalInput = parseInt(expenseForm.amount.replace(/[^0-9]/g, ""), 10) || 0;
                    const remaining = totalInput - customTotal;
                    return (
                      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", color: "var(--muted)" }}>
                          <span>입력 합계</span>
                          <span>{formatCurrency(customTotal)}</span>
                        </div>
                        {totalInput > 0 && (
                          <div style={{ display: "flex", justifyContent: "space-between", color: remaining === 0 ? "var(--success)" : remaining > 0 ? "var(--warning)" : "var(--error)" }}>
                            <span>잔액</span>
                            <span>{remaining >= 0 ? formatCurrency(remaining) : `-${formatCurrency(Math.abs(remaining))}`}</span>
                          </div>
                        )}
                        {!expenseForm.amount && customTotal > 0 && (
                          <button
                            onClick={() => setExpenseForm({ ...expenseForm, amount: String(customTotal) })}
                            style={{
                              marginTop: 6, background: "var(--primary-alpha-15)", color: "var(--primary)",
                              border: "none", borderRadius: 8, padding: "6px 12px", fontSize: 12,
                              fontWeight: 600, cursor: "pointer", width: "100%",
                            }}
                          >
                            총액을 입력 합계({formatCurrency(customTotal)})로 설정
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
              {/* Receipt upload */}
              <div className="input-group">
                <div className="input-label">영수증 첨부</div>
                <label style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "8px 14px", borderRadius: 8, cursor: "pointer",
                  background: "var(--surface-light)", border: "1px solid var(--border)",
                  fontSize: 13, color: "var(--foreground)",
                }}>
                  <span>{receiptImage ? "📎 변경" : "📎 사진 첨부"}</span>
                  <input type="file" accept="image/*" capture="environment"
                    onChange={handleReceiptUpload}
                    style={{ display: "none" }} />
                </label>
                {receiptImage && (
                  <div style={{ marginTop: 8, position: "relative", display: "inline-block" }}>
                    <img src={receiptImage} alt="영수증" style={{
                      maxWidth: "100%", maxHeight: 150, borderRadius: 8,
                      border: "1px solid var(--border)",
                    }} />
                    <button onClick={() => setReceiptImage(undefined)} style={{
                      position: "absolute", top: 4, right: 4,
                      background: "rgba(0,0,0,0.6)", color: "#fff",
                      border: "none", borderRadius: "50%", width: 22, height: 22,
                      fontSize: 12, cursor: "pointer", display: "flex",
                      alignItems: "center", justifyContent: "center",
                    }}>✕</button>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-row gap-12" style={{ marginTop: 12 }}>
              <button className="btn btn-secondary" onClick={() => { setShowExpenseForm(false); setEditingExpenseId(null); }}>
                취소
              </button>
              <button className="btn btn-primary" onClick={handleSaveExpense}>
                {editingExpenseId !== null ? "수정 완료" : "비용 추가"}
              </button>
            </div>
      </Modal>

      {/* Receipt View Modal */}
      <ReceiptViewerModal src={viewingReceipt} onClose={() => setViewingReceipt(null)} />

      {/* PIN Modal */}
      <Modal open={showPinModal} center onClose={() => setShowPinModal(false)}>
            <div className="modal-title" style={{ textAlign: "center" }}>PIN 입력</div>
            <input
              className="pin-input"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              placeholder="----"
              type="password"
              maxLength={4}
              inputMode="numeric"
            />
            <div className="flex-row gap-12">
              <button className="btn btn-secondary" onClick={() => setShowPinModal(false)}>취소</button>
              <button className="btn btn-primary" onClick={verifyPin}>확인</button>
            </div>
      </Modal>
    </>
  );
}

/** 영수증 이미지를 화면 전체에 띄우는 뷰어. 일반 Modal 의 modal-content 박스 스타일을 쓰지 않으므로 별도 컴포넌트. */
function ReceiptViewerModal({ src, onClose }: { src: string | undefined | null; onClose: () => void }) {
  if (!src) return null;
  return (
    <Modal open center onClose={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        position: "relative", maxWidth: "90vw", maxHeight: "85vh",
      }}>
        <img src={src} alt="영수증" style={{
          maxWidth: "90vw", maxHeight: "75vh", borderRadius: 8,
          objectFit: "contain",
        }} />
        <button onClick={onClose} style={{
          position: "absolute", top: -12, right: -12,
          background: "rgba(255,255,255,0.9)", color: "#333",
          border: "none", borderRadius: "50%", width: 32, height: 32,
          fontSize: 18, cursor: "pointer", display: "flex",
          alignItems: "center", justifyContent: "center", fontWeight: 700,
        }}>✕</button>
      </div>
    </Modal>
  );
}
