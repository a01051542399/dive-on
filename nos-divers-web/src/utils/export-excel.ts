import XLSX from "xlsx-js-style";
import type { Tour, Settlement } from "../types";
import { isNative } from "../lib/platform";
import { saveFile } from "./file-save";

// Color definitions
const BLUE_BG = { fgColor: { rgb: "1565C0" } };   // O결제 (participant + payer)
const ORANGE_BG = { fgColor: { rgb: "FF8A65" } };  // X결제 (payer only)
const GREEN_BG = { fgColor: { rgb: "E8F5E9" } };   // O (participant)
const RED_BG = { fgColor: { rgb: "FFEBEE" } };      // X (not participant)
const HEADER_BG = { fgColor: { rgb: "0077B6" } };   // Column header
const SUMMARY_BG = { fgColor: { rgb: "FFF3CD" } };  // Summary label
const SUMMARY_ROW_BG = { fgColor: { rgb: "FFF8E1" } }; // Summary value row
const BAL_POS_BG = { fgColor: { rgb: "E8F5E9" } };  // Balance positive
const BAL_NEG_BG = { fgColor: { rgb: "FFEBEE" } };   // Balance negative
const TOTAL_BG = { fgColor: { rgb: "E3F2FD" } };     // Totals row

const WHITE_FONT = { color: { rgb: "FFFFFF" }, bold: true };
const BLUE_FONT = { color: { rgb: "1565C0" }, bold: true };
const RED_FONT = { color: { rgb: "D32F2F" }, bold: true };
const GREEN_FONT = { color: { rgb: "2E7D32" }, bold: true };
const GREEN_DARK = { color: { rgb: "2E7D32" }, bold: true };
const RED_DARK = { color: { rgb: "C62828" } };
const CENTER: XLSX.CellStyle["alignment"] = { horizontal: "center", vertical: "center" };
const RIGHT: XLSX.CellStyle["alignment"] = { horizontal: "right", vertical: "center" };
const THIN_BORDER = {
  top: { style: "thin", color: { rgb: "CCCCCC" } },
  bottom: { style: "thin", color: { rgb: "CCCCCC" } },
  left: { style: "thin", color: { rgb: "CCCCCC" } },
  right: { style: "thin", color: { rgb: "CCCCCC" } },
};

export async function exportSettlementExcel(tour: Tour, settlements: Settlement[]) {
  const fmt = (n: number) => Math.round(n);
  const wb = XLSX.utils.book_new();

  const pNames = tour.participants.map((p) => p.name);
  const pCount = pNames.length;
  const dataCols = 7 + pCount; // 7 fixed columns + participant columns

  // Pre-calculate per-person data
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
    return { id: p.id, name: p.name, owed: fmt(totalOwed), paid: fmt(totalPaid), balance: fmt(totalPaid - totalOwed) };
  });

  // --- Build raw data arrays ---
  const rows: (string | number | null)[][] = [];

  // Row 0: participant names header
  const r0: (string | number | null)[] = Array(7).fill(null);
  pNames.forEach((n) => r0.push(n));
  rows.push(r0);

  // Row 1: 인당 정산액
  const r1: (string | number | null)[] = [null, null, null, null, null, null, "인당 정산액"];
  personData.forEach((d) => r1.push(d.owed));
  rows.push(r1);

  // Row 2: 결제액
  const r2: (string | number | null)[] = [null, null, null, null, null, null, "결제액"];
  personData.forEach((d) => r2.push(d.paid));
  rows.push(r2);

  // Row 3: 최종 금액
  const r3: (string | number | null)[] = [null, null, null, null, null, null, "최종 금액"];
  personData.forEach((d) => r3.push(d.balance));
  rows.push(r3);

  // Row 4: blank
  rows.push([]);

  // Row 5: column headers
  const colHeaders: (string | number | null)[] = ["순번", "대분류", "날짜", "구분", "총계", "인원", "인당금액"];
  pNames.forEach((n) => colHeaders.push(n));
  rows.push(colHeaders);

  // Row 6+: expense data
  tour.expenses.forEach((e, idx) => {
    const rate = e.exchangeRate || 1;
    const amountKRW = e.amount * rate;
    const splitCount = e.splitAmong.length;
    const perPerson = splitCount > 0 ? amountKRW / splitCount : 0;
    const currencyNote = e.currency && e.currency !== "KRW" ? ` (${e.currency})` : "";

    const row: (string | number | null)[] = [
      idx + 1, "",
      e.createdAt ? new Date(e.createdAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "",
      e.name + currencyNote, fmt(amountKRW), splitCount, Math.round(perPerson),
    ];

    tour.participants.forEach((p) => {
      const isP = e.splitAmong.includes(p.id);
      const isPayer = e.paidBy === p.id;
      // splitType=custom 인 경우 splitAmounts 사용, 아니면 인원수로 균등 분할
      let share = 0;
      if (isP) {
        if (e.splitType === "custom" && e.splitAmounts) {
          share = (e.splitAmounts[String(p.id)] || 0) * rate;
        } else {
          share = perPerson;
        }
      }
      if (isP) {
        row.push(Math.round(share));
      } else if (isPayer) {
        // 결제만 한 경우 (분담 X) — 0 으로 표기하되 시각 구분 (셀 스타일에서 처리)
        row.push(0);
      } else {
        row.push(null);
      }
    });
    rows.push(row);
  });

  // Totals row
  const totalKRW = tour.expenses.reduce((s, e) => s + e.amount * (e.exchangeRate || 1), 0);
  const totalRow: (string | number | null)[] = [null, "총 합계", null, null, fmt(totalKRW)];
  while (totalRow.length < dataCols) totalRow.push(null);
  rows.push(totalRow);

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // --- Apply styles ---
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");

  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (!ws[addr]) ws[addr] = { v: "", t: "s" };
      const cell = ws[addr];
      if (!cell.s) cell.s = {};
      cell.s.border = THIN_BORDER;
      cell.s.alignment = CENTER;

      // Row 0: participant name headers
      if (R === 0 && C >= 7) {
        cell.s.fill = HEADER_BG;
        cell.s.font = WHITE_FONT;
      }

      // Row 1-3: summary rows
      if (R >= 1 && R <= 3) {
        if (C === 6) {
          // Label cell
          cell.s.fill = SUMMARY_BG;
          cell.s.font = { bold: true };
          cell.s.alignment = RIGHT;
        } else if (C >= 7) {
          cell.s.fill = SUMMARY_ROW_BG;
          cell.s.alignment = RIGHT;
          if (R === 1) {
            // 인당 정산액
            cell.s.font = { bold: true };
          } else if (R === 2) {
            // 결제액
            const val = cell.v as number;
            cell.s.font = val > 0 ? BLUE_FONT : { color: { rgb: "999999" } };
          } else if (R === 3) {
            // 최종 금액
            const val = cell.v as number;
            if (val < 0) { cell.s.fill = BAL_NEG_BG; cell.s.font = RED_FONT; }
            else if (val > 0) { cell.s.fill = BAL_POS_BG; cell.s.font = GREEN_FONT; }
          }
          // Number format for summary values
          cell.s.numFmt = "#,##0";
        }
      }

      // Row 5: column headers
      if (R === 5) {
        cell.s.fill = HEADER_BG;
        cell.s.font = WHITE_FONT;
      }

      // Row 6+: data rows (expense rows)
      const dataStartRow = 6;
      const dataEndRow = dataStartRow + tour.expenses.length - 1;
      if (R >= dataStartRow && R <= dataEndRow) {
        // Amount columns
        if (C === 4 || C === 6) {
          cell.s.alignment = RIGHT;
          cell.s.numFmt = "#,##0";
        }
        // 분담 금액 셀 (col 7 이상): 1인 분담금 또는 빈 셀 / 결제만(0)
        if (C >= 7) {
          const e = tour.expenses[R - dataStartRow];
          const partIdx = C - 7;
          const p = tour.participants[partIdx];
          if (e && p) {
            const isP = e.splitAmong.includes(p.id);
            const isPayer = e.paidBy === p.id;
            cell.s.alignment = RIGHT;
            cell.s.numFmt = "#,##0";
            if (isP && isPayer) {
              // 결제자 + 분담: 파란색 강조
              cell.s.fill = BLUE_BG; cell.s.font = WHITE_FONT;
            } else if (isP) {
              // 분담만: 옅은 녹색
              cell.s.fill = GREEN_BG; cell.s.font = GREEN_DARK;
            } else if (isPayer) {
              // 결제만 (분담 X): 주황색, 값은 0
              cell.s.fill = ORANGE_BG; cell.s.font = WHITE_FONT;
              cell.s.alignment = CENTER;
              cell.s.numFmt = '"결제만"';
            } else {
              // 비참여: 회색 대시
              cell.s.fill = RED_BG; cell.s.font = RED_DARK;
              cell.s.alignment = CENTER;
              cell.v = "—";
            }
          }
        }
        // Zebra stripe for odd rows
        if ((R - dataStartRow) % 2 === 1 && C < 7) {
          cell.s.fill = { fgColor: { rgb: "F5F5F5" } };
        }
      }

      // Totals row
      if (R === dataEndRow + 1) {
        cell.s.fill = TOTAL_BG;
        cell.s.font = { bold: true };
        if (C === 4) { cell.s.alignment = RIGHT; cell.s.numFmt = "#,##0"; }
      }
    }
  }

  // Column widths
  const colWidths: XLSX.ColInfo[] = [
    { wch: 5 }, { wch: 10 }, { wch: 10 }, { wch: 25 },
    { wch: 12 }, { wch: 5 }, { wch: 12 },
  ];
  for (let i = 0; i < pCount; i++) {
    colWidths.push({ wch: Math.max(7, Math.min(10, pNames[i].length * 2 + 2)) });
  }
  ws["!cols"] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, "정산 매트릭스");

  // --- Sheet 2: Settlement transfers ---
  const tRows: (string | number)[][] = [["No", "보내는 사람", "받는 사람", "금액"]];
  settlements.forEach((s, i) => tRows.push([i + 1, s.fromName, s.toName, fmt(s.amount)]));
  const ws2 = XLSX.utils.aoa_to_sheet(tRows);
  // Style header
  for (let C = 0; C < 4; C++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c: C });
    if (ws2[addr]) {
      ws2[addr].s = { fill: HEADER_BG, font: WHITE_FONT, alignment: CENTER, border: THIN_BORDER };
    }
  }
  // Style data rows
  for (let R = 1; R <= settlements.length; R++) {
    for (let C = 0; C < 4; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      if (ws2[addr]) {
        ws2[addr].s = { border: THIN_BORDER, alignment: C === 3 ? RIGHT : CENTER };
        if (C === 3) ws2[addr].s.numFmt = "#,##0";
      }
    }
  }
  ws2["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, ws2, "송금 내역");

  // --- Sheet 3: Receipts ---
  const receiptExpenses = tour.expenses.filter((e) => e.receiptImage);
  if (receiptExpenses.length > 0) {
    const rRows: (string | number)[][] = [["No", "비용 항목", "금액", "결제자", "날짜", "영수증"]];
    receiptExpenses.forEach((e, i) => {
      const payer = tour.participants.find((p) => p.id === e.paidBy);
      const rate = e.exchangeRate || 1;
      rRows.push([
        i + 1,
        e.name + (e.currency && e.currency !== "KRW" ? ` (${e.currency})` : ""),
        fmt(e.amount * rate),
        payer?.name || "?",
        e.createdAt ? new Date(e.createdAt).toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" }) : "",
        "첨부됨",
      ]);
    });
    const ws3 = XLSX.utils.aoa_to_sheet(rRows);
    // Style header
    for (let C = 0; C < 6; C++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: C });
      if (ws3[addr]) {
        ws3[addr].s = { fill: HEADER_BG, font: WHITE_FONT, alignment: CENTER, border: THIN_BORDER };
      }
    }
    // Style data rows and embed receipt images as comments
    for (let R = 1; R <= receiptExpenses.length; R++) {
      for (let C = 0; C < 6; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws3[addr]) {
          ws3[addr].s = { border: THIN_BORDER, alignment: C === 2 ? RIGHT : CENTER };
          if (C === 2) ws3[addr].s.numFmt = "#,##0";
        }
      }
    }
    ws3["!cols"] = [{ wch: 5 }, { wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws3, "영수증 목록");
  }

  // Download
  const fileName = `DiveON_정산서_${tour.name}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  if (isNative()) {
    const base64 = XLSX.write(wb, { type: "base64", bookType: "xlsx" });
    await saveFile(fileName, base64, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  } else {
    XLSX.writeFile(wb, fileName);
  }
}
