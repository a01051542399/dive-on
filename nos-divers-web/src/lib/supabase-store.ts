/**
 * Supabase 서버 기반 데이터 레이어
 * 기존 store.ts의 localStorage 함수들을 Supabase DB + Storage로 대체
 */
import { supabase } from "./supabase";
import type {
  Tour, Participant, Expense, Waiver, Comment,
  WaiverPersonalInfo, Announcement,
} from "../types";
import { hashPin, verifyPin, isLegacyPlain } from "./pin-crypto";

// ─── Helpers ───

/** crypto.randomUUID 폴백 (구형 환경 대응) */
function safeUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4 폴백
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** base64 data URL → Supabase Storage upload → signed URL */
async function uploadImage(
  path: string,
  base64Data: string,
): Promise<string> {
  // Extract mime and raw base64
  const match = base64Data.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid base64 data URL");
  const mime = match[1];
  const raw = match[2];
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));

  const { error } = await supabase.storage
    .from("images")
    .upload(path, bytes, { contentType: mime, upsert: true });
  if (error) throw error;

  // Get signed URL (1 year)
  const { data: urlData } = await supabase.storage
    .from("images")
    .createSignedUrl(path, 60 * 60 * 24 * 365);
  if (!urlData?.signedUrl) throw new Error("이미지 URL 생성에 실패했습니다");
  return urlData.signedUrl;
}

/** DB snake_case row → camelCase Participant */
function toParticipant(row: any): Participant {
  return {
    id: row.id,
    tourId: row.tour_id,
    name: row.name,
    addedBy: row.added_by ?? undefined,
    lastModifiedBy: row.last_modified_by ?? undefined,
    createdAt: row.created_at,
  };
}

/** DB snake_case row → camelCase Expense */
function toExpense(row: any): Expense {
  return {
    id: row.id,
    tourId: row.tour_id,
    name: row.name,
    amount: Number(row.amount),
    currency: row.currency || "KRW",
    exchangeRate: Number(row.exchange_rate) || 1,
    paidBy: row.paid_by,
    splitAmong: row.split_among || [],
    splitType: row.split_type || "equal",
    splitAmounts: row.split_amounts || null,
    receiptImage: row.receipt_url ?? undefined,
    lastModifiedBy: row.last_modified_by ?? undefined,
    createdAt: row.created_at,
  };
}

/** DB snake_case row → camelCase Waiver */
function toWaiver(row: any): Waiver {
  return {
    id: row.id,
    tourId: row.tour_id,
    signerName: row.signer_name,
    personalInfo: row.personal_info as WaiverPersonalInfo,
    healthChecklist: row.health_checklist as boolean[],
    healthOther: row.health_other ?? null,
    signatureImage: row.signature_url || "",
    signedAt: row.signed_at,
    agreed: row.agreed ?? true,
  };
}

/** DB snake_case row → camelCase Comment */
function toComment(row: any): Comment {
  return {
    id: row.id,
    tourId: row.tour_id,
    authorName: row.author_name,
    text: row.text,
    createdAt: row.created_at,
    edited: row.edited ?? false,
  };
}

/** Assemble full Tour object from DB (3 parallel queries) */
async function assembleTour(tourRow: any): Promise<Tour> {
  const tourId = tourRow.id;
  const [pRes, eRes] = await Promise.all([
    supabase.from("participants").select("*").eq("tour_id", tourId).order("id"),
    supabase.from("expenses").select("*").eq("tour_id", tourId).order("id"),
  ]);
  if (pRes.error) console.error("participants query error:", pRes.error);
  if (eRes.error) console.error("expenses query error:", eRes.error);

  return {
    id: tourRow.id,
    name: tourRow.name,
    date: tourRow.date || "",
    location: tourRow.location || "",
    inviteCode: tourRow.invite_code,
    accessCode: tourRow.access_code,
    createdBy: tourRow.created_by_name || "",
    participants: (pRes.data || []).map(toParticipant),
    expenses: (eRes.data || []).map(toExpense),
    createdAt: tourRow.created_at,
    updatedAt: tourRow.updated_at,
    deletedAt: tourRow.deleted_at ?? undefined,
  };
}

// ─── Tour Operations ───

/** RPC 결과 row(tour|participants|expenses jsonb) → Tour 도메인 객체 */
function fromRpcRow(row: any): Tour {
  const t = row.tour;
  return {
    id: t.id,
    name: t.name,
    date: t.date || "",
    location: t.location || "",
    inviteCode: t.invite_code,
    accessCode: t.access_code,
    createdBy: t.created_by_name || "",
    participants: (row.participants || []).map(toParticipant),
    expenses: (row.expenses || []).map(toExpense),
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    deletedAt: t.deleted_at ?? undefined,
  };
}

export async function listTours(): Promise<Tour[]> {
  // 단일 RPC 호출 — N+1 제거 (이전: tours + per-tour participants/expenses)
  const { data, error } = await supabase.rpc("get_tours_with_details", {
    p_include_deleted: false,
  });
  if (error) {
    // RPC 미배포 환경 폴백
    console.warn("get_tours_with_details RPC 실패, 폴백 사용:", error.message);
    const { data: rows, error: e2 } = await supabase
      .from("tours")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (e2) throw e2;
    if (!rows || rows.length === 0) return [];
    return Promise.all(rows.map(assembleTour));
  }
  if (!data || !Array.isArray(data)) return [];
  return data.map(fromRpcRow);
}

export async function getTourById(id: number): Promise<Tour | undefined> {
  const { data, error } = await supabase
    .from("tours")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return undefined;
  return assembleTour(data);
}

export async function createTour(input: {
  name: string;
  date: string;
  location: string;
  accessCode: string;
  createdBy: string;
}): Promise<Tour> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error("로그인이 필요합니다");

  // Use RPC to create tour + member + participant atomically (bypasses RLS)
  const { data, error } = await supabase.rpc("create_tour_rpc", {
    p_name: input.name,
    p_date: input.date,
    p_location: input.location,
    p_access_code: input.accessCode || "0000",
    p_created_by_name: input.createdBy,
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);

  const tourId = data.tourId;
  const tour = await getTourById(tourId);
  if (!tour) throw new Error("투어 생성 후 조회에 실패했습니다");
  return tour;
}

export async function editTour(
  tourId: number,
  updates: { name?: string; date?: string; location?: string },
): Promise<void> {
  const payload: any = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.date !== undefined) payload.date = updates.date;
  if (updates.location !== undefined) payload.location = updates.location;

  const { error } = await supabase
    .from("tours")
    .update(payload)
    .eq("id", tourId);
  if (error) throw error;
}

export async function softDeleteTour(tourId: number): Promise<void> {
  const { error } = await supabase
    .from("tours")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tourId);
  if (error) throw error;
}

export async function restoreTour(tourId: number): Promise<void> {
  const { error } = await supabase
    .from("tours")
    .update({ deleted_at: null })
    .eq("id", tourId);
  if (error) throw error;
}

export async function deleteTour(tourId: number): Promise<void> {
  // Storage 파일 정리 (best-effort: 실패해도 DB 삭제는 진행)
  const storageFolders = [
    `receipts/${tourId}`,
    `signatures/${tourId}`,
  ];

  for (const folder of storageFolders) {
    try {
      const { data: files, error: listError } = await supabase.storage
        .from("images")
        .list(folder);

      if (!listError && files && files.length > 0) {
        const paths = files.map((f) => `${folder}/${f.name}`);
        const { error: removeError } = await supabase.storage
          .from("images")
          .remove(paths);
        if (removeError) {
          console.warn(`Storage 삭제 실패 (${folder}):`, removeError.message);
        }
      }
    } catch (e) {
      console.warn(`Storage 정리 중 오류 (${folder}):`, e);
    }
  }

  // Cascade delete handles participants, expenses, waivers, comments
  const { error } = await supabase
    .from("tours")
    .delete()
    .eq("id", tourId);
  if (error) throw error;
}

export async function getTrashTours(): Promise<Tour[]> {
  const { data, error } = await supabase
    .from("tours")
    .select("*")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw error;
  if (!data) return [];
  return Promise.all(data.map(assembleTour));
}

export async function cleanupTrash(): Promise<void> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("tours")
    .delete()
    .not("deleted_at", "is", null)
    .lt("deleted_at", sevenDaysAgo);
  if (error) throw error;
}

export async function verifyTourAccessCode(
  tourId: number,
  code: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("tours")
    .select("access_code")
    .eq("id", tourId)
    .single();
  return data?.access_code === code;
}

// ─── Join Tour (RPC) ───

export async function lookupTourByInvite(
  code: string,
): Promise<{ id: number; name: string; date: string; location: string; createdByName: string } | null> {
  const { data, error } = await supabase.rpc("lookup_tour_by_invite", {
    p_code: code.toUpperCase(),
  });
  if (error || !data || data.length === 0) return null;
  const row = data[0];
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    location: row.location,
    createdByName: row.created_by_name,
  };
}

export async function joinTour(
  inviteCode: string,
  userName: string,
): Promise<{ tourId: number; participantId: number; tourName: string } | { error: string }> {
  const { data, error } = await supabase.rpc("join_tour", {
    p_invite_code: inviteCode.toUpperCase(),
    p_user_name: userName,
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return {
    tourId: data.tourId,
    participantId: data.participantId,
    tourName: data.tourName,
  };
}

// ─── Participant Operations ───

export async function addParticipant(
  tourId: number,
  name: string,
  addedBy?: string,
): Promise<Participant> {
  const { data, error } = await supabase
    .from("participants")
    .insert({
      tour_id: tourId,
      name,
      added_by: addedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return toParticipant(data);
}

export async function removeParticipant(
  tourId: number,
  participantId: number,
): Promise<void> {
  // Update expenses: remove from split_among arrays
  const { data: expenses } = await supabase
    .from("expenses")
    .select("id, split_among, split_type, split_amounts")
    .eq("tour_id", tourId);

  if (expenses) {
    for (const exp of expenses) {
      const newSplitAmong = (exp.split_among || []).filter(
        (id: number) => id !== participantId,
      );
      const updates: any = { split_among: newSplitAmong };

      if (exp.split_type === "custom" && exp.split_amounts) {
        const amounts = { ...exp.split_amounts };
        delete amounts[String(participantId)];
        updates.split_amounts = amounts;
      }

      if (newSplitAmong.length === 0) {
        // Remove expense if no one left
        await supabase.from("expenses").delete().eq("id", exp.id);
      } else {
        await supabase.from("expenses").update(updates).eq("id", exp.id);
      }
    }
  }

  // Delete participant
  const { error } = await supabase
    .from("participants")
    .delete()
    .eq("id", participantId);
  if (error) throw error;
}

// ─── Expense Operations ───

export async function addExpense(input: {
  tourId: number;
  name: string;
  amount: number;
  currency?: string;
  exchangeRate?: number;
  paidBy: number;
  splitAmong: number[];
  splitType?: "equal" | "custom";
  splitAmounts?: Record<string, number> | null;
  receiptImage?: string;
  createdAt?: string;
}): Promise<Expense> {
  let receiptUrl: string | undefined;
  if (input.receiptImage && input.receiptImage.startsWith("data:")) {
    // 충돌 방지: UUID 기반 파일명 (동일 tourId 동시 업로드 시에도 안전)
    receiptUrl = await uploadImage(
      `receipts/${input.tourId}/${safeUUID()}.jpg`,
      input.receiptImage,
    );
  }

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      tour_id: input.tourId,
      name: input.name,
      amount: input.amount,
      currency: input.currency || "KRW",
      exchange_rate: input.exchangeRate || 1,
      paid_by: input.paidBy,
      split_among: input.splitAmong,
      split_type: input.splitType || "equal",
      split_amounts: input.splitAmounts || null,
      receipt_url: receiptUrl || null,
      created_at: input.createdAt || new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return toExpense(data);
}

export async function editExpense(
  tourId: number,
  expenseId: number,
  updates: {
    name?: string;
    amount?: number;
    currency?: string;
    exchangeRate?: number;
    paidBy?: number;
    splitAmong?: number[];
    splitType?: "equal" | "custom";
    splitAmounts?: Record<string, number> | null;
    receiptImage?: string;
    lastModifiedBy?: string;
  },
): Promise<void> {
  const payload: any = {};
  if (updates.name !== undefined) payload.name = updates.name;
  if (updates.amount !== undefined) payload.amount = updates.amount;
  if (updates.currency !== undefined) payload.currency = updates.currency;
  if (updates.exchangeRate !== undefined) payload.exchange_rate = updates.exchangeRate;
  if (updates.paidBy !== undefined) payload.paid_by = updates.paidBy;
  if (updates.splitAmong !== undefined) payload.split_among = updates.splitAmong;
  if (updates.splitType !== undefined) payload.split_type = updates.splitType;
  if (updates.splitAmounts !== undefined) payload.split_amounts = updates.splitAmounts;
  if (updates.lastModifiedBy) payload.last_modified_by = updates.lastModifiedBy;

  // Handle receipt image upload
  if (updates.receiptImage !== undefined) {
    if (updates.receiptImage && updates.receiptImage.startsWith("data:")) {
      // expenseId 기반 고정 경로는 동일 expense 의 영수증 교체에 안전(upsert).
      // 단 충돌 방지를 위해 UUID 기반으로 신규 업로드 후 기존 파일은 자연 만료.
      payload.receipt_url = await uploadImage(
        `receipts/${tourId}/${expenseId}-${safeUUID()}.jpg`,
        updates.receiptImage,
      );
    } else {
      payload.receipt_url = updates.receiptImage || null;
    }
  }

  const { error } = await supabase
    .from("expenses")
    .update(payload)
    .eq("id", expenseId);
  if (error) throw error;
}

export async function removeExpense(
  _tourId: number,
  expenseId: number,
): Promise<void> {
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId);
  if (error) throw error;
}

// ─── Waiver Operations ───

export async function createWaiver(input: {
  tourId: number;
  signerName: string;
  personalInfo: Waiver["personalInfo"];
  healthChecklist: boolean[] | string;
  healthOther?: string;
  signatureImage: string;
  agreed?: boolean;
}): Promise<Waiver> {
  let signatureUrl = "";
  if (input.signatureImage && input.signatureImage.startsWith("data:")) {
    signatureUrl = await uploadImage(
      `signatures/${input.tourId}/${safeUUID()}.png`,
      input.signatureImage,
    );
  }

  const { data, error } = await supabase
    .from("waivers")
    .insert({
      tour_id: input.tourId,
      signer_name: input.signerName,
      personal_info: input.personalInfo,
      health_checklist: input.healthChecklist,
      health_other: input.healthOther || null,
      signature_url: signatureUrl,
      agreed: input.agreed ?? true,
    })
    .select()
    .single();
  if (error) throw error;
  return toWaiver(data);
}

export async function listWaiversByTour(tourId: number): Promise<Waiver[]> {
  const { data, error } = await supabase
    .from("waivers")
    .select("*")
    .eq("tour_id", tourId)
    .order("signed_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(toWaiver);
}

export async function listAllWaivers(): Promise<Waiver[]> {
  // Get all waivers for tours the user is a member of
  const { data, error } = await supabase
    .from("waivers")
    .select("*")
    .order("signed_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(toWaiver);
}

export async function deleteWaiver(waiverId: number): Promise<void> {
  const { error } = await supabase
    .from("waivers")
    .delete()
    .eq("id", waiverId);
  if (error) throw error;
}

// ─── Comment Operations ───

export async function listComments(tourId: number): Promise<Comment[]> {
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("tour_id", tourId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(toComment);
}

export async function addComment(input: {
  tourId: number;
  authorName: string;
  text: string;
}): Promise<Comment> {
  const { data, error } = await supabase
    .from("comments")
    .insert({
      tour_id: input.tourId,
      author_name: input.authorName,
      text: input.text,
    })
    .select()
    .single();
  if (error) throw error;
  return toComment(data);
}

export async function editComment(
  commentId: number,
  newText: string,
): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .update({ text: newText, edited: true })
    .eq("id", commentId);
  if (error) throw error;
}

export async function deleteComment(commentId: number): Promise<void> {
  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId);
  if (error) throw error;
}

// ─── Profile Operations ───

export interface UserProfile {
  name: string;
  email: string;
  grade: string;
  phone?: string;
  birthDate?: string;
  divingLevel?: string;
  emergencyContact?: string;
  setupCompleted?: boolean;
}

export async function getProfile(): Promise<UserProfile> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return { name: "", email: "", grade: "멤버", setupCompleted: false };

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!data) return { name: "", email: user.email || "", grade: "멤버", setupCompleted: false };

  return {
    name: data.name || "",
    email: data.email || "",
    grade: data.grade || "멤버",
    phone: data.phone ?? undefined,
    birthDate: data.birth_date ?? undefined,
    divingLevel: data.diving_level ?? undefined,
    emergencyContact: data.emergency_contact ?? undefined,
    setupCompleted: data.setup_completed === true,
  };
}

export async function setProfile(profile: UserProfile): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;

  const { error } = await supabase
    .from("profiles")
    .upsert({
      id: user.id,
      name: profile.name,
      email: profile.email,
      grade: profile.grade || "멤버",
      phone: profile.phone || null,
      birth_date: profile.birthDate || null,
      diving_level: profile.divingLevel || null,
      emergency_contact: profile.emergencyContact || null,
      // setup_completed 가 명시적으로 설정된 경우에만 변경 (기본은 false 라 무심코 덮어쓰지 않음)
      ...(profile.setupCompleted !== undefined ? { setup_completed: profile.setupCompleted } : {}),
    });
  if (error) throw error;
}

// ─── App Settings (per-user) ───

export async function getAppSettings(): Promise<{
  accountPassword: string | null;
  hiddenTourIds: number[];
}> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return { accountPassword: null, hiddenTourIds: [] };

  const { data } = await supabase
    .from("app_settings")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!data) return { accountPassword: null, hiddenTourIds: [] };

  return {
    accountPassword: data.account_password,
    hiddenTourIds: data.hidden_tour_ids || [],
  };
}

export async function setAccountPassword(password: string): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  const current = await getAppSettings();
  // 평문이 DB 에 저장되지 않도록 항상 해시 (PBKDF2 + per-PIN salt)
  const hashed = await hashPin(password);
  await supabase.from("app_settings").upsert({
    user_id: user.id,
    account_password: hashed,
    hidden_tour_ids: current.hiddenTourIds,
  });
}

/**
 * 계정 PIN 검증. 레거시 평문이 일치하면 자동으로 해시본으로 재저장하여
 * 한 번 검증된 사용자는 즉시 안전한 형식으로 마이그레이션된다.
 */
export async function verifyAccountPassword(input: string): Promise<boolean> {
  const settings = await getAppSettings();
  const stored = settings.accountPassword;
  if (!stored) return false;
  const ok = await verifyPin(input, stored);
  if (ok && isLegacyPlain(stored)) {
    try {
      await setAccountPassword(input);
    } catch {
      // 재저장 실패는 검증 결과에 영향 없음
    }
  }
  return ok;
}

export async function setHiddenTourIds(ids: number[]): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  // account_password 는 건드리지 않고 hidden_tour_ids 만 부분 업데이트
  // (전체 upsert 시 기존 해시를 덮어쓸 위험을 피함)
  const { data: existing } = await supabase
    .from("app_settings")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("app_settings")
      .update({ hidden_tour_ids: ids })
      .eq("user_id", user.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("app_settings").insert({
      user_id: user.id,
      account_password: null,
      hidden_tour_ids: ids,
    });
    if (error) throw error;
  }
}

export async function verifyAdminPassword(pw: string): Promise<boolean> {
  const { data } = await supabase.rpc("verify_admin_password", {
    p_password: pw,
  });
  return data === true;
}

/** 관리자 권한 획득 (비밀번호 확인 후 admin_users 등록).
 *  성공 시 RLS 가 모든 투어/참여자/비용/동의서/댓글/프로필을 노출하기 시작.
 */
export async function claimAdminAccess(pw: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("claim_admin_access", {
    p_admin_password: pw,
  });
  if (error) {
    console.warn("claim_admin_access 실패:", error.message);
    return false;
  }
  return data === true;
}

/** 관리자 모드 종료 — admin_users 에서 제거. */
export async function releaseAdminAccess(): Promise<void> {
  await supabase.rpc("release_admin_access");
}

/** 현재 세션의 관리자 여부 확인 (서버 단일 진실 원천). */
export async function amIAdmin(): Promise<boolean> {
  const { data } = await supabase.rpc("am_i_admin");
  return data === true;
}

// ─── Data Stats (Admin) ───

export async function getDataStats(): Promise<{
  tourCount: number;
  participantCount: number;
  expenseCount: number;
  waiverCount: number;
  commentCount: number;
  totalExpenseKRW: number;
}> {
  const [tours, participants, expenses, waivers, comments] = await Promise.all([
    supabase.from("tours").select("id", { count: "exact", head: true }),
    supabase.from("participants").select("id", { count: "exact", head: true }),
    supabase.from("expenses").select("id, amount, exchange_rate"),
    supabase.from("waivers").select("id", { count: "exact", head: true }),
    supabase.from("comments").select("id", { count: "exact", head: true }),
  ]);

  const totalExpenseKRW = (expenses.data || []).reduce(
    (sum: number, e: any) => sum + Number(e.amount) * (Number(e.exchange_rate) || 1),
    0,
  );

  return {
    tourCount: tours.count || 0,
    participantCount: participants.count || 0,
    expenseCount: expenses.count || 0,
    waiverCount: waivers.count || 0,
    commentCount: comments.count || 0,
    totalExpenseKRW,
  };
}

// ─── Announcements (인앱 공지) ───

function toAnnouncement(row: any, readIds: Set<number>): Announcement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    targetTourId: row.target_tour_id ?? null,
    pinned: !!row.pinned,
    authorName: row.author_name || "운영진",
    createdAt: row.created_at,
    read: readIds.has(row.id),
  };
}

/** 본인이 볼 수 있는 모든 공지 (RLS 가 필터). pinned 우선 + 최신순. */
export async function listAnnouncements(): Promise<Announcement[]> {
  const user = (await supabase.auth.getUser()).data.user;
  const [aRes, rRes] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .order("pinned", { ascending: false })
      .order("created_at", { ascending: false }),
    user
      ? supabase
          .from("announcement_reads")
          .select("announcement_id")
          .eq("user_id", user.id)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (aRes.error) throw aRes.error;
  const readIds = new Set<number>(
    (rRes.data || []).map((r: any) => r.announcement_id),
  );
  return (aRes.data || []).map((row: any) => toAnnouncement(row, readIds));
}

/** 미읽음 공지 개수 (헤더 배지용) */
export async function getUnreadAnnouncementCount(): Promise<number> {
  const { data, error } = await supabase.rpc("get_unread_announcement_count");
  if (error) {
    // RPC 미배포 환경에서는 0 으로 폴백
    console.warn("get_unread_announcement_count 폴백:", error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** 단일 공지 읽음 표시 (UNIQUE 제약으로 중복 무시) */
export async function markAnnouncementRead(announcementId: number): Promise<void> {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) return;
  await supabase
    .from("announcement_reads")
    .upsert(
      { announcement_id: announcementId, user_id: user.id },
      { onConflict: "announcement_id,user_id", ignoreDuplicates: true },
    );
}

/** 모두 읽음 처리 — RPC 한 번 (벌크) */
export async function markAllAnnouncementsRead(): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_announcements_read");
  if (error) {
    console.warn("mark_all_announcements_read 폴백:", error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** 관리자 비밀번호 검증 후 공지 작성 */
export async function createAnnouncement(input: {
  adminPassword: string;
  title: string;
  body: string;
  targetTourId?: number | null;
  pinned?: boolean;
  authorName?: string;
}): Promise<{ id: number } | { error: string }> {
  const { data, error } = await supabase.rpc("create_announcement", {
    p_admin_password: input.adminPassword,
    p_title: input.title,
    p_body: input.body,
    p_target_tour_id: input.targetTourId ?? null,
    p_pinned: !!input.pinned,
    p_author_name: input.authorName ?? "운영진",
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return { id: data.id };
}

export async function updateAnnouncement(input: {
  adminPassword: string;
  id: number;
  title?: string;
  body?: string;
  pinned?: boolean;
}): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await supabase.rpc("update_announcement", {
    p_admin_password: input.adminPassword,
    p_id: input.id,
    p_title: input.title ?? "",
    p_body: input.body ?? "",
    p_pinned: input.pinned ?? null,
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return { ok: true };
}

export async function deleteAnnouncement(input: {
  adminPassword: string;
  id: number;
}): Promise<{ ok: true } | { error: string }> {
  const { data, error } = await supabase.rpc("delete_announcement", {
    p_admin_password: input.adminPassword,
    p_id: input.id,
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return { ok: true };
}
