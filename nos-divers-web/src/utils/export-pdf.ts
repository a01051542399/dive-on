import type { Tour, Settlement } from "../types";
import { isNative } from "../lib/platform";
import { saveFile } from "./file-save";

export async function exportSettlementPDF(tour: Tour, settlements: Settlement[]) {
  const totalExpense = tour.expenses.reduce((s, e) => s + e.amount * (e.exchangeRate || 1), 0);
  const fmt = (n: number) => new Intl.NumberFormat("ko-KR").format(Math.round(n));
  const pCount = tour.participants.length;

  // Calculate per-person summary
  const personData = tour.participants.map((p) => {
    const totalOwed = tour.expenses.reduce((s, e) => {
      if (!e.splitAmong.includes(p.id)) return s;
      const rate = e.exchangeRate || 1;
      if (e.splitType === "custom" && e.splitAmounts) {
        return s + (e.splitAmounts[String(p.id)] ?? 0) * rate;
      }
      return s + (e.amount * rate) / e.splitAmong.length;
    }, 0);
    const totalPaid = tour.expenses
      .filter((e) => e.paidBy === p.id)
      .reduce((s, e) => s + e.amount * (e.exchangeRate || 1), 0);
    return {
      id: p.id, name: p.name,
      owed: Math.round(totalOwed),
      paid: Math.round(totalPaid),
      balance: Math.round(totalPaid - totalOwed),
    };
  });

  // Adaptive font size based on participant count
  const fontSize = pCount > 30 ? 6 : pCount > 20 ? 7 : pCount > 14 ? 8 : 9;
  const cellPad = pCount > 20 ? 2 : pCount > 14 ? 3 : 4;
  const nameColW = pCount > 30 ? 28 : pCount > 20 ? 32 : pCount > 14 ? 38 : 46;
  const isLandscape = pCount > 10;

  // Build O/X matrix rows
  const matrixRows = tour.expenses.map((e, idx) => {
    const rate = e.exchangeRate || 1;
    const amountKRW = e.amount * rate;
    const splitCount = e.splitAmong.length;
    const perPerson = splitCount > 0 ? amountKRW / splitCount : 0;
    const currencyNote = e.currency && e.currency !== "KRW" ? ` (${e.currency})` : "";

    const cells = tour.participants.map((p) => {
      const isParticipant = e.splitAmong.includes(p.id);
      const isPayer = e.paidBy === p.id;
      // 분담금 계산 (custom 이면 splitAmounts, 아니면 균등)
      let share = 0;
      if (isParticipant) {
        if (e.splitType === "custom" && e.splitAmounts) {
          share = (e.splitAmounts[String(p.id)] || 0) * rate;
        } else {
          share = perPerson;
        }
      }
      let mark: string;
      let cls: string;
      if (isPayer && isParticipant) {
        mark = fmt(Math.round(share));
        cls = "o-paid";
      } else if (isPayer && !isParticipant) {
        mark = "결제만";
        cls = "x-paid";
      } else if (isParticipant) {
        mark = fmt(Math.round(share));
        cls = "o-mark";
      } else {
        mark = "—";
        cls = "x-mark";
      }
      return `<td class="${cls}">${mark}</td>`;
    });

    return `<tr>
      <td class="num">${idx + 1}</td>
      <td class="desc">${e.name}${currencyNote}</td>
      <td class="amt">${fmt(Math.round(amountKRW))}</td>
      <td class="num">${splitCount}</td>
      <td class="amt">${fmt(Math.round(perPerson))}</td>
      ${cells.join("")}
    </tr>`;
  });

  // Summary header rows (인당 정산액, 결제액, 최종 금액)
  const summaryTopRows = [
    { label: "인당 정산액", data: personData.map((d) => ({ val: fmt(d.owed), cls: "summary-val" })) },
    { label: "결제액", data: personData.map((d) => ({ val: d.paid > 0 ? fmt(d.paid) : "0", cls: d.paid > 0 ? "summary-paid" : "" })) },
    { label: "최종 금액", data: personData.map((d) => ({
      val: (d.balance > 0 ? "+" : "") + fmt(d.balance),
      cls: d.balance < 0 ? "balance-neg" : d.balance > 0 ? "balance-pos" : "",
    })) },
  ];

  const summaryRowsHtml = summaryTopRows.map((r) =>
    `<tr class="summary-row">
      <td colspan="5" class="summary-label">${r.label}</td>
      ${r.data.map((d) => `<td class="${d.cls}">${d.val}</td>`).join("")}
    </tr>`
  ).join("");

  const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>Dive ON 정산서 - ${tour.name}</title>
<style>
  @page { size: ${isLandscape ? "landscape" : "portrait"}; margin: 10mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
    padding: 12px;
    font-size: ${fontSize}px;
    color: #222;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 16px; text-align: center; margin-bottom: 2px; }
  .subtitle { text-align: center; color: #666; font-size: 11px; margin-bottom: 4px; }
  .meta { text-align: center; color: #555; font-size: 10px; margin-bottom: 10px; }

  /* Summary cards */
  .summary-cards {
    display: flex; justify-content: center; gap: 16px;
    background: #f0f8ff; border-radius: 8px; padding: 10px; margin-bottom: 12px;
  }
  .summary-cards .card { text-align: center; }
  .summary-cards .label { font-size: 9px; color: #666; }
  .summary-cards .value { font-size: 14px; font-weight: 700; color: #0077B6; }

  /* Matrix table */
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; table-layout: fixed; }
  th, td { border: 1px solid #ccc; padding: ${cellPad}px; text-align: center; font-size: ${fontSize}px; overflow: hidden; white-space: nowrap; }
  th { background: #0077B6; color: white; font-weight: 600; }
  th.name-col { min-width: ${nameColW}px; }

  /* 분담 금액 셀 (1인 분담금) */
  .o-mark { background: #E8F5E9; color: #2E7D32; font-weight: 600; text-align: right; }
  .x-mark { background: #FFEBEE; color: #C62828; text-align: center; }
  .o-paid { background: #1565C0; color: #fff; font-weight: 700; text-align: right; }
  .x-paid { background: #FF8A65; color: #fff; font-weight: 700; text-align: center; font-size: ${Math.max(7, fontSize - 1)}px; }

  .num { text-align: center; }
  .desc { text-align: left; white-space: normal; word-break: break-all; }
  .amt { text-align: right; }

  /* Summary header rows */
  .summary-row { background: #FFF8E1; }
  .summary-row td { font-weight: 600; }
  .summary-label { text-align: right; font-weight: 700; background: #FFF3CD; }
  .summary-val { font-weight: 600; color: #333; }
  .summary-paid { font-weight: 700; color: #1565C0; }
  .balance-neg { color: #D32F2F; font-weight: 700; background: #FFEBEE; }
  .balance-pos { color: #2E7D32; font-weight: 700; background: #E8F5E9; }

  /* Totals */
  .total-row { background: #E3F2FD; font-weight: 700; }

  /* Settlement section */
  h2 { font-size: 12px; margin: 10px 0 6px; border-bottom: 2px solid #0077B6; padding-bottom: 3px; color: #0077B6; }
  .settlement-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid #eee; font-size: 10px; }
  .arrow { color: #0077B6; font-weight: 700; }
  .footer { text-align: center; color: #999; font-size: 8px; margin-top: 12px; }

  @media print { body { padding: 6px; } }
</style>
</head><body>

<h1>Dive ON 정산서</h1>
<div class="subtitle">${tour.name}</div>
<div class="meta">
  📅 ${tour.date || "미정"} &nbsp; 📍 ${tour.location || "미정"} &nbsp; 👤 ${tour.participants.length}명
</div>

<div class="summary-cards">
  <div class="card"><div class="label">총 비용</div><div class="value">₩${fmt(totalExpense)}</div></div>
  <div class="card"><div class="label">항목 수</div><div class="value">${tour.expenses.length}건</div></div>
  <div class="card"><div class="label">송금 건수</div><div class="value">${settlements.length}건</div></div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:24px">No</th>
      <th style="min-width:60px">구분</th>
      <th style="width:54px">금액</th>
      <th style="width:28px">인원</th>
      <th style="width:54px">인당</th>
      ${tour.participants.map((p) => `<th class="name-col">${p.name}</th>`).join("")}
    </tr>
  </thead>
  <tbody>
    ${summaryRowsHtml}
    <tr><td colspan="${5 + pCount}" style="padding:2px;border:none"></td></tr>
    ${matrixRows.join("")}
    <tr class="total-row">
      <td></td>
      <td>총 합계</td>
      <td class="amt">${fmt(Math.round(totalExpense))}</td>
      <td></td>
      <td></td>
      ${tour.participants.map(() => `<td></td>`).join("")}
    </tr>
  </tbody>
</table>

<h2>송금 내역</h2>
${settlements.length === 0 ? "<p>정산할 내역이 없습니다</p>" :
  settlements.map((s) => `<div class="settlement-row">
    <strong>${s.fromName}</strong>
    <span class="arrow">→</span>
    <strong>${s.toName}</strong>
    <span style="margin-left:auto;font-weight:700;color:#0077B6">₩${fmt(s.amount)}</span>
  </div>`).join("")}

<h2>참여자별 정산 요약</h2>
<table>
  <thead><tr>
    <th style="width:24px">No</th><th>이름</th><th>인당 정산액</th><th>결제액</th><th>최종 금액</th><th>상태</th>
  </tr></thead>
  <tbody>
    ${personData.map((p, i) => `<tr>
      <td>${i + 1}</td>
      <td>${p.name}</td>
      <td class="amt">₩${fmt(p.owed)}</td>
      <td class="amt">${p.paid > 0 ? "₩" + fmt(p.paid) : "-"}</td>
      <td class="amt ${p.balance < 0 ? "balance-neg" : p.balance > 0 ? "balance-pos" : ""}">
        ${p.balance > 0 ? "+" : ""}₩${fmt(p.balance)}
      </td>
      <td style="font-weight:600;${p.balance < 0 ? "color:#D32F2F" : p.balance > 0 ? "color:#2E7D32" : ""}">
        ${p.balance < 0 ? "받을 돈" : p.balance > 0 ? "보낼 돈" : "정산 완료"}
      </td>
    </tr>`).join("")}
  </tbody>
</table>

<div class="footer">
  Dive ON - KEEP CALM AND DIVE ON<br>
  생성일시: ${new Date().toLocaleString("ko-KR")}
</div>
</body></html>`;

  if (isNative()) {
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const fileName = `NoS_정산서_${tour.name}_${new Date().toISOString().slice(0, 10)}.html`;
    await saveFile(fileName, blob, "text/html");
  } else {
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
      setTimeout(() => printWindow.print(), 500);
    } else {
      alert("팝업이 차단되었습니다. 브라우저 설정에서 팝업을 허용해주세요.");
    }
  }
}
