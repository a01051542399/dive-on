import { useState, useEffect, useRef } from "react";
import { Modal } from "./Modal";

const ADMIN_PIN = "2399";

interface PinModalProps {
  visible: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  title?: string;
  message?: string;
}

export function PinModal({
  visible,
  onSuccess,
  onCancel,
  title = "비밀번호 확인",
  message = "수정 비밀번호 4자리를 입력하세요",
}: PinModalProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible) {
      setPin("");
      setError(false);
      setShake(false);
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [visible]);

  const handlePinChange = (value: string) => {
    const cleaned = value.replace(/[^0-9]/g, "").slice(0, 4);
    setPin(cleaned);
    setError(false);

    if (cleaned.length === 4) {
      if (cleaned === ADMIN_PIN) {
        onSuccess();
        setPin("");
      } else {
        setError(true);
        setShake(true);
        setTimeout(() => { setPin(""); setShake(false); }, 500);
      }
    }
  };

  return (
    <Modal open={visible} center onClose={onCancel}>
      <div style={{ textAlign: "center", position: "relative" }}>
        {/* Lock icon */}
        <div style={{
          width: 56, height: 56, borderRadius: 28,
          background: "var(--primary-alpha-15)",
          display: "flex", alignItems: "center", justifyContent: "center",
          margin: "0 auto 16px", fontSize: 24,
        }}>
          PIN
        </div>

        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--foreground)", marginBottom: 6 }}>
          {title}
        </h3>
        <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 24, lineHeight: 1.5 }}>
          {message}
        </p>

        {/* Hidden input */}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          value={pin}
          onChange={(e) => handlePinChange(e.target.value)}
          maxLength={4}
          style={{ position: "absolute", opacity: 0, height: 0, width: 0 }}
          onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}
        />

        {/* PIN dots */}
        <div
          onClick={() => inputRef.current?.focus()}
          style={{
            display: "flex", gap: 16, justifyContent: "center", marginBottom: 20, cursor: "pointer",
            animation: shake ? "pin-shake 0.3s ease" : undefined,
          }}
        >
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: 18, height: 18, borderRadius: 9,
                border: `2px solid ${error ? "var(--error)" : pin.length > i ? "var(--primary)" : "var(--border)"}`,
                background: pin.length > i ? (error ? "var(--error)" : "var(--primary)") : "transparent",
                transition: "all 0.15s",
              }}
            />
          ))}
        </div>

        {error && (
          <p style={{ fontSize: 13, fontWeight: 500, color: "var(--error)", marginBottom: 12 }}>
            PIN이 올바르지 않습니다
          </p>
        )}

        {/* Cancel */}
        <button
          onClick={onCancel}
          style={{
            border: "1px solid var(--border)", borderRadius: 12,
            padding: "12px 32px", background: "transparent",
            color: "var(--muted)", fontSize: 15, fontWeight: 600,
            cursor: "pointer", marginTop: 4,
          }}
        >
          취소
        </button>

        <style>{`
          @keyframes pin-shake {
            0%, 100% { transform: translateX(0); }
            20% { transform: translateX(-10px); }
            40% { transform: translateX(10px); }
            60% { transform: translateX(-10px); }
            80% { transform: translateX(10px); }
          }
        `}</style>
      </div>
    </Modal>
  );
}
